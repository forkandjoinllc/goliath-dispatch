<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
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

/**
 * Escribe una entrada en la pista a mano.
 *
 * A mano y no llamando a Audit::record() a propósito: estas pruebas comprueban
 * la PANTALLA, y necesitan poder poner una fila de otra empresa, con una fecha
 * de hace un año o con la misma petición que otra. Ninguna de las tres cosas se
 * puede montar pasando por el escritor, que siempre usa el actor y el ahora.
 */
function rastro(string $tenantId, array $overrides = []): string
{
    $id = (string) Str::uuid();

    DB::table('audit_events')->insert([
        'id' => $id,
        'tenant_id' => $tenantId,
        'action' => 'load.created',
        'entity_type' => 'load',
        'entity_id' => (string) Str::uuid(),
        'entity_label' => 'GD-99999',
        'occurred_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
        ...$overrides,
    ]);

    return $id;
}

/**
 * La carga entera del formulario de ajustes.
 *
 * Se repite aquí en vez de reutilizar la de `TenantSettingTest` porque Pest
 * carga los ficheros de prueba en un espacio global común: reutilizarla ataría
 * este fichero a que el otro esté cargado, y ejecutar este solo —que es lo que
 * se hace al depurar— fallaría con «función no definida».
 */
function ajustesParaAuditoria(array $overrides = []): array
{
    return array_merge([
        'dispatch_fee_base' => 'commissionable_base',
        'default_carrier_dispatch_fee_bps' => 1200,
        'default_dispatcher_commission_bps' => 2000,
        'dispatcher_commission_basis' => 'dispatch_fee_amount',
        'default_payment_terms_days' => 15,
        'load_number_prefix' => 'FJ',
        'invoice_number_prefix' => 'FAC',
        'document_expiration_warning_days' => 20,
        'fmcsa_reverification_days' => 7,
        'allow_dispatcher_resource_assignment' => false,
        'require_oversize_admin_validation' => true,
        'public_tracking_enabled' => true,
        'public_tracking_token_ttl_hours' => 72,
        'address_country' => 'US',
        'address_state' => 'TX',
    ], $overrides);
}

/* ── Quién puede mirar ──────────────────────────────────────────────────── */

it('deja mirar la pista al administrador', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/audit')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('App/Audit/Index'));
});

it('deja mirar la pista a contabilidad', function () {
    signIn($this->scenario, Role::Accounting);

    $this->get('/audit')->assertOk();
});

it('no deja mirar la pista al despachador', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/audit')
        ->assertForbidden()
        ->assertInertia(fn (Assert $page) => $page->component('App/Denied'));
});

it('no deja mirar la pista al transportista', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get('/audit')->assertForbidden();
});

/* ── La frontera de empresa ─────────────────────────────────────────────── */

it('no enseña los eventos de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    $mio = rastro($this->scenario->tenant->id, ['entity_label' => 'MIA-1']);
    rastro($otra->tenant->id, ['entity_label' => 'AJENA-1']);

    signIn($this->scenario, Role::Admin);

    $this->get('/audit')->assertInertia(function (Assert $page) use ($mio) {
        $ids = collect($page->toArray()['props']['events']['data'])->pluck('id')->all();

        expect($ids)->toContain($mio);

        $etiquetas = collect($page->toArray()['props']['events']['data'])->pluck('entityLabel')->all();
        expect($etiquetas)->not->toContain('AJENA-1');
    });
});

it('devuelve 404 al abrir un evento de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    $ajeno = rastro($otra->tenant->id);

    signIn($this->scenario, Role::Admin);

    $this->get("/audit/{$ajeno}")->assertNotFound();
});

it('no ofrece en los filtros acciones que solo existen en otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    rastro($otra->tenant->id, ['action' => 'legal_hold.applied', 'entity_type' => 'document']);

    signIn($this->scenario, Role::Admin);

    $this->get('/audit')->assertInertia(function (Assert $page) {
        expect($page->toArray()['props']['actions'])->not->toContain('legal_hold.applied');
    });
});

/* ── Filtros ────────────────────────────────────────────────────────────── */

