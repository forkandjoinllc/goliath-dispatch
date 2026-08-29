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

/** Factura la carga del escenario y devuelve el id de la factura. */
function facturaDelPeriodo(Scenario $scenario): string
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

    test()->post('/invoices', [
        'carrier_id' => $scenario->assignedCarrier->id,
        'load_ids' => [$scenario->load->id],
    ])->assertRedirect()->assertSessionHasNoErrors();

    $id = (string) DB::table('invoices')->orderByDesc('created_at')->value('id');
    test()->post("/invoices/{$id}/send")->assertRedirect();

    return $id;
}

/* ── Lo que cuenta ─────────────────────────────────────────────────────── */

it('cuenta lo FACTURADO, no lo entregado', function () {
    signIn($this->scenario, Role::Admin);

    // Entregada pero sin facturar: no cuenta todavía.
    DB::table('loads')->where('id', $this->scenario->load->id)->update([
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'status' => 'delivered',
        'actual_delivery_at' => now()->subDay(),
        'carrier_gross_rate_cents' => 250000,
        'carrier_dispatch_fee_bps' => 1000,
        'updated_at' => now(),
    ]);

    $this->get('/reports')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('summary.feeCents', 0)
            ->where('summary.loads', 0));

    facturaDelPeriodo($this->scenario);

    // 10 % de 250.000 = 25.000.
    $this->get('/reports')
        ->assertInertia(fn (Assert $page) => $page
            ->where('summary.feeCents', 25000)
            ->where('summary.loads', 1)
            ->has('byCarrier', 1));
});

it('una factura anulada deja de contar', function () {
    signIn($this->scenario, Role::Admin);
    $id = facturaDelPeriodo($this->scenario);

    $this->post("/invoices/{$id}/void", ['reason' => 'Se facturó al transportista equivocado.'])
        ->assertRedirect();

    $this->get('/reports')
        ->assertInertia(fn (Assert $page) => $page->where('summary.feeCents', 0));
});

it('las cifras NO se recalculan cuando cambia algo después', function () {
    signIn($this->scenario, Role::Admin);
    facturaDelPeriodo($this->scenario);

    // Se cambia la tarifa de la carga DESPUÉS de facturar.
    DB::table('loads')->where('id', $this->scenario->load->id)
        ->update(['carrier_dispatch_fee_bps' => 5000, 'updated_at' => now()]);

    // El informe sigue diciendo lo que se facturó: sale de la instantánea.
    $this->get('/reports')
        ->assertInertia(fn (Assert $page) => $page->where('summary.feeCents', 25000));
});

/* ── Antigüedad del cobro ──────────────────────────────────────────────── */

it('una factura recién enviada está sin vencer', function () {
    signIn($this->scenario, Role::Admin);
    facturaDelPeriodo($this->scenario);

    $this->get('/reports')
        ->assertInertia(fn (Assert $page) => $page
            ->where('aging.current.count', 1)
            ->where('aging.current.amountCents', 25000)
            ->where('aging.d90plus.count', 0));
});

it('una factura vencida hace meses cae en el último tramo', function () {
    signIn($this->scenario, Role::Admin);
    $id = facturaDelPeriodo($this->scenario);

    DB::table('invoices')->where('id', $id)
        ->update(['due_date' => now()->subDays(120), 'updated_at' => now()]);

    $this->get('/reports')
        ->assertInertia(fn (Assert $page) => $page
            ->where('aging.d90plus.count', 1)
            ->where('aging.current.count', 0));
});

it('lo cobrado deja de estar pendiente', function () {
    signIn($this->scenario, Role::Admin);
    $id = facturaDelPeriodo($this->scenario);

    $this->post("/invoices/{$id}/payments", [
        'amount_cents' => 25000,
        'method' => 'wire',
        'status' => 'succeeded',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $this->get('/reports')
        ->assertInertia(fn (Assert $page) => $page->where('summary.outstandingCents', 0));
});

/* ── El periodo ────────────────────────────────────────────────────────── */

it('un periodo anterior no ve lo facturado hoy', function () {
    signIn($this->scenario, Role::Admin);
    facturaDelPeriodo($this->scenario);

    $this->get('/reports?from=2020-01-01&to=2020-01-31')
        ->assertInertia(fn (Assert $page) => $page->where('summary.feeCents', 0));
});

it('un periodo del revés se devuelve del derecho', function () {
    signIn($this->scenario, Role::Admin);
    facturaDelPeriodo($this->scenario);

    // Vacío sería confundir «no hay datos» con «has escrito las fechas al revés».
    $this->get('/reports?from='.now()->addDay()->toDateString().'&to='.now()->subMonth()->toDateString())
        ->assertInertia(fn (Assert $page) => $page->where('summary.feeCents', 25000));
});

/* ── Quién ve qué ──────────────────────────────────────────────────────── */

it('el transportista solo se ve a sí mismo', function () {
    signIn($this->scenario, Role::Admin);
    facturaDelPeriodo($this->scenario);

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Carrier);

    $this->get('/reports')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('byCarrier', 1)
            // Las comisiones de la casa no son asunto suyo.
            ->has('commissionsByDispatcher', 0)
            ->where('can.export', false));
});

it('el despachador sin asignaciones no ve números', function () {
    signIn($this->scenario, Role::Admin);
    facturaDelPeriodo($this->scenario);

    DB::table('dispatcher_resource_assignments')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->delete();

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Dispatcher);

    // Un informe no puede ser la puerta de atrás a los números que el resto de
    // pantallas le niegan.
    $this->get('/reports')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('summary.feeCents', 0));
});

/* ── Exportar ──────────────────────────────────────────────────────────── */

it('exporta un CSV y lo deja anotado en la auditoría', function () {
    signIn($this->scenario, Role::Admin);
    facturaDelPeriodo($this->scenario);

    $respuesta = $this->get('/reports/export?table=carriers');

    $respuesta->assertOk();
    expect($respuesta->headers->get('content-type'))->toContain('text/csv');

    $csv = $respuesta->streamedContent();

    expect($csv)->toContain('carrier,loads,gross,dispatch_fee')
        // Decimal, no céntimos: una hoja de cálculo tiene que poder sumarlo.
        ->and($csv)->toContain('250.00');

    expect(DB::table('audit_events')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('action', 'export.created')
        ->count())->toBe(1);
});

it('el transportista no exporta', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get('/reports/export?table=carriers')->assertForbidden();
});
