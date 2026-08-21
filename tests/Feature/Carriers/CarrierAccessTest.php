<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

/*
|--------------------------------------------------------------------------
| ADVERTENCIA
|--------------------------------------------------------------------------
|
| Estas pruebas NO se han ejecutado nunca. El contenedor donde se escribieron no
| puede instalar Pest: composer exige autenticarse contra GitHub para las
| dependencias de desarrollo.
|
| Lo que sí está comprobado es el COMPORTAMIENTO que afirman: cada aserción de
| este fichero se observó a mano contra la aplicación en marcha, con peticiones
| HTTP reales y con navegador. Lo que puede fallar es la sintaxis de la prueba —
| un método mal escrito, una aserción de Inertia con otra firma— no lo que
| espera.
|
| Ejecútelas y arregle lo que se rompa; si algo falla por el VALOR esperado y no
| por la forma, eso sí es una regresión de verdad.
|
*/

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/* ── Quién puede siquiera abrir el listado ──────────────────────────────── */

it('deja entrar al listado a quien tiene carrier:read', function (Role $role, string $scope, int $total) {
    signIn($this->scenario, $role);

    $this->get('/carriers')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Carriers/Index')
            ->where('scope', $scope)
            ->where('carriers.meta.total', $total));
})->with([
    'admin ve la empresa entera' => [Role::Admin, 'tenant', 2],
    'contabilidad también' => [Role::Accounting, 'tenant', 2],
    'el despachador solo su cartera' => [Role::Dispatcher, 'assigned', 1],
    'el transportista solo el suyo' => [Role::Carrier, 'carrier', 1],
]);

it('niega el listado al conductor, que no tiene carrier:read', function () {
    signIn($this->scenario, Role::Driver);

    $this->get('/carriers')
        ->assertForbidden()
        ->assertInertia(fn (Assert $page) => $page->component('App/Denied'));
});

/* ── El estrechamiento va en la CONSULTA, no en la pantalla ─────────────── */

it('el total del despachador cuenta solo lo asignado, no lo que hay', function () {
    signIn($this->scenario, Role::Dispatcher);

    // Es la diferencia entre estrechar la consulta y filtrar después. Con un
    // filtro posterior el total diría 2 y la lista enseñaría 1, y ese número
    // sería una fuga: dice cuántos transportistas tiene la empresa a quien solo
    // puede ver uno.
    $this->get('/carriers')->assertInertia(fn (Assert $page) => $page
        ->where('carriers.meta.total', 1)
        ->has('carriers.data', 1)
        ->where('carriers.data.0.id', $this->scenario->assignedCarrier->id));
});

it('las facetas del filtro se cuentan dentro del ámbito', function () {
    signIn($this->scenario, Role::Dispatcher);

    // El transportista asignado está aprobado; el otro, en borrador. Un
    // despachador que viera «borrador: 1» sabría de la existencia del que no
    // lleva.
    $this->get('/carriers')->assertInertia(fn (Assert $page) => $page
        ->where('facets.approved', 1)
        ->where('facets.draft', 0));
});

/* ── La URL escrita a mano ──────────────────────────────────────────────── */

it('el despachador abre el transportista que lleva', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get("/carriers/{$this->scenario->assignedCarrier->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('App/Carriers/Show'));
});

it('el despachador NO abre por URL uno que no lleva', function () {
    signIn($this->scenario, Role::Dispatcher);

    // El listado no se lo enseña, pero un enlace escrito a mano sí llegaría
    // aquí. Esta es la comprobación que de verdad lo impide.
    $this->get("/carriers/{$this->scenario->otherCarrier->id}")
        ->assertForbidden()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Denied')
            ->where('permission', 'carrier:read'));
});

it('el transportista no abre la ficha de otro transportista', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get("/carriers/{$this->scenario->otherCarrier->id}")->assertForbidden();
});

/* ── Crear ──────────────────────────────────────────────────────────────── */

it('contabilidad no puede crear transportistas', function () {
    signIn($this->scenario, Role::Accounting);

    $this->post('/carriers', carrierPayload())->assertRedirect()->assertSessionHas('error');
});

it('el admin crea, y nace en borrador pase lo que pase', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/carriers', [...carrierPayload(), 'onboarding_status' => 'approved'])
        ->assertRedirect();

    $created = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn () => App\Models\Carrier::query()->where('dot_number', '7009999')->first()
    );

    // Que un transportista entre ya aprobado es exactamente lo que el alta
    // existe para impedir, así que el campo del formulario no manda.
    expect($created)->not->toBeNull()
        ->and($created->onboarding_status->value)->toBe('draft')
        ->and($created->fmcsa_status->value)->toBe('not_started');
});

it('el USDOT no se puede repetir dentro de la misma empresa', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/carriers', [...carrierPayload(), 'dot_number' => '7000001'])
        ->assertSessionHasErrors('dot_number');
});

/* ── La tarifa de despacho tiene permiso propio ─────────────────────────── */

it('el despachador puede editar un transportista asignado pero no su tarifa', function () {
    signIn($this->scenario, Role::Dispatcher);

    $carrier = $this->scenario->assignedCarrier;

    $this->patch("/carriers/{$carrier->id}", [
        'legal_name' => 'Asignado LLC (editado)',
        'dot_number' => $carrier->dot_number,
        'contact_first_name' => 'Ana',
        'contact_last_name' => 'Díaz',
        'email' => $carrier->email,
        'phone' => '+15550100',
        'preferred_locale' => 'es',
        'dispatch_fee_bps' => 9999,
    ])->assertRedirect();

    $fresh = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn () => App\Models\Carrier::query()->find($carrier->id)
    );

    // El nombre sí cambia: tiene carrier:update sobre lo asignado. La tarifa no:
    // es dinero y tiene su propio permiso, y el controlador descarta el campo
    // aunque llegue en la petición.
    expect($fresh->legal_name)->toBe('Asignado LLC (editado)')
        ->and((int) $fresh->dispatch_fee_bps)->toBe(1000);
});

it('el admin sí cambia la tarifa, y queda en la pista de auditoría', function () {
    signIn($this->scenario, Role::Admin);

    $carrier = $this->scenario->assignedCarrier;

    $this->patch("/carriers/{$carrier->id}", [
        'legal_name' => $carrier->legal_name,
        'dot_number' => $carrier->dot_number,
        'contact_first_name' => 'Ana',
        'contact_last_name' => 'Díaz',
        'email' => $carrier->email,
        'phone' => '+15550100',
        'preferred_locale' => 'es',
        'dispatch_fee_bps' => 1250,
    ])->assertRedirect();

    $event = DB::table('audit_events')
        ->where('action', 'financial.changed')
        ->where('entity_id', $carrier->id)
        ->first();

    expect($event)->not->toBeNull()
        ->and(json_decode((string) $event->before_summary, true))->toBe(['dispatch_fee_bps' => 1000])
        ->and(json_decode((string) $event->after_summary, true))->toBe(['dispatch_fee_bps' => 1250]);
});

/**
 * @return array<string, mixed>
 */
function carrierPayload(): array
{
    return [
        'legal_name' => 'Nuevo Transportista LLC',
        'dot_number' => '7009999',
        'contact_first_name' => 'Beto',
        'contact_last_name' => 'Ruiz',
        'email' => 'nuevo@escenario.test',
        'phone' => '+15550199',
        'preferred_locale' => 'en',
    ];
}
