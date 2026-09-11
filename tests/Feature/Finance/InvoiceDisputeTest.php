<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Finance\PaymentLedger;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * La disputa que la factura no se enteraba de que tenía.
 *
 * `PaymentLedger::dispute()` escribía `payments.status = 'disputed'` y ahí se
 * acababa. La factura seguía en «enviada» o «vencida»: la barredora nocturna la
 * reclamaba como a un moroso corriente, la cartera por antigüedad la contaba
 * como deuda normal —su cláusula `disputed_at` no podía dispararse porque la
 * columna no la escribía nadie— y un cobro posterior la pasaba a «pagada» con
 * la disputa viva encima.
 *
 * Ese último es el que tenía la guarda puesta: `SIN_SALDO` incluía `'disputed'`
 * justo para impedirlo, y no podía servir de nada.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Una factura enviada de este escenario, lista para cobrar. */
function facturaDisputable(Scenario $s): object
{
    DB::table('loads')->where('id', $s->load->id)->update([
        'carrier_id' => $s->assignedCarrier->id,
        'status' => 'delivered',
        'actual_delivery_at' => now()->subDay(),
        'customer_charge_cents' => 300000,
        'carrier_gross_rate_cents' => 250000,
        'carrier_dispatch_fee_bps' => 1000,
        'updated_at' => now(),
    ]);

    test()->post('/invoices', [
        'carrier_id' => $s->assignedCarrier->id,
        'load_ids' => [$s->load->id],
    ])->assertRedirect()->assertSessionHasNoErrors();

    $id = (string) DB::table('invoices')->orderByDesc('created_at')->value('id');

    test()->post("/invoices/{$id}/send")->assertRedirect()->assertSessionHasNoErrors();

    return DB::table('invoices')->where('id', $id)->first();
}

function cobroDe(string $invoiceId, int $cents): void
{
    test()->post("/invoices/{$invoiceId}/payments", [
        'amount_cents' => $cents,
        'method' => 'check',
        'status' => 'succeeded',
    ])->assertRedirect()->assertSessionHasNoErrors();
}

function ultimoCobro(string $invoiceId): object
{
    return DB::table('payments')->where('invoice_id', $invoiceId)->orderByDesc('created_at')->first();
}

function facturaFresca(string $invoiceId): object
{
    return DB::table('invoices')->where('id', $invoiceId)->first();
}

/* ── La disputa sube a la factura ──────────────────────────────────────── */

