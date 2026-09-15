<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * La comisión que se resta del margen, o tiene dueño o se sabe que no.
 *
 * El guardián de `tests/Unit/Suite/CommissionOwnerTest.php` sujeta la
 * estructura. Esto mide el dinero: que una carga dada de alta por un
 * administrador ya no se queda sin dueño en silencio, que asignarlo hace que la
 * comisión se devengue de verdad, y que no se puede poner de dueño a cualquiera.
 *
 * Nota sobre `CommissionTest`, que es de otro lote: su ayudante escribe
 * `dispatcher_user_id` A MANO en la tabla, con este comentario — «el escenario
 * no lo pone porque sus cargas no se despachan a mano». Tenía razón y ahí estaba
 * el defecto a la vista: la suite llevaba lotes plantando lo que la aplicación
 * no sabía producir.
 */
function cargaParaComision(Scenario $s, ?string $duenoId): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $duenoId): string {
        DB::table('loads')->where('id', $s->load->id)->update([
            'carrier_id' => $s->assignedCarrier->id,
            'dispatcher_user_id' => $duenoId,
            'status' => 'delivered',
            'actual_delivery_at' => now()->subDay(),
            'customer_charge_cents' => 300000,
            'carrier_gross_rate_cents' => 250000,
            'carrier_dispatch_fee_bps' => 1000,
            'dispatcher_commission_bps' => 2500,
            'dispatcher_commission_basis' => 'dispatch_fee_amount',
            'updated_at' => now(),
        ]);

        return (string) $s->load->id;
    });
}

/**
 * El cuerpo mínimo que acepta `PATCH /loads/{id}`.
 *
 * La actualización valida el flete ENTERO cuando quien la hace puede editarlo,
 * así que mandar solo `dispatcher_user_id` devuelve errores de campos que no
 * venían a cuento. Mi primera versión de estas pruebas lo mandaba solo, y los
 * fallos parecían del campo nuevo.
 *
 * @param  array<string, mixed>  $extra
 * @return array<string, mixed>
 */
function cuerpoDeCarga(Scenario $s, array $extra = []): array
{
    return [
        'customer_id' => (string) $s->customer->id,
        'commodity' => 'Acero',
        'weight_pounds' => 42000,
        'customer_charge_cents' => 300000,
        // Y el dinero, porque `loadColumns()` lo escribe con `?? 0`: un PATCH
        // que no los traiga pone la tarifa del transportista a cero, y entonces
        // la comisión sale cero y la prueba falla por el motivo equivocado.
        'carrier_gross_rate_cents' => 250000,
        'carrier_dispatch_fee_bps' => 1000,
        'dispatcher_commission_bps' => 2500,
        'stops' => [
            ['stop_type' => 'pickup', 'city' => 'Laredo', 'state' => 'TX', 'country' => 'US'],
            ['stop_type' => 'delivery', 'city' => 'Dallas', 'state' => 'TX', 'country' => 'US'],
        ],
        ...$extra,
    ];
}

function facturarCarga(Scenario $s, string $loadId): void
{
    test()->post('/invoices', [
        'carrier_id' => $s->assignedCarrier->id,
        'load_ids' => [$loadId],
    ])->assertRedirect()->assertSessionHasNoErrors();
}

/** @return list<object> */
function comisionesDe(Scenario $s, string $loadId): array
{
    return app(TenantContext::class)->runAs($s->tenant->id, fn (): array => DB::table('dispatcher_commissions')
        ->where('load_id', $loadId)
        ->get(['id', 'dispatcher_user_id', 'amount_cents'])
        ->all());
}

it('una carga sin dueño no devenga comisión, pero DEJA CONSTANCIA', function () {
    $carga = cargaParaComision($this->scenario, null);

    signIn($this->scenario, Role::Admin);
    facturarCarga($this->scenario, $carga);

    // Lo de siempre: no hay a quién pagarle, así que no hay fila.
    expect(comisionesDe($this->scenario, $carga))->toBe([]);

    // Lo NUEVO: el hecho queda escrito. Antes esto se iba en un `return null`
    // sin frase, y seis meses después nadie podía contestar por qué el informe
    // decía que se ganó menos sin que hubiera comisión que pagar.
    $rastro = app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => DB::table('audit_events')
        ->where('entity_type', 'load')
        ->where('entity_id', $carga)
        ->get(['after_summary'])
        ->filter(fn ($r): bool => str_contains((string) $r->after_summary, 'notSetAtCreation'))
        ->values());

    expect($rastro)->toHaveCount(1, 'facturar sin dueño de comisión no dejó rastro');
    // El JSON de la columna lleva espacios tras los dos puntos: buscar
    // `"accrued":false` no casa nunca y la comprobación pasaría siempre si
    // fuera en negativo.
    expect((string) $rastro[0]->after_summary)->toContain('"accrued": false');
});

it('con dueño se devenga, y a esa persona', function () {
    $despachador = $this->scenario->user(Role::Dispatcher);
    $carga = cargaParaComision($this->scenario, (string) $despachador->id);

    signIn($this->scenario, Role::Admin);
    facturarCarga($this->scenario, $carga);

    $comisiones = comisionesDe($this->scenario, $carga);

    expect($comisiones)->toHaveCount(1);
    expect((string) $comisiones[0]->dispatcher_user_id)->toBe((string) $despachador->id);
    // 10 % de 250.000 = 25.000 de tarifa; 25 % de eso = 6.250.
    expect((int) $comisiones[0]->amount_cents)->toBe(6250);
});

