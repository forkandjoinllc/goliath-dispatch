<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Deja la carga del escenario en el estado que se le pida, con dinero encima. */
function cargaEnEstado(Scenario $scenario, string $estado): object
{
    DB::table('loads')->where('id', $scenario->load->id)->update([
        'carrier_id' => $scenario->assignedCarrier->id,
        'status' => $estado,
        'actual_delivery_at' => now()->subDay(),
        'pod_received_at' => $estado === 'pod_received' ? now()->subDay() : null,
        'customer_charge_cents' => 300000,
        'carrier_gross_rate_cents' => 250000,
        'carrier_dispatch_fee_bps' => 1000,
        'updated_at' => now(),
    ]);

    return DB::table('loads')->where('id', $scenario->load->id)->first();
}

function emitirFactura(Scenario $scenario): string
{
    test()->post('/invoices', [
        'carrier_id' => $scenario->assignedCarrier->id,
        'load_ids' => [$scenario->load->id],
        'payment_terms_days' => 15,
    ])->assertRedirect();

    return (string) DB::table('invoices')->orderByDesc('created_at')->value('id');
}

function estadoDeLaCarga(Scenario $scenario): string
{
    return (string) DB::table('loads')->where('id', $scenario->load->id)->value('status');
}

/* ── Nadie puede AFIRMAR que una carga está facturada ────────────────────── */

it('no ofrece «facturada» ni «pagada» como acciones de la ficha', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'pod_received');

    $this->get('/loads/'.$this->scenario->load->id)
        ->assertOk()
        ->assertInertia(function ($page) {
            $acciones = array_column($page->toArray()['props']['actions'], 'action');

            expect($acciones)->not->toContain('invoiced');
            expect($acciones)->not->toContain('paid');
        });
});

it('rechaza un POST a mano contra la transición «facturada»', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'pod_received');

    $this->post('/loads/'.$this->scenario->load->id.'/status/invoiced')
        ->assertNotFound();

    expect(estadoDeLaCarga($this->scenario))->toBe('pod_received');
});

it('rechaza un POST a mano contra la transición «pagada»', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'invoiced');

    $this->post('/loads/'.$this->scenario->load->id.'/status/paid')
        ->assertNotFound();

    expect(estadoDeLaCarga($this->scenario))->toBe('invoiced');
});

/* ── Facturar mueve la carga, y lo deja escrito ─────────────────────────── */

it('emitir la factura pasa la carga a facturada', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'delivered');

    emitirFactura($this->scenario);

    expect(estadoDeLaCarga($this->scenario))->toBe('invoiced');
});

it('deja en el historial que no lo movió una persona', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'delivered');

    $invoiceId = emitirFactura($this->scenario);
    $numero = (string) DB::table('invoices')->where('id', $invoiceId)->value('invoice_number');

    $fila = DB::table('load_status_history')
        ->where('load_id', $this->scenario->load->id)
        ->where('to_status', 'invoiced')
        ->first();

    expect($fila)->not->toBeNull()
        ->and((string) $fila->source)->toBe('system_job')
        ->and((string) $fila->source_reference)->toBe($numero)
        ->and((string) $fila->from_status)->toBe('delivered');
});

it('una carga con el comprobante colgado también se factura', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'pod_received');

    // La regresión que cerró este lote: `pod_received` —el estado al que la
    // propia aplicación te empuja— dejaba la carga fuera de lo facturable.
    $this->get('/invoices/create?carrier='.$this->scenario->assignedCarrier->id)
        ->assertOk()
        ->assertInertia(fn ($page) => $page->has('loads', 1));

    emitirFactura($this->scenario);

    expect(estadoDeLaCarga($this->scenario))->toBe('invoiced');
});

/* ── Cobrar, en los dos sentidos ─────────────────────────────────────────── */

it('cobrar la factura entera pasa la carga a pagada', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'delivered');

    $invoiceId = emitirFactura($this->scenario);
    $total = (int) DB::table('invoices')->where('id', $invoiceId)->value('total_cents');

    $this->post('/invoices/'.$invoiceId.'/send')->assertRedirect();
    $this->post('/invoices/'.$invoiceId.'/payments', [
        'amount_cents' => $total,
        'method' => 'ach',
        'status' => 'succeeded',
    ])->assertRedirect();

    expect(estadoDeLaCarga($this->scenario))->toBe('paid');
});

