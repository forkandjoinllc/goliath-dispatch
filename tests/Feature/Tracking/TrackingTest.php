<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use App\Support\Tracking\TrackingLinks;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    TenantPolicy::forget();
    $this->scenario = Scenario::create();
});

afterEach(function () {
    app(TenantContext::class)->forget();
    TenantPolicy::forget();
});

/** Pone la carga del escenario en la carretera. */
function cargaRodando(Scenario $scenario): string
{
    DB::table('loads')->where('id', $scenario->load->id)->update([
        'carrier_id' => $scenario->assignedCarrier->id,
        'status' => 'in_transit',
        'planned_delivery_at' => now()->addDays(2),
        'updated_at' => now(),
    ]);

    return (string) $scenario->load->id;
}

/** Crea un enlace y devuelve su token en claro. */
function enlaceDeSeguimiento(Scenario $scenario, string $loadId, ?int $horas = null): string
{
    return app(TenantContext::class)->runAs($scenario->tenant->id, fn (): string => TrackingLinks::issue(
        tenantId: (string) $scenario->tenant->id,
        loadId: $loadId,
        label: 'Cliente de prueba',
        recipientEmail: null,
        ttlHours: $horas,
        createdByUserId: null,
    ));
}

/* ── El tablero ─────────────────────────────────────────────────────────── */

it('el tablero enseña lo que está rodando', function () {
    $id = cargaRodando($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->get('/tracking')->assertOk()->assertInertia(function (Assert $page) use ($id) {
        $ids = collect($page->toArray()['props']['loads'])->pluck('id')->all();

        expect($ids)->toContain($id);
    });
});

it('el tablero no enseña cargas de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    cargaRodando($otra);
    cargaRodando($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->get('/tracking')->assertInertia(function (Assert $page) use ($otra) {
        $ids = collect($page->toArray()['props']['loads'])->pluck('id')->all();

        expect($ids)->not->toContain((string) $otra->load->id);
    });
});

it('marca como atrasada una llamada cuya hora ya pasó', function () {
    $id = cargaRodando($this->scenario);

    DB::table('check_calls')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'load_id' => $id,
        'scheduled_for' => now()->subHours(3),
        'origin' => 'scheduled',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    signIn($this->scenario, Role::Admin);

    $this->get('/tracking?overdue=1')->assertInertia(function (Assert $page) use ($id) {
        $filas = collect($page->toArray()['props']['loads']);

        expect($filas->pluck('id')->all())->toContain($id);
        expect($filas->firstWhere('id', $id)['overdue'])->toBeTrue();
    });
});

it('una carga sin llamadas agendadas NO cuenta como atrasada', function () {
    $id = cargaRodando($this->scenario);

    signIn($this->scenario, Role::Admin);

    // No haber quedado en llamar no es lo mismo que faltar a la llamada.
    $this->get('/tracking?overdue=1')->assertInertia(function (Assert $page) use ($id) {
        expect(collect($page->toArray()['props']['loads'])->pluck('id')->all())->not->toContain($id);
    });
});

/* ── Llamadas de control ────────────────────────────────────────────────── */

it('anota una llamada ya hecha', function () {
    $id = cargaRodando($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$id}/check-calls", [
        'scheduled_for' => now()->toDateTimeString(),
        'origin' => 'manual',
        'completed' => true,
        'location_summary' => 'Laredo, TX — cargando',
        'notes' => 'El conductor dice que sale en una hora',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $fila = DB::table('check_calls')->where('load_id', $id)->first();

    expect($fila->completed_at)->not->toBeNull();
    expect($fila->completed_by_user_id)->toBe($this->scenario->user(Role::Admin)->id);
    expect($fila->origin)->toBe('manual');
});

it('completa una llamada agendada, y solo una vez', function () {
    $id = cargaRodando($this->scenario);
    $llamada = (string) Str::uuid();

    DB::table('check_calls')->insert([
        'id' => $llamada,
        'tenant_id' => $this->scenario->tenant->id,
        'load_id' => $id,
        'scheduled_for' => now()->addHour(),
        'origin' => 'scheduled',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$id}/check-calls/{$llamada}/complete", ['location_summary' => 'San Antonio, TX'])
        ->assertRedirect()
        ->assertSessionHas('success');

    expect(DB::table('check_calls')->where('id', $llamada)->value('completed_at'))->not->toBeNull();

    // La segunda vez no vuelve a escribir: el `whereNull('completed_at')` es lo
    // que impide que un doble clic cambie quién la hizo y cuándo.
    $this->post("/loads/{$id}/check-calls/{$llamada}/complete", [])
        ->assertRedirect()
        ->assertSessionHas('error');
});

it('no deja anotar una llamada en una carga de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    $ajena = cargaRodando($otra);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$ajena}/check-calls", [
        'scheduled_for' => now()->toDateTimeString(),
        'origin' => 'manual',
        'completed' => true,
    ])->assertNotFound();

    expect(DB::table('check_calls')->where('load_id', $ajena)->count())->toBe(0);
});

