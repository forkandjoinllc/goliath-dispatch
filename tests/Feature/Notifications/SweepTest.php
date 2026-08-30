<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Corre el barrido sobre UNA empresa y devuelve su salida. */
function barrer(Scenario $scenario, array $opciones = []): string
{
    Artisan::call('notifications:sweep', ['--tenant' => $scenario->tenant->id, ...$opciones]);

    return Artisan::output();
}

/** Un documento con fecha de caducidad. */
function documentoQueCaduca(Scenario $scenario, int $enDias, string $titulo = 'Seguro de responsabilidad'): string
{
    $id = (string) Str::uuid();

    DB::table('documents')->insert([
        'id' => $id,
        'tenant_id' => $scenario->tenant->id,
        'document_type' => 'certificate_of_insurance',
        'owner_type' => 'carrier',
        'owner_id' => $scenario->assignedCarrier->id,
        'title' => $titulo,
        'review_status' => 'approved',
        'expiration_date' => now()->addDays($enDias)->toDateString(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

/** @return \Illuminate\Support\Collection<int, object> */
function avisosDe(Scenario $scenario, Role $role, ?string $evento = null)
{
    $query = DB::table('notifications')
        ->where('tenant_id', $scenario->tenant->id)
        ->where('user_id', $scenario->user($role)->id)
        ->where('channel', 'in_app');

    if ($evento !== null) {
        $query->where('event_key', $evento);
    }

    return $query->get();
}

/* ── Que ocurra algo sin que nadie mire ─────────────────────────────────── */

it('avisa de un documento que caduca dentro del plazo', function () {
    documentoQueCaduca($this->scenario, 10);

    barrer($this->scenario);

    $avisos = avisosDe($this->scenario, Role::Admin, 'document.expiring');

    expect($avisos)->toHaveCount(1);
    expect($avisos->first()->title)->toContain('Seguro de responsabilidad');
    expect($avisos->first()->action_url)->toBe('/documents?expiring=1');
});

it('no avisa de un documento que caduca dentro de un año', function () {
    documentoQueCaduca($this->scenario, 300);

    barrer($this->scenario);

    expect(avisosDe($this->scenario, Role::Admin, 'document.expiring'))->toBeEmpty();
});

it('no vuelve a avisar aunque el barrido corra todos los días', function () {
    documentoQueCaduca($this->scenario, 10);

    // Tres barridos seguidos. Sin la clave de deduplicación, la campana tendría
    // treinta copias del mismo aviso al cabo de un mes y nadie volvería a
    // mirarla. Quien lo impide es el índice único, no una comprobación previa.
    barrer($this->scenario);
    barrer($this->scenario);
    barrer($this->scenario);

    expect(avisosDe($this->scenario, Role::Admin, 'document.expiring'))->toHaveCount(1);
});

it('vuelve a avisar si el documento se renueva y su nueva fecha se acerca', function () {
    $id = documentoQueCaduca($this->scenario, 10);

    barrer($this->scenario);
    expect(avisosDe($this->scenario, Role::Admin, 'document.expiring'))->toHaveCount(1);

    // Renovado: fecha nueva. La clave lleva la fecha de CADUCIDAD justo para
    // esto — con la fecha de hoy dentro, avisaría cada mañana; sin fecha
    // ninguna, no volvería a avisar nunca.
    DB::table('documents')->where('id', $id)->update([
        'expiration_date' => now()->addDays(20)->toDateString(),
    ]);

    barrer($this->scenario);

    expect(avisosDe($this->scenario, Role::Admin, 'document.expiring'))->toHaveCount(2);
});

it('avisa de un transportista sin comprobación de FMCSA', function () {
    barrer($this->scenario);

    // El escenario crea dos transportistas y ninguno tiene verificación.
    expect(avisosDe($this->scenario, Role::Admin, 'carrier.reverification_due'))->toHaveCount(2);
});

it('no avisa de un transportista comprobado hace poco', function () {
    foreach ([$this->scenario->assignedCarrier->id, $this->scenario->otherCarrier->id] as $carrierId) {
        DB::table('fmcsa_verifications')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'carrier_id' => $carrierId,
            'provider' => 'mock',
            'dot_number' => '7000001',
            'status' => 'verified',
            'normalized' => json_encode([]),
            'attempt' => 1,
            'checked_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    barrer($this->scenario);

    expect(avisosDe($this->scenario, Role::Admin, 'carrier.reverification_due'))->toBeEmpty();
});

/* ── La factura vencida: además de avisar, corrige el dato ──────────────── */

it('pone al día el estado de una factura vencida, que nadie ponía', function () {
    signIn($this->scenario, Role::Admin);

    DB::table('loads')->where('id', $this->scenario->load->id)->update([
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'status' => 'delivered',
        'actual_delivery_at' => now()->subDay(),
        'customer_charge_cents' => 300000,
        'carrier_gross_rate_cents' => 250000,
        'carrier_dispatch_fee_bps' => 1000,
        'updated_at' => now(),
    ]);

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$this->scenario->load->id],
        'payment_terms_days' => 15,
    ])->assertRedirect()->assertSessionHasNoErrors();

    $id = (string) DB::table('invoices')->orderByDesc('created_at')->value('id');
    $this->post("/invoices/{$id}/send")->assertRedirect()->assertSessionHasNoErrors();

    DB::table('invoices')->where('id', $id)->update(['due_date' => now()->subDays(10)]);

    // `invoices.status` solo lo escribía PaymentLedger al anotar un cobro: una
    // factura que cruza su vencimiento sin que nadie la toque se quedaba en
    // `sent` para siempre.
    expect(DB::table('invoices')->where('id', $id)->value('status'))->toBe('sent');

    barrer($this->scenario);

    expect(DB::table('invoices')->where('id', $id)->value('status'))->toBe('overdue');
    expect(avisosDe($this->scenario, Role::Admin, 'invoice.overdue'))->toHaveCount(1);
});

/* ── A quién se avisa ───────────────────────────────────────────────────── */

it('no avisa al transportista de las facturas vencidas de la casa', function () {
    documentoQueCaduca($this->scenario, 10);

    barrer($this->scenario);

    // El rol transportista tiene `invoice:read` con alcance Carrier: avisarle de
    // que «hay facturas vencidas» le contaría que existen las de los demás. Se
    // exige alcance de empresa o más.
    expect(avisosDe($this->scenario, Role::Carrier, 'invoice.overdue'))->toBeEmpty();
});

it('avisa en el idioma de quien recibe, no en el del servidor', function () {
    DB::table('users')->where('id', $this->scenario->user(Role::Admin)->id)->update(['locale' => 'es']);
    DB::table('users')->where('id', $this->scenario->user(Role::Accounting)->id)->update(['locale' => 'en']);

    documentoQueCaduca($this->scenario, 10);

    barrer($this->scenario);

    expect(avisosDe($this->scenario, Role::Admin, 'document.expiring')->first()->title)
        ->toContain('Caduca un documento');

    expect(avisosDe($this->scenario, Role::Accounting, 'document.expiring')->first()->title)
        ->toContain('Document expiring');
});

it('respeta que alguien haya apagado un aviso', function () {
    DB::table('notification_preferences')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'user_id' => $this->scenario->user(Role::Admin)->id,
        'event_key' => 'document.expiring',
        'in_app' => 0,
        'email' => 0,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    documentoQueCaduca($this->scenario, 10);

    barrer($this->scenario);

    expect(avisosDe($this->scenario, Role::Admin, 'document.expiring'))->toBeEmpty();
    // A quien no lo apagó, le llega igual.
    expect(avisosDe($this->scenario, Role::Accounting, 'document.expiring'))->toHaveCount(1);
});

/* ── La frontera de empresa ─────────────────────────────────────────────── */

it('no avisa a nadie de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    documentoQueCaduca($this->scenario, 10);

    barrer($this->scenario);

    expect(DB::table('notifications')->where('tenant_id', $otra->tenant->id)->count())->toBe(0);
});

/* ── El simulacro no escribe ────────────────────────────────────────────── */

it('el simulacro cuenta y no escribe nada', function () {
    documentoQueCaduca($this->scenario, 10);

    $salida = barrer($this->scenario, ['--dry-run' => true]);

    expect($salida)->toContain('simulacro');
    expect(DB::table('notifications')->where('tenant_id', $this->scenario->tenant->id)->count())->toBe(0);
});

/* ── La pantalla y la campana ───────────────────────────────────────────── */

it('cada quien ve solo sus avisos', function () {
    documentoQueCaduca($this->scenario, 10);
    barrer($this->scenario);

    // Los del administrador y ni uno de los de contabilidad, que el mismo
    // barrido acaba de escribir.
    $ajenos = DB::table('notifications')
        ->where('user_id', $this->scenario->user(Role::Accounting)->id)
        ->pluck('id')
        ->all();

    expect($ajenos)->not->toBeEmpty();

    signIn($this->scenario, Role::Admin);

    $this->get('/notifications')->assertOk()->assertInertia(function (Assert $page) use ($ajenos) {
        $filas = collect($page->toArray()['props']['notifications']['data']);

        expect($filas)->not->toBeEmpty();
        expect($filas->pluck('eventKey')->all())->toContain('document.expiring');
        expect(array_intersect($filas->pluck('id')->all(), $ajenos))->toBe([]);
    });
});

it('la campana cuenta los no leídos de esta persona', function () {
    documentoQueCaduca($this->scenario, 10);
    barrer($this->scenario);

    signIn($this->scenario, Role::Admin);

    $suyos = DB::table('notifications')
        ->where('user_id', $this->scenario->user(Role::Admin)->id)
        ->where('channel', 'in_app')
        ->count();

    expect($suyos)->toBeGreaterThan(0);

    $this->get('/home')->assertInertia(function (Assert $page) use ($suyos) {
        expect($page->toArray()['props']['shell']['unreadNotifications'])->toBe($suyos);
    });

    $this->post('/notifications/read-all')->assertRedirect();

    $this->get('/home')->assertInertia(function (Assert $page) {
        expect($page->toArray()['props']['shell']['unreadNotifications'])->toBe(0);
    });
});

it('no deja marcar como leído el aviso de otra persona', function () {
    documentoQueCaduca($this->scenario, 10);
    barrer($this->scenario);

    $ajeno = DB::table('notifications')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('user_id', $this->scenario->user(Role::Accounting)->id)
        ->where('channel', 'in_app')
        ->first();

    expect($ajeno)->not->toBeNull();

    signIn($this->scenario, Role::Admin);

    // No filtraría nada a la vista, pero le apagaría la campana a otro — el
    // tipo de efecto lateral que no se nota hasta que alguien se pierde algo.
    $this->post("/notifications/{$ajeno->id}/read")->assertRedirect();

    expect(DB::table('notifications')->where('id', $ajeno->id)->value('read_at'))->toBeNull();
});

it('guarda las preferencias de quien las cambia, y solo las suyas', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/notification-preferences', [
        'preferences' => [
            ['event_key' => 'document.expiring', 'in_app' => false, 'email' => false],
            ['event_key' => 'invoice.overdue', 'in_app' => true, 'email' => false],
        ],
    ])->assertRedirect()->assertSessionHasNoErrors();

    $filas = DB::table('notification_preferences')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('user_id', $this->scenario->user(Role::Admin)->id)
        ->get()
        ->keyBy('event_key');

    expect((bool) $filas['document.expiring']->in_app)->toBeFalse();
    expect((bool) $filas['invoice.overdue']->in_app)->toBeTrue();
    expect((bool) $filas['invoice.overdue']->email)->toBeFalse();

    expect(DB::table('notification_preferences')
        ->where('user_id', $this->scenario->user(Role::Accounting)->id)
        ->count())->toBe(0);
});