it('un cobro parcial NO pasa la carga a pagada', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'delivered');

    $invoiceId = emitirFactura($this->scenario);
    $total = (int) DB::table('invoices')->where('id', $invoiceId)->value('total_cents');

    $this->post('/invoices/'.$invoiceId.'/send')->assertRedirect();
    $this->post('/invoices/'.$invoiceId.'/payments', [
        'amount_cents' => intdiv($total, 2),
        'method' => 'ach',
        'status' => 'succeeded',
    ])->assertRedirect();

    expect(estadoDeLaCarga($this->scenario))->toBe('invoiced');
});

it('un reembolso que reabre la factura devuelve la carga a facturada', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'delivered');

    $invoiceId = emitirFactura($this->scenario);
    $total = (int) DB::table('invoices')->where('id', $invoiceId)->value('total_cents');

    $this->post('/invoices/'.$invoiceId.'/send')->assertRedirect();
    $this->post('/invoices/'.$invoiceId.'/payments', [
        'amount_cents' => $total,
        'method' => 'ach',
        'status' => 'succeeded',
    ])->assertRedirect();

    expect(estadoDeLaCarga($this->scenario))->toBe('paid');

    $paymentId = (string) DB::table('payments')->where('invoice_id', $invoiceId)->value('id');

    $this->post('/payments/'.$paymentId.'/refund', [
        'amount_cents' => intdiv($total, 2),
        'reason' => 'Cobro duplicado del cliente.',
    ])->assertRedirect();

    expect(estadoDeLaCarga($this->scenario))->toBe('invoiced');
});

/* ── Anular devuelve la carga de donde vino ──────────────────────────────── */

it('anular la factura devuelve la carga a «entregada»', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'delivered');

    $invoiceId = emitirFactura($this->scenario);

    $this->post('/invoices/'.$invoiceId.'/void', [
        'reason' => 'Se facturó al transportista equivocado.',
    ])->assertRedirect();

    expect(estadoDeLaCarga($this->scenario))->toBe('delivered');
});

it('anular devuelve la carga a «comprobante recibido» si de ahí salió', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'pod_received');

    $invoiceId = emitirFactura($this->scenario);

    $this->post('/invoices/'.$invoiceId.'/void', [
        'reason' => 'Se facturó al transportista equivocado.',
    ])->assertRedirect();

    // El destino NO está escrito en el código: sale del historial. Un valor
    // fijo habría inventado un comprobante en el caso de arriba.
    expect(estadoDeLaCarga($this->scenario))->toBe('pod_received');
});

it('anulada la factura, la carga vuelve a ofrecerse para facturar', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'delivered');

    $invoiceId = emitirFactura($this->scenario);

    $this->post('/invoices/'.$invoiceId.'/void', [
        'reason' => 'Se facturó al transportista equivocado.',
    ])->assertRedirect();

    $this->get('/invoices/create?carrier='.$this->scenario->assignedCarrier->id)
        ->assertOk()
        ->assertInertia(fn ($page) => $page->has('loads', 1));
});

/* ── La liquidación no depende de lo que nosotros facturemos ─────────────── */

it('una carga ya cobrada sigue pudiéndose liquidar al transportista', function () {
    signIn($this->scenario, Role::Admin);
    cargaEnEstado($this->scenario, 'delivered');

    $invoiceId = emitirFactura($this->scenario);
    $total = (int) DB::table('invoices')->where('id', $invoiceId)->value('total_cents');

    $this->post('/invoices/'.$invoiceId.'/send')->assertRedirect();
    $this->post('/invoices/'.$invoiceId.'/payments', [
        'amount_cents' => $total,
        'method' => 'ach',
        'status' => 'succeeded',
    ])->assertRedirect();

    // Al transportista se le paga por haber llevado la carga. Que nosotros le
    // hayamos cobrado nuestra comisión no le quita el derecho a cobrar la suya.
    $this->get('/settlements/create?carrier='.$this->scenario->assignedCarrier->id)
        ->assertOk()
        ->assertInertia(fn ($page) => $page->has('loads', 1));
});
