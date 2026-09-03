<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Finance\InvoicePayments;
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

/** Una carga entregada, facturada y enviada. Devuelve el id de la factura. */
function facturaParaSaldo(Scenario $scenario): string
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
        'payment_terms_days' => 15,
    ])->assertRedirect();

    $id = (string) DB::table('invoices')->orderByDesc('created_at')->value('id');

    test()->post('/invoices/'.$id.'/send')->assertRedirect();

    return $id;
}

/** Un cobro que entra por la pasarela, como lo haría el webhook. */
function cobroDePasarelaEnSaldo(Scenario $scenario, string $invoiceId, int $centavos): void
{
    $clave = 'test_'.$invoiceId.'_'.$centavos;

    InvoicePayments::start(
        tenantId: (string) $scenario->tenant->id,
        invoiceId: $invoiceId,
        amountCents: $centavos,
        method: 'card',
        idempotencyKey: $clave,
        providerReference: 'ref_'.$centavos,
    );

    InvoicePayments::settle($clave, true, providerReference: 'ref_'.$centavos);
}

/* ── Un cobro que llega tarde no resucita una factura anulada ────────────── */

it('un cobro por la pasarela NO marca pagada una factura anulada', function () {
    signIn($this->scenario, Role::Admin);

    $invoiceId = facturaParaSaldo($this->scenario);
    $total = (int) DB::table('invoices')->where('id', $invoiceId)->value('total_cents');

    $this->post('/invoices/'.$invoiceId.'/void', [
        'reason' => 'Se facturó al transportista equivocado.',
    ])->assertRedirect();

    // Y AHORA aterriza el cobro que ya iba de camino.
    cobroDePasarelaEnSaldo($this->scenario, $invoiceId, $total);

    $factura = DB::table('invoices')->where('id', $invoiceId)->first();

    expect((string) $factura->status)->toBe('voided')
        // El saldo de una anulada sigue en cero: no debe nada, pase lo que pase.
        ->and((int) $factura->balance_cents)->toBe(0)
        // Pero el dinero llegó y se apunta. Esconderlo sería la mentira contraria.
        ->and((int) $factura->amount_paid_cents)->toBe($total);
});

it('la carga tampoco se va a «pagada» por un cobro sobre una anulada', function () {
    signIn($this->scenario, Role::Admin);

    $invoiceId = facturaParaSaldo($this->scenario);
    $total = (int) DB::table('invoices')->where('id', $invoiceId)->value('total_cents');

    $this->post('/invoices/'.$invoiceId.'/void', ['reason' => 'Transportista equivocado.'])
        ->assertRedirect();

    cobroDePasarelaEnSaldo($this->scenario, $invoiceId, $total);

    // Anular ya la devolvió a `delivered`. Un cobro tardío no puede
    // adelantarla dos casillas sobre una factura que no existe.
    expect((string) DB::table('loads')->where('id', $this->scenario->load->id)->value('status'))
        ->toBe('delivered');
});

/* ── El camino normal sigue funcionando ──────────────────────────────────── */

it('un cobro por la pasarela cierra una factura viva', function () {
    signIn($this->scenario, Role::Admin);

    $invoiceId = facturaParaSaldo($this->scenario);
    $total = (int) DB::table('invoices')->where('id', $invoiceId)->value('total_cents');

    cobroDePasarelaEnSaldo($this->scenario, $invoiceId, $total);

    $factura = DB::table('invoices')->where('id', $invoiceId)->first();

    expect((string) $factura->status)->toBe('paid')
        ->and((int) $factura->balance_cents)->toBe(0)
        ->and($factura->paid_at)->not->toBeNull();

    expect((string) DB::table('loads')->where('id', $this->scenario->load->id)->value('status'))
        ->toBe('paid');
});