it('el despachador solo ve las cargas que lleva', function () {
    DB::table('loads')->whereIn('id', [$this->scenario->load->id, $this->scenario->otherLoad->id])
        ->update(['status' => 'in_transit', 'updated_at' => now()]);

    signIn($this->scenario, Role::Admin);
    $delAdmin = 0;
    $this->get('/tracking')->assertInertia(function (Assert $p) use (&$delAdmin) {
        $delAdmin = count($p->toArray()['props']['loads']);
    });

    signIn($this->scenario, Role::Dispatcher);
    $this->get('/tracking')->assertInertia(function (Assert $p) use ($delAdmin) {
        expect(count($p->toArray()['props']['loads']))->toBeLessThan($delAdmin);
    });
});

/* ── El enlace público ──────────────────────────────────────────────────── */

it('el token no se guarda en ninguna parte', function () {
    $id = cargaRodando($this->scenario);
    $token = enlaceDeSeguimiento($this->scenario, $id);

    $fila = DB::table('public_tracking_links')->where('load_id', $id)->first();

    // Ni el token ni nada que se le parezca: solo su sha256. Una copia de
    // seguridad o un volcado de soporte no abren el seguimiento de nadie.
    expect($fila->token_hash)->toBe(hash('sha256', $token));
    expect((array) $fila)->not->toContain($token);
});

it('el enlace en claro llega a la pantalla una vez, y solo una', function () {
    // La bolsa `flash` compartida solo lleva `success` y `error`. Si el token
    // viaja por ahí, el panel dice «cópielo ahora, no se mostrará de nuevo» y
    // no hay nada que copiar: el enlace queda creado y es inalcanzable.
    $id = cargaRodando($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$id}/tracking-links", [
        'label' => 'Cliente Frontera',
        'ttl_hours' => 24,
    ])->assertRedirect();

    $this->get("/loads/{$id}/tracking")
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $url = $page->toArray()['props']['newLinkUrl'];

            expect($url)->toBeString();
            // Con el prefijo del idioma de quien lo reparte: el cliente abre el
            // enlace desde un correo, sin cookie que diga en qué idioma habla.
            expect($url)->toContain('/'.app()->getLocale().'/t/');
        });

    // Al recargar ya no está: era del flash.
    $this->get("/loads/{$id}/tracking")
        ->assertInertia(fn (Assert $page) => $page->where('newLinkUrl', null));
});

it('el enlace abre la página pública sin sesión', function () {
    $id = cargaRodando($this->scenario);
    $token = enlaceDeSeguimiento($this->scenario, $id);

    app(TenantContext::class)->forget();

    $this->get("/t/{$token}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Public/Tracking')
            ->where('state', 'active')
            ->where('load.number', $this->scenario->load->load_number));
});

it('la página pública NO enseña dinero ni notas internas', function () {
    $id = cargaRodando($this->scenario);

    DB::table('loads')->where('id', $id)->update([
        'customer_charge_cents' => 300000,
        'carrier_gross_rate_cents' => 250000,
        'internal_notes' => 'Este cliente paga tarde',
    ]);

    DB::table('check_calls')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'load_id' => $id,
        'scheduled_for' => now()->subHour(),
        'completed_at' => now()->subHour(),
        'origin' => 'manual',
        'location_summary' => 'Laredo, TX',
        'notes' => 'El conductor se quejó del cliente',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $token = enlaceDeSeguimiento($this->scenario, $id);
    app(TenantContext::class)->forget();

    $respuesta = $this->get("/t/{$token}")->assertOk();
    $cuerpo = $respuesta->getContent();

    // Es la única superficie donde un desconocido lee datos de una empresa.
    expect($cuerpo)->not->toContain('300000');
    expect($cuerpo)->not->toContain('250000');
    expect($cuerpo)->not->toContain('paga tarde');
    expect($cuerpo)->not->toContain('se quejó del cliente');
    // El resumen de ubicación SÍ: es justo lo que se escribe para poder
    // contárselo al cliente.
    expect($cuerpo)->toContain('Laredo');
});

