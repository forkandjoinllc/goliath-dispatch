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

function cargaLista(Scenario $scenario): object
{
    DB::table('loads')->where('id', $scenario->load->id)->update([
        'carrier_id' => $scenario->assignedCarrier->id,
        'status' => 'delivered',
        'actual_delivery_at' => now()->subDay(),
        'customer_charge_cents' => 300000,
        'carrier_gross_rate_cents' => 250000,
        'carrier_dispatch_fee_bps' => 1000,
        'updated_at' => now(),
    ]);

    return DB::table('loads')->where('id', $scenario->load->id)->first();
}

function liquidar(Scenario $scenario): string
{
    $carga = cargaLista($scenario);

    test()->post('/settlements', [
        'carrier_id' => $scenario->assignedCarrier->id,
        'load_ids' => [$carga->id],
    ])->assertRedirect();

    return (string) DB::table('carrier_settlements')->orderByDesc('created_at')->value('id');
}

/* ── Crear ──────────────────────────────────────────────────────────────── */

it('liquida una carga entregada con sus cinco cifras', function () {
    signIn($this->scenario, Role::Admin);
    $id = liquidar($this->scenario);

    $s = DB::table('carrier_settlements')->where('id', $id)->first();

    // Bruto 250.000, tarifa 10 % = 25.000, neto 225.000.
    expect($s->status)->toBe('draft')
        ->and((int) $s->gross_rate_cents)->toBe(250000)
        ->and((int) $s->dispatch_fees_cents)->toBe(25000)
        ->and((int) $s->net_amount_cents)->toBe(225000)
        ->and($s->settlement_number)->toStartWith('STL-');

    $linea = DB::table('carrier_settlement_lines')->where('settlement_id', $id)->first();

    expect($linea->financial_snapshot_id)->not->toBeNull();
});

it('no se liquida dos veces la misma carga', function () {
    signIn($this->scenario, Role::Admin);
    liquidar($this->scenario);

    $this->get('/settlements/create?carrier='.$this->scenario->assignedCarrier->id)
        ->assertInertia(fn (Assert $page) => $page->has('loads', 0));
});

/* ── Las dos caras del mismo dinero ─────────────────────────────────────── */

it('la liquidación REUTILIZA la instantánea de la factura', function () {
    signIn($this->scenario, Role::Admin);
    $carga = cargaLista($this->scenario);

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$carga->id],
    ])->assertRedirect();

    $usadaEnFactura = DB::table('invoice_line_items')->where('load_id', $carga->id)->value('financial_snapshot_id');

    $id = liquidar($this->scenario);
    $usadaEnLiquidacion = DB::table('carrier_settlement_lines')->where('settlement_id', $id)->value('financial_snapshot_id');

    // Si cada una calculara la suya, entre la factura y la liquidación podría
    // aprobarse un gasto y la tarifa descontada dejaría de coincidir con la
    // facturada. La diferencia sería pequeña y constante: la peor clase de
    // error, porque nadie la ve hasta que alguien cuadra un trimestre.
    expect($usadaEnLiquidacion)->toBe($usadaEnFactura);

    // Y una sola instantánea, no dos.
    expect(DB::table('financial_snapshots')->where('load_id', $carga->id)->count())->toBe(1);
});

it('sin factura previa, congela ella misma', function () {
    signIn($this->scenario, Role::Admin);
    $id = liquidar($this->scenario);

    $snapshot = DB::table('financial_snapshots')->where('load_id', $this->scenario->load->id)->first();

    expect($snapshot)->not->toBeNull()
        ->and((int) $snapshot->version)->toBe(1);

    // Y la factura que venga después leerá esa misma.
    expect(DB::table('carrier_settlement_lines')->where('settlement_id', $id)->value('financial_snapshot_id'))
        ->toBe((string) $snapshot->id);
});

/* ── Estados ────────────────────────────────────────────────────────────── */

it('el camino es borrador → entregada → pagada', function () {
    signIn($this->scenario, Role::Admin);
    $id = liquidar($this->scenario);

    $this->post("/settlements/{$id}/pay")->assertSessionHasErrors('status');

    $this->post("/settlements/{$id}/issue")->assertRedirect();
    expect(DB::table('carrier_settlements')->where('id', $id)->value('status'))->toBe('issued');

    $this->post("/settlements/{$id}/pay")->assertRedirect();
    expect(DB::table('carrier_settlements')->where('id', $id)->value('status'))->toBe('paid');
});

it('una liquidación pagada no se anula', function () {
    signIn($this->scenario, Role::Admin);
    $id = liquidar($this->scenario);

    $this->post("/settlements/{$id}/issue");
    $this->post("/settlements/{$id}/pay");

    $this->post("/settlements/{$id}/void", ['reason' => 'Me equivoqué de transportista.'])
        ->assertSessionHasErrors('reason');
});

it('anular devuelve la carga a lo liquidable', function () {
    signIn($this->scenario, Role::Admin);
    $id = liquidar($this->scenario);

    $this->post("/settlements/{$id}/void", ['reason' => 'Se liquidó el periodo equivocado.'])
        ->assertRedirect();

    $this->get('/settlements/create?carrier='.$this->scenario->assignedCarrier->id)
        ->assertInertia(fn (Assert $page) => $page->has('loads', 1));
});

/* ── Factoring ──────────────────────────────────────────────────────────── */

it('anota la factoring del transportista, sin mover dinero', function () {
    signIn($this->scenario, Role::Admin);

    $factoringId = (string) Illuminate\Support\Str::uuid();

    DB::table('factoring_companies')->insert([
        'id' => $factoringId,
        'tenant_id' => $this->scenario->tenant->id,
        'name' => 'Rio Grande Funding LLC',
        'active' => true,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    DB::table('factoring_assignments')->insert([
        'id' => (string) Illuminate\Support\Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'factoring_company_id' => $factoringId,
        'verification_status' => 'not_started',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $id = liquidar($this->scenario);

    // La plataforma REGISTRA a quién hay que pagarle. No paga.
    expect(DB::table('carrier_settlements')->where('id', $id)->value('factoring_company_id'))
        ->toBe($factoringId);
});

/* ── Quién ve qué ───────────────────────────────────────────────────────── */

it('el transportista ve sus liquidaciones', function () {
    signIn($this->scenario, Role::Admin);
    liquidar($this->scenario);

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Carrier);

    $this->get('/settlements')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('settlements.data', 1));
});

it('el transportista no puede crear liquidaciones', function () {
    signIn($this->scenario, Role::Carrier);

    // Ver lo que se le paga, sí. Decidirlo, no.
    $this->get('/settlements/create')->assertForbidden();
});
