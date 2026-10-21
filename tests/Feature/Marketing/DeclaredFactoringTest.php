<?php

declare(strict_types=1);

use App\Models\Carrier;
use App\Models\Lead;
use App\Models\Tenant;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

uses(DatabaseTransactions::class);

beforeEach(function () {
    RateLimiter::clear('');
    app(TenantContext::class)->forget();
});

/** Un sello envejecido, para no dormir tres segundos por prueba. */
function selloFactoring(string $form = 'carrier_signup', int $hace = 10): string
{
    $payload = json_encode(['f' => $form, 't' => (int) ((microtime(true) - $hace) * 1000)]);
    $body = rtrim(strtr(base64_encode((string) $payload), '+/', '-_'), '=');

    $key = (string) config('app.key');

    if (str_starts_with($key, 'base64:')) {
        $key = (string) base64_decode(substr($key, 7), true);
    }

    return $body.'.'.hash_hmac('sha256', $body, $key);
}

function casaConDominio(): Tenant
{
    return Tenant::create([
        'slug' => 'fact-'.Str::random(6),
        'legal_name' => 'Casa Factoring LLC',
        'display_name' => 'Casa',
        'status' => 'active',
        'custom_domain' => 'fact-'.Str::random(6).'.test',
        'custom_domain_verified_at' => now(),
    ]);
}