it('disputar un cobro pone la factura entera en disputa, con su motivo', function (): void {
    signIn($this->scenario, Role::Admin);
    $factura = facturaDisputable($this->scenario);

    cobroDe((string) $factura->id, (int) $factura->total_cents);

    $this->post('/payments/'.ultimoCobro((string) $factura->id)->id.'/dispute', [
        'reason' => 'El transportista reclama el cargo a su banco.',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $f = facturaFresca((string) $factura->id);

    // Las tres a la vez: el estado, la fecha y el motivo. Con el estado solo,
    // quien abre la ficha ve «En disputa» y tiene que ir a buscar por qué.
    expect($f->status)->toBe('disputed');
    expect($f->disputed_at)->not->toBeNull();
    expect((string) $f->dispute_reason)->toBe('El transportista reclama el cargo a su banco.');
});

it('un cobro posterior NO la pasa a pagada mientras la disputa siga viva', function (): void {
    // El defecto que tenía la guarda escrita y no podía dispararse.
    signIn($this->scenario, Role::Admin);
    $factura = facturaDisputable($this->scenario);
    $total = (int) $factura->total_cents;

    cobroDe((string) $factura->id, $total);

    $this->post('/payments/'.ultimoCobro((string) $factura->id)->id.'/dispute', [
        'reason' => 'Contracargo abierto por el transportista.',
    ])->assertRedirect();

    // Entra otro cobro que cubre el saldo entero.
    cobroDe((string) $factura->id, $total);

    $f = facturaFresca((string) $factura->id);

    expect($f->status)->toBe('disputed');
    expect($f->paid_at)->toBeNull();
});

it('una factura anulada no se pone en disputa', function (): void {
    // Anulada manda sobre la disputa: no debe nada, la esté reclamando el
    // banco o no. Si la disputa ganara, una factura anulada volvería a deber.
    //
    // El camino es el que ya describe la ficha de factura: la oficina anula
    // mientras un cobro va de camino y el cobro aterriza después, por la
    // pasarela. Por eso la fila se planta a mano: por la pantalla no se puede
    // anular una factura que ya tiene cobros, y con este orden sí ocurre.
    signIn($this->scenario, Role::Admin);
    $factura = facturaDisputable($this->scenario);

    $this->post("/invoices/{$factura->id}/void", [
        'reason' => 'Emitida al transportista equivocado.',
    ])->assertRedirect()->assertSessionHasNoErrors();

    DB::table('payments')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'invoice_id' => $factura->id,
        'amount_cents' => (int) $factura->total_cents,
        'method' => 'card',
        'status' => 'disputed',
        'disputed_at' => now(),
        'dispute_reason' => 'Contracargo llegado tarde.',
        'received_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    PaymentLedger::resync((string) $this->scenario->tenant->id, (string) $factura->id);

    $f = facturaFresca((string) $factura->id);

    expect($f->status)->toBe('voided');
    expect((int) $f->balance_cents)->toBe(0);
});

/* ── Y sabe bajarse ────────────────────────────────────────────────────── */

it('ganada: el cobro vuelve a contar y la factura sale de la disputa', function (): void {
    signIn($this->scenario, Role::Admin);
    $factura = facturaDisputable($this->scenario);
    $total = (int) $factura->total_cents;

    cobroDe((string) $factura->id, $total);
    $cobro = ultimoCobro((string) $factura->id);

    $this->post("/payments/{$cobro->id}/dispute", ['reason' => 'Contracargo abierto.'])->assertRedirect();

    $this->post("/payments/{$cobro->id}/dispute/resolve", [
        'outcome' => 'won',
        'reason' => 'El banco nos dio la razón.',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $f = facturaFresca((string) $factura->id);

    expect(DB::table('payments')->where('id', $cobro->id)->value('status'))->toBe('succeeded');
    expect($f->status)->toBe('paid');
    expect((int) $f->amount_paid_cents)->toBe($total);
    // Y la marca se retira: si se quedara, la cartera excluiría para siempre
    // una factura que hace meses que dejó de estar en disputa.
    expect($f->disputed_at)->toBeNull();
    expect($f->dispute_reason)->toBeNull();
});

it('perdida: el cobro queda fallido y la factura vuelve a deber, no a estar en disputa', function (): void {
    signIn($this->scenario, Role::Admin);
    $factura = facturaDisputable($this->scenario);
    $total = (int) $factura->total_cents;

    cobroDe((string) $factura->id, $total);
    $cobro = ultimoCobro((string) $factura->id);

    $this->post("/payments/{$cobro->id}/dispute", ['reason' => 'Contracargo abierto.'])->assertRedirect();

    $this->post("/payments/{$cobro->id}/dispute/resolve", [
        'outcome' => 'lost',
        'reason' => 'El banco resolvió a favor del transportista.',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $f = facturaFresca((string) $factura->id);

    // Fallido y no reembolsado: no lo devolvimos nosotros.
    expect(DB::table('payments')->where('id', $cobro->id)->value('status'))->toBe('failed');
    // Pero su historia de disputa se queda: ese dinero entró y se fue.
    expect(DB::table('payments')->where('id', $cobro->id)->value('disputed_at'))->not->toBeNull();

    expect($f->status)->not->toBe('disputed');
    expect((int) $f->balance_cents)->toBe($total);
    expect($f->disputed_at)->toBeNull();
});

it('con dos cobros en disputa, cerrar uno no saca a la factura', function (): void {
    // La disputa de la factura se deduce de TODOS sus cobros. Deducirla del
    // último que se tocó la sacaría con una disputa todavía viva al lado.
    signIn($this->scenario, Role::Admin);
    $factura = facturaDisputable($this->scenario);
    $mitad = intdiv((int) $factura->total_cents, 2);

    cobroDe((string) $factura->id, $mitad);
    $primero = ultimoCobro((string) $factura->id);
    cobroDe((string) $factura->id, $mitad);
    $segundo = ultimoCobro((string) $factura->id);

    foreach ([$primero, $segundo] as $c) {
        $this->post("/payments/{$c->id}/dispute", ['reason' => 'Contracargo del lote.'])->assertRedirect();
    }

    $this->post("/payments/{$primero->id}/dispute/resolve", [
        'outcome' => 'won',
        'reason' => 'Resuelto el primero.',
    ])->assertRedirect();

    expect(facturaFresca((string) $factura->id)->status)->toBe('disputed');

    $this->post("/payments/{$segundo->id}/dispute/resolve", [
        'outcome' => 'won',
        'reason' => 'Resuelto el segundo.',
    ])->assertRedirect();

    expect(facturaFresca((string) $factura->id)->status)->not->toBe('disputed');
});

it('no se cierra la disputa de un cobro que no la tiene', function (): void {
    signIn($this->scenario, Role::Admin);
    $factura = facturaDisputable($this->scenario);

    cobroDe((string) $factura->id, (int) $factura->total_cents);

    $this->post('/payments/'.ultimoCobro((string) $factura->id)->id.'/dispute/resolve', [
        'outcome' => 'won',
        'reason' => 'No hay nada que cerrar.',
    ])->assertSessionHasErrors('reason');
});

it('un desenlace que no existe se rechaza', function (): void {
    signIn($this->scenario, Role::Admin);
    $factura = facturaDisputable($this->scenario);

    cobroDe((string) $factura->id, (int) $factura->total_cents);
    $cobro = ultimoCobro((string) $factura->id);

    $this->post("/payments/{$cobro->id}/dispute", ['reason' => 'Contracargo.'])->assertRedirect();

    // El desenlace llega del navegador y decide si el dinero se queda o no.
    $this->post("/payments/{$cobro->id}/dispute/resolve", [
        'outcome' => 'perdonada',
        'reason' => 'Un desenlace inventado.',
    ])->assertSessionHasErrors('outcome');

    expect(DB::table('payments')->where('id', $cobro->id)->value('status'))->toBe('disputed');
});

/* ── Y deja de contarse donde no debe ──────────────────────────────────── */

it('la barredora nocturna no reclama una factura en disputa', function (): void {
    signIn($this->scenario, Role::Admin);
    $factura = facturaDisputable($this->scenario);

    cobroDe((string) $factura->id, (int) $factura->total_cents);
    $cobro = ultimoCobro((string) $factura->id);

    $this->post("/payments/{$cobro->id}/dispute", ['reason' => 'Contracargo abierto.'])->assertRedirect();

    // Vencida hace un mes: sin la disputa, la barredora la reclamaría.
    DB::table('invoices')->where('id', $factura->id)->update([
        'due_date' => now()->subMonth()->toDateTimeString(),
    ]);

    $antes = DB::table('notifications')->count();
    $this->artisan('notifications:sweep')->assertSuccessful();

    $nuevas = DB::table('notifications')
        ->where('event_key', 'invoice.overdue')
        ->count();

    expect($nuevas)->toBe(0);
    // Y no se la lleva por delante cambiándole el estado a «vencida».
    expect(facturaFresca((string) $factura->id)->status)->toBe('disputed');
    expect(DB::table('notifications')->count())->toBeGreaterThanOrEqual($antes);
});

it('la cartera por antigüedad descuenta la factura en disputa', function (): void {
    signIn($this->scenario, Role::Admin);
    $factura = facturaDisputable($this->scenario);
    $total = (int) $factura->total_cents;

    DB::table('invoices')->where('id', $factura->id)->update([
        'issue_date' => now()->subMonths(2)->toDateTimeString(),
        'due_date' => now()->subMonths(2)->toDateTimeString(),
    ]);

    $pendiente = fn (): int => (int) (json_decode((string) json_encode(
        $this->get('/reports')->viewData('page')['props'] ?? []
    ), true)['summary']['outstandingCents'] ?? -1);

    $conLaFactura = $pendiente();
    expect($conLaFactura)->toBeGreaterThanOrEqual($total);

    cobroDe((string) $factura->id, $total);
    $cobro = ultimoCobro((string) $factura->id);

    $this->post("/payments/{$cobro->id}/dispute", ['reason' => 'Contracargo abierto.'])->assertRedirect();

    // La cláusula `disputed_at` de `PeriodReport::aging()` llevaba desde el
    // primer día escrita y sin poder dispararse nunca.
    expect($pendiente())->toBe($conLaFactura - $total);
});