it('filtra por acción', function () {
    rastro($this->scenario->tenant->id, ['action' => 'load.created', 'entity_label' => 'CREADA']);
    rastro($this->scenario->tenant->id, ['action' => 'load.cancelled', 'entity_label' => 'CANCELADA']);

    signIn($this->scenario, Role::Admin);

    $this->get('/audit?action=load.cancelled')->assertInertia(function (Assert $page) {
        $etiquetas = collect($page->toArray()['props']['events']['data'])->pluck('entityLabel')->all();

        expect($etiquetas)->toContain('CANCELADA')->not->toContain('CREADA');
    });
});

it('filtra por persona', function () {
    $admin = $this->scenario->user(Role::Admin);

    rastro($this->scenario->tenant->id, ['actor_user_id' => $admin->id, 'entity_label' => 'SUYA']);
    rastro($this->scenario->tenant->id, ['entity_label' => 'DE-NADIE']);

    signIn($this->scenario, Role::Admin);

    $this->get("/audit?actor={$admin->id}")->assertInertia(function (Assert $page) {
        $etiquetas = collect($page->toArray()['props']['events']['data'])->pluck('entityLabel')->all();

        expect($etiquetas)->toContain('SUYA')->not->toContain('DE-NADIE');
    });
});

it('filtra por fecha', function () {
    rastro($this->scenario->tenant->id, [
        'entity_label' => 'ANTIGUA',
        'occurred_at' => now()->subYear(),
    ]);
    rastro($this->scenario->tenant->id, ['entity_label' => 'RECIENTE']);

    signIn($this->scenario, Role::Admin);

    $desde = now()->subDays(7)->toDateString();

    $this->get("/audit?from={$desde}")->assertInertia(function (Assert $page) {
        $etiquetas = collect($page->toArray()['props']['events']['data'])->pluck('entityLabel')->all();

        expect($etiquetas)->toContain('RECIENTE')->not->toContain('ANTIGUA');
    });
});

it('busca por etiqueta, correo y motivo', function () {
    rastro($this->scenario->tenant->id, ['entity_label' => 'GD-12345']);
    rastro($this->scenario->tenant->id, ['entity_label' => 'OTRA-COSA', 'reason' => 'cliente lo pidió']);

    signIn($this->scenario, Role::Admin);

    $this->get('/audit?q=12345')->assertInertia(function (Assert $page) {
        $etiquetas = collect($page->toArray()['props']['events']['data'])->pluck('entityLabel')->all();

        expect($etiquetas)->toContain('GD-12345')->not->toContain('OTRA-COSA');
    });

    $this->get('/audit?q=cliente')->assertInertia(function (Assert $page) {
        $etiquetas = collect($page->toArray()['props']['events']['data'])->pluck('entityLabel')->all();

        expect($etiquetas)->toContain('OTRA-COSA')->not->toContain('GD-12345');
    });
});

it('trata el comodín de LIKE como texto y no como comodín', function () {
    rastro($this->scenario->tenant->id, ['entity_label' => 'GD-12345']);

    signIn($this->scenario, Role::Admin);

    // Sin escapar, `%` casaría con TODO y la búsqueda devolvería la pista
    // entera — que es justo lo contrario de buscar.
    $this->get('/audit?q=%25')->assertInertia(function (Assert $page) {
        expect($page->toArray()['props']['events']['data'])->toBeEmpty();
    });
});

/* ── El detalle ─────────────────────────────────────────────────────────── */

it('enseña el antes y el después del evento', function () {
    $id = rastro($this->scenario->tenant->id, [
        'action' => 'financial.changed',
        'before_summary' => json_encode(['customer_charge_cents' => 100000]),
        'after_summary' => json_encode(['customer_charge_cents' => 125000]),
    ]);

    signIn($this->scenario, Role::Admin);

    $this->get("/audit/{$id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Audit/Show')
            ->where('event.before.customer_charge_cents', 100000)
            ->where('event.after.customer_charge_cents', 125000));
});