function empresaDeFactoring(string $tenantId, string $nombre, bool $activa = true, bool $borrada = false): string
{
    $id = (string) Str::uuid();

    DB::table('factoring_companies')->insert([
        'id' => $id,
        'tenant_id' => $tenantId,
        'name' => $nombre,
        'email' => 'cobros@'.Str::random(6).'.test',
        'phone' => '+1 555 0100',
        'funding_instructions' => 'SECRETO DE PAGO: cuenta 0000',
        'active' => $activa,
        'deleted_at' => $borrada ? now() : null,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

function altaFactoring(array $cambios = []): array
{
    return [
        'legal_name' => 'Transportes del Valle LLC',
        'dot_number' => '2345672',
        'mc_number' => '765432',
        'contact_first_name' => 'Rosa',
        'contact_last_name' => 'Peña',
        'email' => 'rosa-'.Str::random(6).'@valle.test',
        'phone' => '+1 555 0199',
        'physical_line1' => '400 Depot Rd',
        'physical_city' => 'Doral',
        'physical_state' => 'fl',
        'physical_postal_code' => '33172',
        'mailing_same_as_physical' => true,
        'preferred_locale' => 'en',
        'uses_factoring' => true,
        'factoring_company_name' => 'Tesorería del Norte LLC',
        'lead_consent' => true,
        'privacy_consent' => true,
        'terms_consent' => true,
        'hp_field' => '',
        'form_token' => selloFactoring(),
        ...$cambios,
    ];
}

/* ── El nombre de la lista se resuelve a su ficha ───────────────────────── */

it('un nombre de la lista queda enlazado a su ficha', function (): void {
    $casa = casaConDominio();
    $ficha = empresaDeFactoring($casa->id, 'Tesorería del Norte LLC');

    $alta = altaFactoring();

    $this->post("http://{$casa->custom_domain}/carrier-signup", $alta)
        ->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($casa->id, function () use ($ficha, $alta): void {
        $c = Carrier::where('dot_number', '2345672')->firstOrFail();

        expect($c->uses_factoring)->toBeTrue();
        expect((string) $c->factoring_declared_company_id)->toBe($ficha);
        // Y el texto libre NO: son dos respuestas a la misma pregunta y el
        // CHECK de la base solo admite una.
        expect($c->factoring_declared_name)->toBeNull();

        $lead = Lead::where('email', $alta['email'])->firstOrFail();
        expect((string) $lead->factoring_company_id)->toBe($ficha);
        expect($lead->factoring_company_name)->toBeNull();
    });
});

it('da igual cómo se escriban las mayúsculas', function (): void {
    // El cotejamiento de la columna es insensible a mayúsculas y acentos, que
    // es como la gente escribe el nombre de su empresa de factoring.
    $casa = casaConDominio();
    $ficha = empresaDeFactoring($casa->id, 'Tesorería del Norte LLC');

    $this->post(
        "http://{$casa->custom_domain}/carrier-signup",
        altaFactoring(['factoring_company_name' => 'tesoreria DEL norte llc']),
    )->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($casa->id, function () use ($ficha): void {
        expect((string) Carrier::where('dot_number', '2345672')->value('factoring_declared_company_id'))
            ->toBe($ficha);
    });
});

/* ── «Other»: un nombre que no está en la lista ──────────────────────────── */

it('un nombre que no está en la lista se guarda como texto', function (): void {
    $casa = casaConDominio();
    empresaDeFactoring($casa->id, 'Otra Cosa LLC');

    $this->post(
        "http://{$casa->custom_domain}/carrier-signup",
        altaFactoring(['factoring_company_name' => 'Factoring Sin Ficha LLC']),
    )->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($casa->id, function (): void {
        $c = Carrier::where('dot_number', '2345672')->firstOrFail();

        expect($c->factoring_declared_company_id)->toBeNull();
        expect($c->factoring_declared_name)->toBe('Factoring Sin Ficha LLC');
    });
});

it('una ficha inactiva no se enlaza', function (): void {
    /*
    | Una empresa marcada inactiva sigue valiendo para quien ya la tiene —la
    | carta de cesión no se anula porque cambiemos una casilla— pero no debe
    | poder elegirse de nuevo. Lo mismo que ya hace el panel.
    */
    $casa = casaConDominio();
    empresaDeFactoring($casa->id, 'Inactiva LLC', activa: false);

    $this->post(
        "http://{$casa->custom_domain}/carrier-signup",
        altaFactoring(['factoring_company_name' => 'Inactiva LLC']),
    )->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($casa->id, function (): void {
        $c = Carrier::where('dot_number', '2345672')->firstOrFail();

        expect($c->factoring_declared_company_id)->toBeNull();
        expect($c->factoring_declared_name)->toBe('Inactiva LLC');
    });
});

it('una ficha borrada en suave tampoco', function (): void {
    $casa = casaConDominio();
    empresaDeFactoring($casa->id, 'Borrada LLC', borrada: true);

    $this->post(
        "http://{$casa->custom_domain}/carrier-signup",
        altaFactoring(['factoring_company_name' => 'Borrada LLC']),
    )->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($casa->id, function (): void {
        expect(Carrier::where('dot_number', '2345672')->value('factoring_declared_company_id'))
            ->toBeNull();
    });
});

/* ── Lo de otra empresa no se enlaza NUNCA ──────────────────────────────── */

it('el nombre de la lista de OTRA empresa no se enlaza', function (): void {
    /*
    | Dos casas de despacho pueden trabajar con la misma empresa de factoring y
    | cada una tiene su propia ficha. Enlazar la del vecino cruzaría los datos
    | de dos empresas por una coincidencia de nombre.
    */
    $mia = casaConDominio();
    $vecina = casaConDominio();
    $suya = empresaDeFactoring($vecina->id, 'Compartida LLC');

    $this->post(
        "http://{$mia->custom_domain}/carrier-signup",
        altaFactoring(['factoring_company_name' => 'Compartida LLC']),
    )->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($mia->id, function () use ($suya): void {
        $c = Carrier::where('dot_number', '2345672')->firstOrFail();

        expect($c->factoring_declared_company_id)->not->toBe($suya);
        expect($c->factoring_declared_company_id)->toBeNull();
        expect($c->factoring_declared_name)->toBe('Compartida LLC');
    });
});

/* ── La lista que llega a la página pública ─────────────────────────────── */

it('la página pública ofrece las activas de ESA empresa y nada más', function (): void {
    $mia = casaConDominio();
    $vecina = casaConDominio();

    empresaDeFactoring($mia->id, 'Mía Activa LLC');
    empresaDeFactoring($mia->id, 'Mía Inactiva LLC', activa: false);
    empresaDeFactoring($mia->id, 'Mía Borrada LLC', borrada: true);
    empresaDeFactoring($vecina->id, 'De La Vecina LLC');

    $r = $this->get("http://{$mia->custom_domain}/en/carrier-signup");
    $r->assertOk();

    $lista = $r->viewData('page')['props']['factoringCompanies'];

    expect($lista)->toBe(['Mía Activa LLC']);
});

it('ni los correos ni las instrucciones de pago salen a la página', function (): void {
    $casa = casaConDominio();
    empresaDeFactoring($casa->id, 'Con Secretos LLC');

    $r = $this->get("http://{$casa->custom_domain}/en/carrier-signup");

    $r->assertOk();
    $r->assertDontSee('SECRETO DE PAGO', false);
    $r->assertDontSee('funding_instructions', false);
});

it('en el sitio de la plataforma no hay lista', function (): void {
    // Y por eso la pantalla enseña la casilla de texto: un desplegable vacío
    // sería un filtro que no puede encontrar nada.
    $r = $this->get('/en/carrier-signup');

    $r->assertOk();
    expect($r->viewData('page')['props']['factoringCompanies'])->toBe([]);
});

it('las demás páginas públicas no cargan la lista', function (): void {
    $casa = casaConDominio();
    empresaDeFactoring($casa->id, 'No Debe Salir LLC');

    $r = $this->get("http://{$casa->custom_domain}/en/contact");

    $r->assertOk();
    expect($r->viewData('page')['props']['factoringCompanies'])->toBe([]);
    $r->assertDontSee('No Debe Salir LLC', false);
});

/* ── En el sitio de la plataforma la respuesta SÍ se guarda ─────────────── */

it('sin empresa la respuesta se guarda en el prospecto', function (): void {
    /*
    | Antes de este lote la casilla se marcaba en goliathdispatch.com y no iba a
    | ningún sitio: no se crea transportista y `leads` no tenía la columna. La
    | persona contestaba una pregunta que no se guardaba.
    */
    $alta = altaFactoring(['factoring_company_name' => 'Capital de Camiones LLC']);

    $this->post('/carrier-signup', $alta)->assertSessionHasNoErrors();

    app(TenantContext::class)->set(null);
    $lead = Lead::where('email', $alta['email'])->firstOrFail();

    expect($lead->uses_factoring)->toBeTrue();
    expect($lead->factoring_company_name)->toBe('Capital de Camiones LLC');
    // Sin empresa no hay ficha a la que enlazar.
    expect($lead->factoring_company_id)->toBeNull();
});

/* ── La regla del formulario ─────────────────────────────────────────────── */

it('decir que se factoriza sin decir con quién no pasa', function (): void {
    $this->post('/carrier-signup', altaFactoring(['factoring_company_name' => null]))
        ->assertSessionHasErrors('factoring_company_name');

    app(TenantContext::class)->set(null);
    expect(Lead::where('dot_number', '2345672')->count())->toBe(0);
});

it('un nombre colgando de un «no» tampoco', function (): void {
    // El estado que el CHECK de la base rechaza, rechazado antes de llegar.
    $this->post('/carrier-signup', altaFactoring([
        'uses_factoring' => false,
        'factoring_company_name' => 'Nombre Suelto LLC',
    ]))->assertSessionHasErrors('factoring_company_name');
});

it('no factorizar sigue siendo una respuesta válida', function (): void {
    $alta = altaFactoring(['uses_factoring' => false, 'factoring_company_name' => null]);

    $this->post('/carrier-signup', $alta)->assertSessionHasNoErrors();

    app(TenantContext::class)->set(null);
    $lead = Lead::where('email', $alta['email'])->firstOrFail();

    expect($lead->uses_factoring)->toBeFalse();
    expect($lead->factoring_company_name)->toBeNull();
});

/* ── Lo que la base impide por su cuenta ────────────────────────────────── */

it('la base rechaza el nombre sin el «sí», aunque lo escriba el código', function (): void {
    /*
    | La validación del formulario se puede saltar: una consola, un comando, un
    | controlador futuro. El CHECK no.
    */
    app(TenantContext::class)->set(null);

    expect(fn () => DB::table('leads')->insert([
        'id' => (string) Str::uuid(),
        'first_name' => 'A',
        'last_name' => 'B',
        'email' => 'check-'.Str::random(6).'@x.test',
        'locale' => 'en',
        'uses_factoring' => 0,
        'factoring_company_name' => 'Esto No Debe Entrar LLC',
        'created_at' => now(),
        'updated_at' => now(),
    ]))->toThrow(QueryException::class);
});

it('la base rechaza la ficha Y el nombre a la vez', function (): void {
    $casa = casaConDominio();
    $ficha = empresaDeFactoring($casa->id, 'Dos Respuestas LLC');

    app(TenantContext::class)->set(null);

    expect(fn () => DB::table('leads')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $casa->id,
        'first_name' => 'A',
        'last_name' => 'B',
        'email' => 'dos-'.Str::random(6).'@x.test',
        'locale' => 'en',
        'uses_factoring' => 1,
        'factoring_company_id' => $ficha,
        'factoring_company_name' => 'Dos Respuestas LLC',
        'created_at' => now(),
        'updated_at' => now(),
    ]))->toThrow(QueryException::class);
});

it('la base rechaza la ficha de otra empresa', function (): void {
    // La clave foránea es compuesta: el par (tenant_id, id) no existe.
    $mia = casaConDominio();
    $vecina = casaConDominio();
    $suya = empresaDeFactoring($vecina->id, 'Ajena LLC');

    app(TenantContext::class)->set(null);

    expect(fn () => DB::table('leads')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $mia->id,
        'first_name' => 'A',
        'last_name' => 'B',
        'email' => 'fk-'.Str::random(6).'@x.test',
        'locale' => 'en',
        'uses_factoring' => 1,
        'factoring_company_id' => $suya,
        'created_at' => now(),
        'updated_at' => now(),
    ]))->toThrow(QueryException::class);
});

it('«sí» sin empresa sigue siendo posible, y la pantalla lo dirá', function (): void {
    /*
    | Un despachador marca la casilla en el panel porque sabe que el
    | transportista factoriza y todavía no sabe con quién. Ese estado es
    | legítimo: lo que NO se hace es fingir que la base lo ha prevenido.
    */
    app(TenantContext::class)->set(null);

    $id = (string) Str::uuid();

    DB::table('leads')->insert([
        'id' => $id,
        'first_name' => 'A',
        'last_name' => 'B',
        'email' => 'solo-si-'.Str::random(6).'@x.test',
        'locale' => 'en',
        'uses_factoring' => 1,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    expect(DB::table('leads')->where('id', $id)->value('uses_factoring'))->toBe(1);
});
