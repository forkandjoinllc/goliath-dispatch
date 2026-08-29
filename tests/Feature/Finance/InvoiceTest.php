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
 * Deja la carga del escenario entregada y con transportista, que es la única
 * situación en la que hay algo que facturar.
 */
function cargaEntregada(Scenario $scenario): object
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

function facturar(Scenario $scenario): string
{
    $carga = cargaEntregada($scenario);

    test()->post('/invoices', [
        'carrier_id' => $scenario->assignedCarrier->id,
        'load_ids' => [$carga->id],
        'payment_terms_days' => 15,
    ])->assertRedirect();

    return (string) DB::table('invoices')->orderByDesc('created_at')->value('id');
}

/* ── Qué se puede facturar ──────────────────────────────────────────────── */

it('solo ofrece cargas entregadas y sin facturar', function () {
    signIn($this->scenario, Role::Admin);
    cargaEntregada($this->scenario);

    $this->get('/invoices/create?carrier='.$this->scenario->assignedCarrier->id)
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('loads', 1));
});

it('una carga sin entregar no se factura', function () {
    signIn($this->scenario, Role::Admin);

    DB::table('loads')->where('id', $this->scenario->load->id)->update([
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'status' => 'in_transit',
    ]);

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$this->scenario->load->id],
    ])->assertSessionHasErrors('load_ids');
});

/* ── Emitir ─────────────────────────────────────────────────────────────── */

it('crea la factura, su línea y CONGELA los números', function () {
    signIn($this->scenario, Role::Admin);
    $id = facturar($this->scenario);

    $factura = DB::table('invoices')->where('id', $id)->first();

    // 10 % de 250.000 = 25.000 centavos.
    expect($factura->status)->toBe('draft')
        ->and((int) $factura->total_cents)->toBe(25000)
        ->and((int) $factura->balance_cents)->toBe(25000)
        ->and($factura->invoice_number)->toStartWith('INV-');

    expect(DB::table('invoice_line_items')->where('invoice_id', $id)->count())->toBe(1);

    // Lo que hace defendible una factura es que sus cifras no dependan de nada
    // vivo. Si mañana se le sube la tarifa al transportista, esto no cambia.
    $snapshot = DB::table('financial_snapshots')->where('load_id', $this->scenario->load->id)->first();

    expect($snapshot)->not->toBeNull()
        ->and((int) $snapshot->version)->toBe(1)
        ->and((int) $snapshot->dispatch_fee_amount_cents)->toBe(25000)
        ->and($snapshot->computed_by_user_id)->not->toBeNull();
});

it('no se factura dos veces la misma carga', function () {
    signIn($this->scenario, Role::Admin);
    facturar($this->scenario);

    $this->get('/invoices/create?carrier='.$this->scenario->assignedCarrier->id)
        ->assertInertia(fn (Assert $page) => $page->has('loads', 0));
});

it('anular devuelve la carga a lo facturable', function () {
    signIn($this->scenario, Role::Admin);
    $id = facturar($this->scenario);

    $this->post("/invoices/{$id}/void", ['reason' => 'Se facturó al transportista equivocado.'])
        ->assertRedirect();

    // Lo facturado se mira en las líneas de facturas VIVAS, no en una columna
    // paralela que se quedaría desincronizada justo aquí.
    $this->get('/invoices/create?carrier='.$this->scenario->assignedCarrier->id)
        ->assertInertia(fn (Assert $page) => $page->has('loads', 1));
});

/* ── Enviar ─────────────────────────────────────────────────────────────── */

it('enviar fija la fecha de vencimiento desde el plazo', function () {
    signIn($this->scenario, Role::Admin);
    $id = facturar($this->scenario);

    $this->post("/invoices/{$id}/send")->assertRedirect();

    $f = DB::table('invoices')->where('id', $id)->first();

    // El plazo cuenta desde que la factura SALE, no desde que se preparó.
    expect($f->status)->toBe('sent')
        ->and($f->issue_date)->not->toBeNull()
        ->and(substr((string) $f->due_date, 0, 10))->toBe(now()->addDays(15)->toDateString());
});

it('solo se envía un borrador', function () {
    signIn($this->scenario, Role::Admin);
    $id = facturar($this->scenario);

    $this->post("/invoices/{$id}/send");
    $this->post("/invoices/{$id}/send")->assertSessionHasErrors('status');
});

/* ── Cobrar ─────────────────────────────────────────────────────────────── */

it('anota cobros parciales y cierra al llegar al total', function () {
    signIn($this->scenario, Role::Admin);
    $id = facturar($this->scenario);
    $this->post("/invoices/{$id}/send");

    // `method` y `status` son obligatorios desde que anotar un cobro escribe
    // una fila en `payments`: sin ellos no se sabría con qué entró el dinero.
    $this->post("/invoices/{$id}/payments", ['amount_cents' => 10000, 'method' => 'check', 'status' => 'succeeded'])->assertRedirect();

    $f = DB::table('invoices')->where('id', $id)->first();
    expect((int) $f->balance_cents)->toBe(15000)
        ->and($f->status)->toBe('sent');

    $this->post("/invoices/{$id}/payments", ['amount_cents' => 15000, 'method' => 'check', 'status' => 'succeeded'])->assertRedirect();

    $f = DB::table('invoices')->where('id', $id)->first();
    expect((int) $f->balance_cents)->toBe(0)
        ->and($f->status)->toBe('paid')
        ->and($f->paid_at)->not->toBeNull();
});

it('no se cobra más que el saldo', function () {
    signIn($this->scenario, Role::Admin);
    $id = facturar($this->scenario);
    $this->post("/invoices/{$id}/send");

    $this->post("/invoices/{$id}/payments", ['amount_cents' => 99999, 'method' => 'check', 'status' => 'succeeded'])
        ->assertSessionHasErrors('amount_cents');
});

it('una factura con cobros no se anula', function () {
    signIn($this->scenario, Role::Admin);
    $id = facturar($this->scenario);
    $this->post("/invoices/{$id}/send");
    $this->post("/invoices/{$id}/payments", ['amount_cents' => 5000, 'method' => 'check', 'status' => 'succeeded']);

    $this->post("/invoices/{$id}/void", ['reason' => 'Me he equivocado en el importe.'])
        ->assertSessionHasErrors('reason');
});

/* ── Quién ve qué ───────────────────────────────────────────────────────── */

it('el transportista ve sus facturas, no las de otros', function () {
    signIn($this->scenario, Role::Admin);
    facturar($this->scenario);

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Carrier);

    // `invoice:read` se le concede con alcance Carrier, y aquí eso es un
    // filtro, no un 403: que vea lo que se le cobra es lo que debe pasar.
    $this->get('/invoices')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('invoices.data', 1));
});

it('el despachador no entra en facturas', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/invoices')->assertForbidden();
});