it('el administrador puede asignar el dueño desde la carga', function () {
    $despachador = $this->scenario->user(Role::Dispatcher);
    $carga = cargaParaComision($this->scenario, null);

    signIn($this->scenario, Role::Admin);

    // Esta es la puerta que no existía: la columna solo se escribía al crear la
    // carga, y solo si quien la creaba era despachador.
    $this->patch("/loads/{$carga}", cuerpoDeCarga($this->scenario, [
        'dispatcher_user_id' => (string) $despachador->id,
    ]))->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($carga, $despachador): void {
        expect((string) DB::table('loads')->where('id', $carga)->value('dispatcher_user_id'))
            ->toBe((string) $despachador->id);
    });

    facturarCarga($this->scenario, $carga);

    expect(comisionesDe($this->scenario, $carga))->toHaveCount(1);
});

it('no se puede poner de dueño a quien no es despachador de la empresa', function () {
    $carga = cargaParaComision($this->scenario, null);
    $contable = $this->scenario->user(Role::Accounting);

    signIn($this->scenario, Role::Admin);

    // `size:36` deja pasar cualquier uuid. Contabilidad no despacha, así que su
    // comisión no la reclamaría nadie.
    $this->patch("/loads/{$carga}", cuerpoDeCarga($this->scenario, [
        'dispatcher_user_id' => (string) $contable->id,
    ]))->assertSessionHasErrors('dispatcher_user_id');

    // Y un id de fuera, tampoco.
    $this->patch("/loads/{$carga}", cuerpoDeCarga($this->scenario, [
        'dispatcher_user_id' => (string) Str::uuid(),
    ]))->assertSessionHasErrors('dispatcher_user_id');
});

it('un despachador suspendido deja de poder ser dueño', function () {
    $despachador = $this->scenario->user(Role::Dispatcher);
    $carga = cargaParaComision($this->scenario, null);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($despachador): void {
        DB::table('user_tenant_memberships')
            ->where('user_id', $despachador->id)
            ->update(['status' => 'suspended']);
    });

    signIn($this->scenario, Role::Admin);

    // Asignarle la comisión a quien ya no trabaja aquí es el mismo defecto con
    // otra ropa: dinero restado del margen que nadie va a reclamar.
    $this->patch("/loads/{$carga}", cuerpoDeCarga($this->scenario, [
        'dispatcher_user_id' => (string) $despachador->id,
    ]))->assertSessionHasErrors('dispatcher_user_id');
});

it('quien no puede tocar el dinero no puede decidir a quién se le paga', function () {
    $despachador = $this->scenario->user(Role::Dispatcher);
    $carga = cargaParaComision($this->scenario, null);

    // El despachador crea cargas y NO tiene load:financials:update.
    signIn($this->scenario, Role::Dispatcher);

    $this->patch("/loads/{$carga}", cuerpoDeCarga($this->scenario, [
        'dispatcher_user_id' => (string) $despachador->id,
    ]));

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($carga): void {
        expect(DB::table('loads')->where('id', $carga)->value('dispatcher_user_id'))->toBeNull();
    });
});

it('la pantalla del dinero avisa de la comisión sin dueño', function () {
    $carga = cargaParaComision($this->scenario, null);

    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$carga}")->assertOk()->assertInertia(fn ($page) => $page
        ->where('financials.commissionOrphaned', true)
        ->where('financials.commissionOwner', null)
        ->where('financials.commissionOwnerMissing', 'notSetAtCreation'));
});

it('con dueño la pantalla no avisa de nada', function () {
    $despachador = $this->scenario->user(Role::Dispatcher);
    $carga = cargaParaComision($this->scenario, (string) $despachador->id);

    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$carga}")->assertOk()->assertInertia(fn ($page) => $page
        ->where('financials.commissionOrphaned', false)
        ->where('financials.commissionOwnerMissing', null));
});

it('al dar de alta una carga se puede elegir dueño desde el primer momento', function () {
    $despachador = $this->scenario->user(Role::Dispatcher);

    signIn($this->scenario, Role::Admin);

    // El administrador no es despachador, así que la regla vieja le habría
    // puesto `null` pasara lo que pasara. Ahora lo que diga el formulario manda,
    // y lo de siempre sigue valiendo como valor por defecto.
    $this->post('/loads', cuerpoDeCarga($this->scenario, [
        'dispatcher_user_id' => (string) $despachador->id,
    ]))->assertRedirect()->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($despachador): void {
        $nueva = DB::table('loads')->orderByDesc('created_at')->first(['dispatcher_user_id']);

        expect((string) $nueva->dispatcher_user_id)->toBe((string) $despachador->id);
    });
});

it('un despachador que crea una carga sigue quedándose su comisión', function () {
    signIn($this->scenario, Role::Dispatcher);

    // Sin decir nada: es lo que hacía y está bien. Lo que no puede es ser la
    // única forma de que una carga tenga dueño.
    $this->post('/loads', cuerpoDeCarga($this->scenario))
        ->assertRedirect()->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        $nueva = DB::table('loads')->orderByDesc('created_at')->first(['dispatcher_user_id']);

        expect((string) $nueva->dispatcher_user_id)
            ->toBe((string) $this->scenario->user(Role::Dispatcher)->id);
    });
});
