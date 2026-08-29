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
 * Una factura emitida y lista para cobrar.
 *
 * OJO con el importe: la factura al transportista es la TARIFA DE DESPACHO, no
 * el bruto de la carga. Con 250.000 de bruto y 10 %, el total de la factura son
 * 25.000. Los cobros de estas pruebas se miden contra eso.
 */
function facturaEnviada(Scenario $scenario): object
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
    ])->assertRedirect();

    $id = (string) DB::table('invoices')->orderByDesc('created_at')->value('id');

    test()->post("/invoices/{$id}/send")->assertRedirect();

    return DB::table('invoices')->where('id', $id)->first();
}

/**
 * @param  array<string, mixed>  $overrides
 */
function cobrar(string $invoiceId, int $cents, array $overrides = []): void
{
    // assertSessionHasNoErrors además del redirect: una validación fallida
    // TAMBIÉN redirige, así que sin esto un cobro rechazado pasaría por bueno y
    // el fallo aparecería tres aserciones más abajo, sin decir por qué.
    test()->post("/invoices/{$invoiceId}/payments", array_merge([
        'amount_cents' => $cents,
        'method' => 'check',
        'status' => 'succeeded',
    ], $overrides))->assertRedirect()->assertSessionHasNoErrors();
}

/* ── Lo que este lote arregla ──────────────────────────────────────────── */

it('anotar un cobro ESCRIBE una fila, no solo una columna', function () {
    signIn($this->scenario, Role::Admin);
    $factura = facturaEnviada($this->scenario);

    cobrar((string) $factura->id, 10000, [
        'reference' => 'CHQ-4471',
        'received_at' => '2026-08-20',
        'notes' => 'Cheque en mano.',
    ]);

    $cobro = DB::table('payments')->where('invoice_id', $factura->id)->first();

    // Antes de este lote la factura decía cuánto se había cobrado y no había
    // NADA que dijera cuándo, cómo, con qué referencia ni quién lo anotó.
    expect($cobro)->not->toBeNull()
        ->and((int) $cobro->amount_cents)->toBe(10000)
        ->and($cobro->method)->toBe('check')
        ->and($cobro->status)->toBe('succeeded')
        ->and($cobro->reference)->toBe('CHQ-4471')
        ->and(substr((string) $cobro->received_at, 0, 10))->toBe('2026-08-20')
        ->and($cobro->recorded_by_user_id)->not->toBeNull();
});

it('el saldo de la factura se DERIVA de sus cobros', function () {
    signIn($this->scenario, Role::Admin);
    $factura = facturaEnviada($this->scenario);
    $total = (int) $factura->total_cents;

    cobrar((string) $factura->id, 6000);
    cobrar((string) $factura->id, 4000);

    $f = DB::table('invoices')->where('id', $factura->id)->first();

    expect((int) $f->amount_paid_cents)->toBe(10000)
        ->and((int) $f->balance_cents)->toBe($total - 10000)
        ->and($f->status)->toBe('sent');
});

it('al cubrir el total la factura queda pagada', function () {
    signIn($this->scenario, Role::Admin);
    $factura = facturaEnviada($this->scenario);

    cobrar((string) $factura->id, (int) $factura->total_cents);

    $f = DB::table('invoices')->where('id', $factura->id)->first();

    expect($f->status)->toBe('paid')
        ->and((int) $f->balance_cents)->toBe(0)
        ->and($f->paid_at)->not->toBeNull();
});

it('un cobro sin compensar queda anotado y NO cuenta', function () {
    signIn($this->scenario, Role::Admin);
    $factura = facturaEnviada($this->scenario);

    cobrar((string) $factura->id, (int) $factura->total_cents, ['status' => 'pending']);

    $f = DB::table('invoices')->where('id', $factura->id)->first();

    // El cheque está en la mesa y en la lista; el dinero no está en el banco.
    expect(DB::table('payments')->where('invoice_id', $factura->id)->count())->toBe(1)
        ->and((int) $f->amount_paid_cents)->toBe(0)
        ->and($f->status)->toBe('sent');
});

/* ── Reembolsos ────────────────────────────────────────────────────────── */

it('un reembolso devuelve la factura a deber', function () {
    signIn($this->scenario, Role::Admin);
    $factura = facturaEnviada($this->scenario);
    $total = (int) $factura->total_cents;

    cobrar((string) $factura->id, $total);
    expect(DB::table('invoices')->where('id', $factura->id)->value('status'))->toBe('paid');

    $cobro = DB::table('payments')->where('invoice_id', $factura->id)->first();

    $this->post("/payments/{$cobro->id}/refund", [
        'amount_cents' => 5000,
        'reason' => 'Se cobró de más por una parada que no se hizo.',
    ])->assertRedirect();

    $f = DB::table('invoices')->where('id', $factura->id)->first();

    expect((int) $f->amount_paid_cents)->toBe($total - 5000)
        ->and((int) $f->balance_cents)->toBe(5000)
        // Ya no está pagada: vuelve a deber.
        ->and($f->status)->not->toBe('paid');

    expect(DB::table('payments')->where('id', $cobro->id)->value('status'))
        ->toBe('partially_refunded');
});