it('un cobro parcial por la pasarela deja la factura viva', function () {
    signIn($this->scenario, Role::Admin);

    $invoiceId = facturaParaSaldo($this->scenario);
    $total = (int) DB::table('invoices')->where('id', $invoiceId)->value('total_cents');

    cobroDePasarelaEnSaldo($this->scenario, $invoiceId, intdiv($total, 2));

    $factura = DB::table('invoices')->where('id', $invoiceId)->first();

    expect((string) $factura->status)->not->toBe('paid')
        ->and((int) $factura->balance_cents)->toBe($total - intdiv($total, 2));
});

/* ── Los dos caminos dan el MISMO número ─────────────────────────────────── */

it('la pasarela y la oficina recalculan igual', function () {
    signIn($this->scenario, Role::Admin);

    $invoiceId = facturaParaSaldo($this->scenario);
    $total = (int) DB::table('invoices')->where('id', $invoiceId)->value('total_cents');
    $mitad = intdiv($total, 2);

    // Medio por la pasarela, medio anotado a mano. Antes eran dos escritores
    // distintos: uno sumaba sobre la columna y el otro recalculaba desde las
    // filas, así que bastaba con que se cruzaran para que dejaran de cuadrar.
    cobroDePasarelaEnSaldo($this->scenario, $invoiceId, $mitad);

    $this->post('/invoices/'.$invoiceId.'/payments', [
        'amount_cents' => $total - $mitad,
        'method' => 'ach',
        'status' => 'succeeded',
    ])->assertRedirect();

    $factura = DB::table('invoices')->where('id', $invoiceId)->first();
    $sumaDeCobros = (int) DB::table('payments')->where('invoice_id', $invoiceId)->sum('amount_cents');

    expect((int) $factura->amount_paid_cents)->toBe($sumaDeCobros)
        ->and((int) $factura->balance_cents)->toBe(0)
        ->and((string) $factura->status)->toBe('paid');
});

/* ── El cobro de la pasarela deja rastro ─────────────────────────────────── */

it('un cobro por la pasarela se apunta en la bitácora', function () {
    signIn($this->scenario, Role::Admin);

    $invoiceId = facturaParaSaldo($this->scenario);

    cobroDePasarelaEnSaldo($this->scenario, $invoiceId, 1000);

    $evento = DB::table('audit_events')
        ->where('action', 'payment.recorded')
        ->where('entity_id', DB::table('payments')->where('invoice_id', $invoiceId)->value('id'))
        ->first();

    // Este camino no escribía NADA: la pista de auditoría enseñaba solo los
    // cobros que anota la oficina a mano, y el dinero que entra solo era
    // invisible.
    expect($evento)->not->toBeNull()
        ->and($evento->actor_user_id)->toBeNull();
});

it('la pantalla NOMBRA el dinero que quedó sobre una factura anulada', function () {
    signIn($this->scenario, Role::Admin);

    $invoiceId = facturaParaSaldo($this->scenario);
    $total = (int) DB::table('invoices')->where('id', $invoiceId)->value('total_cents');

    $this->post('/invoices/'.$invoiceId.'/void', ['reason' => 'Transportista equivocado.'])
        ->assertRedirect();

    cobroDePasarelaEnSaldo($this->scenario, $invoiceId, $total);

    // La pantalla enseñaba las tres piezas —«Anulada», «Cobrado $316»,
    // «Saldo $0»— y dejaba que el lector las juntara. Casi nadie las junta.
    $this->get('/invoices/'.$invoiceId)->assertOk()
        ->assertInertia(fn ($p) => expect($p->toArray()['props']['invoice']['amountPaidCents'])->toBe($total));

    $pantalla = (string) file_get_contents(
        dirname(__DIR__, 3).'/resources/js/pages/App/Invoices/Show.tsx'
    );

    expect(str_contains($pantalla, 'voidedWithPayment'))->toBeTrue(
        'La pantalla dejó de nombrar el dinero que quedó sobre una factura anulada.'
    );
});