it('aguanta un resumen que no es JSON válido', function () {
    // La tabla es de solo añadir: una fila mal formada de hace meses no se
    // puede corregir NUNCA, así que la pantalla tiene que poder con ella.
    $id = rastro($this->scenario->tenant->id, ['before_summary' => null, 'after_summary' => null]);

    signIn($this->scenario, Role::Admin);

    $this->get("/audit/{$id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('event.before', null));
});

it('agrupa por petición los eventos de una misma acción', function () {
    $peticion = (string) Str::uuid();

    $principal = rastro($this->scenario->tenant->id, [
        'request_id' => $peticion,
        'entity_label' => 'PRINCIPAL',
    ]);
    rastro($this->scenario->tenant->id, [
        'request_id' => $peticion,
        'action' => 'financial.changed',
        'entity_label' => 'HERMANA',
    ]);

    signIn($this->scenario, Role::Admin);

    $this->get("/audit/{$principal}")->assertInertia(function (Assert $page) {
        $hermanas = collect($page->toArray()['props']['siblings'])->pluck('entityLabel')->all();

        expect($hermanas)->toContain('HERMANA')->not->toContain('PRINCIPAL');
    });
});

it('no cruza empresas al agrupar por petición', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    // Mismo `request_id` en dos empresas es improbable, pero la frontera no
    // puede depender de que un identificador sea improbable.
    $peticion = (string) Str::uuid();

    $mio = rastro($this->scenario->tenant->id, ['request_id' => $peticion]);
    rastro($otra->tenant->id, ['request_id' => $peticion, 'entity_label' => 'AJENA']);

    signIn($this->scenario, Role::Admin);

    $this->get("/audit/{$mio}")->assertInertia(function (Assert $page) {
        $hermanas = collect($page->toArray()['props']['siblings'])->pluck('entityLabel')->all();

        expect($hermanas)->not->toContain('AJENA');
    });
});

it('marca los eventos hechos con acceso de soporte', function () {
    $id = rastro($this->scenario->tenant->id, [
        'impersonation_session_id' => (string) Str::uuid(),
    ]);

    signIn($this->scenario, Role::Admin);

    $this->get("/audit/{$id}")
        ->assertInertia(fn (Assert $page) => $page->where('event.impersonated', true));
});

/* ── Que lo que escribe la aplicación llegue a la pantalla ──────────────── */

it('enseña un cambio de ajustes hecho de verdad por la aplicación', function () {
    signIn($this->scenario, Role::Admin);

    // Carga entera y `assertSessionHasNoErrors`: `assertRedirect()` a secas
    // pasa también cuando la validación rechaza el formulario, y entonces esta
    // prueba estaría comprobando que una acción que NO ocurrió no dejó rastro.
    $this->patch('/settings', ajustesParaAuditoria(['default_payment_terms_days' => 45]))
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    $this->get('/audit?action=settings.updated')->assertInertia(function (Assert $page) {
        $filas = collect($page->toArray()['props']['events']['data']);

        expect($filas)->not->toBeEmpty();
        expect($filas->first()['entityType'])->toBe('tenant_settings');
    });
});

/* ── Paginación ─────────────────────────────────────────────────────────── */

it('reparte en páginas y deja llegar a la segunda', function () {
    for ($i = 0; $i < 45; $i++) {
        rastro($this->scenario->tenant->id, [
            'entity_label' => 'FILA-'.str_pad((string) $i, 3, '0', STR_PAD_LEFT),
        ]);
    }

    signIn($this->scenario, Role::Admin);

    $this->get('/audit')->assertInertia(function (Assert $page) {
        $meta = $page->toArray()['props']['events']['meta'];

        expect($meta['lastPage'])->toBeGreaterThan(1);
        expect($meta['perPage'])->toBe(40);
        expect($page->toArray()['props']['events']['data'])->toHaveCount(40);
    });

    $this->get('/audit?page=2')->assertInertia(function (Assert $page) {
        expect($page->toArray()['props']['events']['meta']['currentPage'])->toBe(2);
        expect($page->toArray()['props']['events']['data'])->not->toBeEmpty();
    });
});
