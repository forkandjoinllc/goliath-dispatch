<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Una carga entregada, con despachador asignado.
 *
 * El despachador importa: sin `dispatcher_user_id` no hay comisión de nadie, y
 * el escenario no lo pone porque sus cargas no se despachan a mano.
 */
function cargaConDespachador(Scenario $scenario): object
{
    DB::table('loads')->where('id', $scenario->load->id)->update([
        'carrier_id' => $scenario->assignedCarrier->id,
        'dispatcher_user_id' => $scenario->user(Role::Dispatcher)->id,
        'status' => 'delivered',
        'actual_delivery_at' => now()->subDay(),
        'customer_charge_cents' => 300000,
        'carrier_gross_rate_cents' => 250000,
        'carrier_dispatch_fee_bps' => 1000,
        'dispatcher_commission_bps' => 2500,
        'dispatcher_commission_basis' => 'dispatch_fee_amount',
        'updated_at' => now(),
    ]);

    return DB::table('loads')->where('id', $scenario->load->id)->first();
}

function facturarConComision(Scenario $scenario): string
{
    $carga = cargaConDespachador($scenario);

    test()->post('/invoices', [
        'carrier_id' => $scenario->assignedCarrier->id,
        'load_ids' => [$carga->id],
    ])->assertRedirect()->assertSessionHasNoErrors();

    return (string) DB::table('invoices')->orderByDesc('created_at')->value('id');
}

/* ── El devengo ────────────────────────────────────────────────────────── */

it('facturar DEVENGA la comisión del despachador', function () {
    signIn($this->scenario, Role::Admin);
    facturarConComision($this->scenario);

    $c = DB::table('dispatcher_commissions')
        ->where('load_id', $this->scenario->load->id)
        ->first();

    // Tarifa de despacho: 10 % de 250.000 = 25.000. Comisión: 25 % de eso.
    expect($c)->not->toBeNull()
        ->and((int) $c->basis_amount_cents)->toBe(25000)
        ->and((int) $c->percentage_bps)->toBe(2500)
        ->and((int) $c->amount_cents)->toBe(6250)
        ->and($c->basis)->toBe('dispatch_fee_amount')
        ->and($c->status)->toBe('accrued')
        ->and($c->financial_snapshot_id)->not->toBeNull();
});

it('una carga SIN despachador no devenga nada', function () {
    signIn($this->scenario, Role::Admin);

    DB::table('loads')->where('id', $this->scenario->load->id)->update([
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'dispatcher_user_id' => null,
        'status' => 'delivered',
        'actual_delivery_at' => now()->subDay(),
        'updated_at' => now(),
    ]);

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$this->scenario->load->id],
    ])->assertRedirect();

    expect(DB::table('dispatcher_commissions')->count())->toBe(0);
});

it('refacturar la misma instantánea NO paga dos veces', function () {
    signIn($this->scenario, Role::Admin);
    $id = facturarConComision($this->scenario);

    expect(DB::table('dispatcher_commissions')->count())->toBe(1);

    // Se anula y se vuelve a facturar: la instantánea es la misma, así que el
    // índice único del esquema impide un segundo devengo.
    $this->post("/invoices/{$id}/void", ['reason' => 'Número de factura equivocado.'])
        ->assertRedirect();

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$this->scenario->load->id],
    ])->assertRedirect();

    expect(DB::table('dispatcher_commissions')->count())->toBe(1);
});

it('la comisión NO se recalcula después', function () {
    signIn($this->scenario, Role::Admin);
    facturarConComision($this->scenario);

    // Se cambia el porcentaje de la carga DESPUÉS de facturar.
    DB::table('loads')->where('id', $this->scenario->load->id)
        ->update(['dispatcher_commission_bps' => 5000, 'updated_at' => now()]);

    // Lo devengado no se mueve: se le debe a una persona lo que se acordó.
    expect((int) DB::table('dispatcher_commissions')
        ->where('load_id', $this->scenario->load->id)
        ->value('amount_cents'))->toBe(6250);
});

/* ── Pagar ─────────────────────────────────────────────────────────────── */

it('marcar pagado cierra el bloque del despachador', function () {
    signIn($this->scenario, Role::Admin);
    facturarConComision($this->scenario);

    $this->post('/commissions/pay', [
        'dispatcher_user_id' => $this->scenario->user(Role::Dispatcher)->id,
        'status' => 'accrued',
    ])->assertRedirect();

    $c = DB::table('dispatcher_commissions')->where('load_id', $this->scenario->load->id)->first();

    expect($c->status)->toBe('paid')
        ->and($c->paid_at)->not->toBeNull();
});

it('lo ya pagado no se paga otra vez', function () {
    signIn($this->scenario, Role::Admin);
    facturarConComision($this->scenario);

    $datos = [
        'dispatcher_user_id' => $this->scenario->user(Role::Dispatcher)->id,
        'status' => 'accrued',
    ];

    $this->post('/commissions/pay', $datos)->assertRedirect();
    $primera = DB::table('dispatcher_commissions')->where('load_id', $this->scenario->load->id)->value('paid_at');

    // La segunda pasada no encuentra nada devengado y no toca la fecha.
    $this->post('/commissions/pay', $datos)->assertRedirect();

    expect(DB::table('dispatcher_commissions')->where('load_id', $this->scenario->load->id)->value('paid_at'))
        ->toBe($primera);
});

/* ── Quién ve qué ──────────────────────────────────────────────────────── */

it('el despachador ve lo suyo y no puede pagarse', function () {
    signIn($this->scenario, Role::Admin);
    facturarConComision($this->scenario);

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/commissions')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('dispatchers', 1)
            ->where('onlyMine', true)
            ->where('can.pay', false));

    // Ver lo que se le debe, sí. Dárselo por pagado, no.
    $this->post('/commissions/pay', [
        'dispatcher_user_id' => $this->scenario->user(Role::Dispatcher)->id,
        'status' => 'accrued',
    ])->assertRedirect()->assertSessionHas('error');

    expect(DB::table('dispatcher_commissions')->where('load_id', $this->scenario->load->id)->value('status'))
        ->toBe('accrued');
});

it('el transportista no entra en las comisiones', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get('/commissions')->assertForbidden();
});