it('no se devuelve más de lo que trajo el cobro', function () {
    signIn($this->scenario, Role::Admin);
    $factura = facturaEnviada($this->scenario);

    cobrar((string) $factura->id, 5000);
    $cobro = DB::table('payments')->where('invoice_id', $factura->id)->first();

    $this->post("/payments/{$cobro->id}/refund", [
        'amount_cents' => 6000,
        'reason' => 'Motivo suficientemente largo.',
    ])->assertSessionHasErrors('amount_cents');

    expect((int) DB::table('payments')->where('id', $cobro->id)->value('refunded_amount_cents'))
        ->toBe(0);
});

it('devolverlo todo deja el cobro en reembolsado', function () {
    signIn($this->scenario, Role::Admin);
    $factura = facturaEnviada($this->scenario);

    cobrar((string) $factura->id, 5000);
    $cobro = DB::table('payments')->where('invoice_id', $factura->id)->first();

    $this->post("/payments/{$cobro->id}/refund", [
        'amount_cents' => 5000,
        'reason' => 'La carga se anuló después de facturar.',
    ])->assertRedirect();

    expect(DB::table('payments')->where('id', $cobro->id)->value('status'))->toBe('refunded');
    expect((int) DB::table('invoices')->where('id', $factura->id)->value('amount_paid_cents'))->toBe(0);
});

/* ── Disputas ──────────────────────────────────────────────────────────── */

it('un cobro en disputa deja de contar como dinero en casa', function () {
    signIn($this->scenario, Role::Admin);
    $factura = facturaEnviada($this->scenario);
    $total = (int) $factura->total_cents;

    cobrar((string) $factura->id, $total);
    $cobro = DB::table('payments')->where('invoice_id', $factura->id)->first();

    $this->post("/payments/{$cobro->id}/dispute", [
        'reason' => 'El transportista reclama el cargo a su banco.',
    ])->assertRedirect();

    $f = DB::table('invoices')->where('id', $factura->id)->first();

    // El banco puede retirarlo: dar la factura por cobrada sería mentir.
    expect((int) $f->amount_paid_cents)->toBe(0)
        ->and((int) $f->balance_cents)->toBe($total)
        ->and($f->status)->not->toBe('paid');
});

/* ── Reglas del cobro ──────────────────────────────────────────────────── */

it('no se cobra contra una factura en borrador', function () {
    signIn($this->scenario, Role::Admin);

    DB::table('loads')->where('id', $this->scenario->load->id)->update([
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'status' => 'delivered',
        'actual_delivery_at' => now()->subDay(),
        'updated_at' => now(),
    ]);

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$this->scenario->load->id],
    ])->assertRedirect();

    $id = (string) DB::table('invoices')->orderByDesc('created_at')->value('id');

    $this->post("/invoices/{$id}/payments", [
        'amount_cents' => 1000,
        'method' => 'cash',
        'status' => 'succeeded',
    ])->assertSessionHasErrors('amount_cents');

    expect(DB::table('payments')->where('invoice_id', $id)->count())->toBe(0);
});

it('no se cobra más que el total', function () {
    signIn($this->scenario, Role::Admin);
    $factura = facturaEnviada($this->scenario);

    $this->post("/invoices/{$factura->id}/payments", [
        'amount_cents' => (int) $factura->total_cents + 1,
        'method' => 'wire',
        'status' => 'succeeded',
    ])->assertSessionHasErrors('amount_cents');
});

it('exige un método de la lista', function () {
    signIn($this->scenario, Role::Admin);
    $factura = facturaEnviada($this->scenario);

    $this->post("/invoices/{$factura->id}/payments", [
        'amount_cents' => 1000,
        'method' => 'bitcoin',
        'status' => 'succeeded',
    ])->assertSessionHasErrors('method');
});

/* ── Quién ve y quién toca ─────────────────────────────────────────────── */

it('el transportista ve sus cobros y no puede reembolsar', function () {
    signIn($this->scenario, Role::Admin);
    $factura = facturaEnviada($this->scenario);
    cobrar((string) $factura->id, 5000);
    $cobro = DB::table('payments')->where('invoice_id', $factura->id)->first();

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Carrier);

    $this->get('/payments')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('payments.data', 1)
            ->where('can.refund', false));

    // Ver lo que se le ha cobrado, sí. Devolvérselo a sí mismo, no.
    $this->post("/payments/{$cobro->id}/refund", [
        'amount_cents' => 1000,
        'reason' => 'Porque me apetece.',
    ])->assertRedirect()->assertSessionHas('error');

    expect((int) DB::table('payments')->where('id', $cobro->id)->value('refunded_amount_cents'))
        ->toBe(0);
});

it('el despachador no entra en el libro de cobros', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/payments')->assertForbidden();
});