it('la ciudad sale aunque la parada solo apunte a una ubicación del cliente', function () {
    // Las cargas creadas desde el panel guardan `customer_location_id` y dejan
    // la ciudad de la parada en NULL: la dirección buena vive en la ubicación
    // del cliente. Sin el join, la página pública no decía de dónde a dónde va,
    // que es lo único que el cliente entra a ver.
    $id = cargaRodando($this->scenario);

    $ubicacion = (string) Str::uuid();
    DB::table('customer_locations')->insert([
        'id' => $ubicacion,
        'tenant_id' => $this->scenario->tenant->id,
        'customer_id' => $this->scenario->customer->id,
        'name' => 'Bodega norte',
        'line1' => '100 Industrial Way',
        'city' => 'Amarillo',
        'state' => 'TX',
        'postal_code' => '79101',
        'country' => 'US',
        'is_primary' => false,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    DB::table('load_stops')
        ->where('load_id', $id)
        ->orderBy('sequence')
        ->limit(1)
        ->update([
            'customer_location_id' => $ubicacion,
            'facility_name' => null,
            'city' => null,
            'state' => null,
            'updated_at' => now(),
        ]);

    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$id}/tracking")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('stops.0.city', 'Amarillo'));

    $token = enlaceDeSeguimiento($this->scenario, $id);
    app(TenantContext::class)->forget();

    expect($this->get("/t/{$token}")->assertOk()->getContent())->toContain('Amarillo');
});

it('el prefijo de idioma del enlace manda sobre el navegador del cliente', function () {
    $id = cargaRodando($this->scenario);
    $token = enlaceDeSeguimiento($this->scenario, $id);

    app(TenantContext::class)->forget();

    // Navegador en inglés, enlace en español: gana el enlace. Quien lo repartió
    // sabe en qué idioma habla su cliente; el navegador de la oficina no.
    $this->withHeaders(['Accept-Language' => 'en-US,en;q=0.9'])
        ->get("/es/t/{$token}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('locale', 'es'));

    $this->withHeaders(['Accept-Language' => 'es-MX,es;q=0.9'])
        ->get("/en/t/{$token}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('locale', 'en'));

    // La forma sin prefijo sigue viva para los enlaces ya repartidos, y ahí sí
    // negocia la cabecera.
    $this->withHeaders(['Accept-Language' => 'es-MX,es;q=0.9'])
        ->get("/t/{$token}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('locale', 'es'));
});

it('un enlace vencido no abre, y lo dice', function () {
    $id = cargaRodando($this->scenario);
    $token = enlaceDeSeguimiento($this->scenario, $id, 1);

    DB::table('public_tracking_links')->where('load_id', $id)
        ->update(['expires_at' => now()->subHour()]);

    app(TenantContext::class)->forget();

    $this->get("/t/{$token}")
        ->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page->where('state', 'expired')->where('load', null));
});

it('un enlace revocado deja de abrir de inmediato', function () {
    $id = cargaRodando($this->scenario);
    $token = enlaceDeSeguimiento($this->scenario, $id);

    signIn($this->scenario, Role::Admin);

    $enlace = DB::table('public_tracking_links')->where('load_id', $id)->value('id');

    $this->post("/loads/{$id}/tracking-links/{$enlace}/revoke")
        ->assertRedirect()
        ->assertSessionHas('success');

    app(TenantContext::class)->forget();

    $this->get("/t/{$token}")
        ->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page->where('state', 'revoked'));
});

it('un token inventado no dice si alguna vez existió', function () {
    app(TenantContext::class)->forget();

    $this->get('/t/'.Str::random(48))
        ->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page->where('state', 'not_found'));
});

it('apagar el rastreo público apaga también los enlaces ya repartidos', function () {
    $id = cargaRodando($this->scenario);
    $token = enlaceDeSeguimiento($this->scenario, $id);

    DB::table('tenant_settings')->where('tenant_id', $this->scenario->tenant->id)
        ->update(['public_tracking_enabled' => 0]);
    TenantPolicy::forget();

    app(TenantContext::class)->forget();

    // Si apagarlo solo impidiera crear nuevos, el ajuste no serviría para lo
    // que uno lo apaga.
    $this->get("/t/{$token}")
        ->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page->where('state', 'disabled'));
});

it('cuenta las visitas', function () {
    $id = cargaRodando($this->scenario);
    $token = enlaceDeSeguimiento($this->scenario, $id);

    app(TenantContext::class)->forget();

    $this->get("/t/{$token}")->assertOk();
    $this->get("/t/{$token}")->assertOk();

    $fila = DB::table('public_tracking_links')->where('load_id', $id)->first();

    expect((int) $fila->view_count)->toBe(2);
    expect($fila->last_viewed_at)->not->toBeNull();
});

it('respeta las horas de caducidad de los ajustes de la empresa', function () {
    DB::table('tenant_settings')->where('tenant_id', $this->scenario->tenant->id)
        ->update(['public_tracking_token_ttl_hours' => 5]);
    TenantPolicy::forget();

    $id = cargaRodando($this->scenario);
    enlaceDeSeguimiento($this->scenario, $id);

    $vence = DB::table('public_tracking_links')->where('load_id', $id)->value('expires_at');

    // Cinco horas, no las setenta y dos por defecto: el ajuste llevaba desde el
    // primer día guardándose sin que nadie lo leyera.
    expect(\Carbon\CarbonImmutable::parse((string) $vence)->diffInHours(now()))->toBeLessThan(6);
});

it('no deja crear un enlace a quien no puede', function () {
    $id = cargaRodando($this->scenario);

    // El conductor tiene `tracking:read` con alcance propio y ningún permiso de
    // enlaces: el enlace público es material que sale de la casa.
    signIn($this->scenario, Role::Driver);

    $this->post("/loads/{$id}/tracking-links", ['label' => 'Mío'])->assertRedirect();

    expect(DB::table('public_tracking_links')->where('load_id', $id)->count())->toBe(0);
});