it('rechaza un suceso que no existe', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/notification-preferences', [
        'preferences' => [['event_key' => 'inventado.suceso', 'in_app' => true, 'email' => true]],
    ])->assertSessionHasErrors('preferences.0.event_key');
});

/* ── El aviso que no viene de un barrido ────────────────────────────────── */

it('avisa a quien recibe un prospecto', function () {
    $id = (string) Str::uuid();

    DB::table('leads')->insert([
        'id' => $id,
        'tenant_id' => $this->scenario->tenant->id,
        'first_name' => 'Ana',
        'last_name' => 'Ruiz',
        'email' => 'ana@ejemplo.test',
        'company_name' => 'Transportes Ruiz LLC',
        'locale' => 'es',
        'source' => 'contact_form',
        'status' => 'new',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    signIn($this->scenario, Role::Admin);

    $destinatario = $this->scenario->user(Role::Accounting);

    $this->post("/leads/{$id}/assign", ['assigned_to_user_id' => $destinatario->id])
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    $aviso = DB::table('notifications')
        ->where('user_id', $destinatario->id)
        ->where('event_key', 'lead.assigned')
        ->where('channel', 'in_app')
        ->first();

    expect($aviso)->not->toBeNull();
    expect($aviso->body)->toContain('Transportes Ruiz LLC');
    expect($aviso->action_url)->toBe('/leads/'.$id);

    // A quien reparte no se le avisa de lo que acaba de hacer.
    expect(DB::table('notifications')
        ->where('user_id', $this->scenario->user(Role::Admin)->id)
        ->where('event_key', 'lead.assigned')
        ->count())->toBe(0);
});

it('no enseña el mismo aviso dos veces por haberlo mandado también por correo', function () {
    documentoQueCaduca($this->scenario, 10);
    barrer($this->scenario);

    // Cada aviso escribe una fila POR CANAL: es el registro de entrega y hace
    // falta para saber si el correo salió. Para quien mira son el mismo hecho.
    $filas = DB::table('notifications')
        ->where('user_id', $this->scenario->user(Role::Admin)->id)
        ->where('event_key', 'document.expiring')
        ->count();

    expect($filas)->toBe(2);

    signIn($this->scenario, Role::Admin);

    $this->get('/notifications')->assertInertia(function (Assert $page) {
        $deDocumentos = collect($page->toArray()['props']['notifications']['data'])
            ->where('eventKey', 'document.expiring');

        expect($deDocumentos)->toHaveCount(1);
    });
});

it('la campana y la lista cuentan lo mismo', function () {
    documentoQueCaduca($this->scenario, 10);
    barrer($this->scenario);

    signIn($this->scenario, Role::Admin);

    $enLaLista = 0;
    $enLaCampana = 0;

    $this->get('/notifications?unread=1')->assertInertia(function (Assert $page) use (&$enLaLista) {
        $enLaLista = $page->toArray()['props']['notifications']['meta']['total'];
    });

    $this->get('/home')->assertInertia(function (Assert $page) use (&$enLaCampana) {
        $enLaCampana = $page->toArray()['props']['shell']['unreadNotifications'];
    });

    expect($enLaLista)->toBe($enLaCampana);
    expect($enLaLista)->toBeGreaterThan(0);
});

/* ── Caducado y a punto de caducar son sucesos distintos ────────────────── */

it('distingue un documento ya caducado de uno que caduca pronto', function () {
    // En español, para poder afirmar sobre el texto: el escenario crea a la
    // gente en inglés.
    DB::table('users')->where('id', $this->scenario->user(Role::Admin)->id)->update(['locale' => 'es']);

    documentoQueCaduca($this->scenario, 10, 'Seguro que caduca');
    documentoQueCaduca($this->scenario, -20, 'Seguro ya caducado');

    barrer($this->scenario);

    $porCaducar = avisosDe($this->scenario, Role::Admin, 'document.expiring');
    $caducado = avisosDe($this->scenario, Role::Admin, 'document.expired');

    expect($porCaducar)->toHaveCount(1);
    expect($caducado)->toHaveCount(1);

    // Con un solo texto, el aviso de uno ya vencido decía «renuévelo antes de
    // que venza». La distinción venía en el diccionario portado.
    expect($porCaducar->first()->body)->toContain('antes de que venza');
    expect($caducado->first()->body)->not->toContain('antes de que venza');
    expect($caducado->first()->title)->toContain('caducado');
});

it('un documento que se avisó y nadie renovó vuelve a avisar al vencer', function () {
    $id = documentoQueCaduca($this->scenario, 3, 'Seguro a punto');

    barrer($this->scenario);
    expect(avisosDe($this->scenario, Role::Admin, 'document.expiring'))->toHaveCount(1);

    // Pasa el tiempo y nadie lo renueva: la fecha no cambia, pero el suceso sí.
    // Si la clave de deduplicación no llevara el suceso, este segundo aviso
    // —el que de verdad importa— no se mandaría nunca.
    DB::table('documents')->where('id', $id)->update([
        'expiration_date' => now()->subDay()->toDateString(),
    ]);

    barrer($this->scenario);

    expect(avisosDe($this->scenario, Role::Admin, 'document.expired'))->toHaveCount(1);
});
