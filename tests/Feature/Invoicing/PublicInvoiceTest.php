<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Finance\InvoiceLink;
use App\Support\Finance\InvoicePayments;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    Mail::fake();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Una factura emitida a nombre del transportista asignado. */
function facturaDePrueba(Scenario $scenario, int $total = 250000, string $estado = 'sent'): object
{
    $id = (string) Str::uuid();

    DB::table('invoices')->insert([
        'id' => $id,
        'tenant_id' => $scenario->tenant->id,
        'invoice_number' => 'INV-'.substr($id, 0, 6),
        'carrier_id' => $scenario->assignedCarrier->id,
        // `sent`, no `draft`. Una factura con enlace público ESTÁ enviada: el
        // testigo lo emite `send()`, que es lo que la saca de borrador. El
        // montaje de antes construía un estado que producción no alcanza —una
        // borrador pagable— y pasaba porque el camino de la pasarela no miraba
        // el estado. En cuanto ese camino empezó a usar el recalculador de
        // verdad, que sí lo mira, la prueba enseñó que su factura era imposible.
        'status' => $estado,
        'issue_date' => $estado === 'draft' ? null : now(),
        'sent_at' => $estado === 'draft' ? null : now(),
        'subtotal_cents' => $total,
        'total_cents' => $total,
        'balance_cents' => $total,
        'payment_terms_days' => 30,
        'due_date' => now()->addDays(30),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    DB::table('invoice_line_items')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $scenario->tenant->id,
        'invoice_id' => $id,
        'sequence' => 1,
        'description_en' => 'Dispatch fee',
        'description_es' => 'Cuota de despacho',
        'quantity' => 1,
        'unit_amount_cents' => $total,
        'amount_cents' => $total,
        'kind' => 'dispatch_fee',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return DB::table('invoices')->where('id', $id)->first();
}

/** Le pone al transportista un contacto de facturación. */
function contactoDeFacturacion(Scenario $scenario, string $email, string $locale = 'es'): void
{
    DB::table('carrier_contacts')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $scenario->tenant->id,
        'carrier_id' => $scenario->assignedCarrier->id,
        'first_name' => 'Rosa',
        'last_name' => 'Cuentas',
        'email' => $email,
        'position' => 'billing',
        'preferred_locale' => $locale,
        'is_primary' => 0,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

// ───────────────────────────────────────────────────────────── a quién va

it('va al contacto de FACTURACIÓN, no al principal', function () {
    // Mandarle una factura al jefe de tráfico es cómo se consigue que la pague
    // nadie.
    DB::table('carrier_contacts')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'first_name' => 'Luis', 'last_name' => 'Tráfico',
        'email' => 'trafico@transportista.test',
        'position' => 'dispatch', 'preferred_locale' => 'en', 'is_primary' => 1,
        'created_at' => now(), 'updated_at' => now(),
    ]);
    contactoDeFacturacion($this->scenario, 'cuentas@transportista.test');

    $destino = InvoiceLink::destinatario(
        (string) $this->scenario->tenant->id,
        (string) $this->scenario->assignedCarrier->id,
    );

    expect($destino['email'])->toBe('cuentas@transportista.test')
        // Y en SU idioma: `carrier_contacts.preferred_locale` dice literalmente
        // «el idioma en el que se le escribe a esta persona».
        ->and($destino['locale'])->toBe('es');
});

it('emitir la factura la manda de verdad y anota a quién', function () {
    contactoDeFacturacion($this->scenario, 'cuentas@transportista.test');
    // La única que necesita salir de BORRADOR: emitir es justo lo que la saca.
    $factura = facturaDePrueba($this->scenario, estado: 'draft');

    signIn($this->scenario, Role::Accounting);

    $this->post("/invoices/{$factura->id}/send")->assertSessionHasNoErrors();

    $fresca = DB::table('invoices')->where('id', $factura->id)->first();

    expect($fresca->status)->toBe('sent')
        ->and($fresca->sent_to)->toBe('cuentas@transportista.test')
        ->and($fresca->public_token_hash)->not->toBeNull();
});

// ────────────────────────────────────────────────────────── la página pública

it('el enlace abre la factura sin sesión', function () {
    $factura = facturaDePrueba($this->scenario);
    $token = InvoiceLink::issue($factura);

    $props = $this->get("/i/{$token}")->assertOk()->viewData('page')['props'];

    expect($props['state'])->toBe('active')
        ->and($props['invoice']['number'])->toBe($factura->invoice_number)
        ->and($props['invoice']['lines'])->toHaveCount(1);
});

it('la página pública NO enseña nada del margen', function () {
    // Un `select *` aquí se convierte en una filtración el día que alguien añada
    // una columna a `invoices`.
    $factura = facturaDePrueba($this->scenario);
    $token = InvoiceLink::issue($factura);

    $props = $this->get("/i/{$token}")->assertOk()->viewData('page')['props'];

    foreach (['notes', 'carrier_id', 'load_id', 'stripe_invoice_id'] as $prohibido) {
        expect($props['invoice'])->not->toHaveKey($prohibido);
    }
});

it('un testigo que no existe no dice de quién era', function () {
    $this->get('/i/'.Str::random(48))->assertNotFound();
});

it('el enlace caduca DESPUÉS del vencimiento, no antes', function () {
    // Un enlace que caduca antes de que alguien pague es una llamada a soporte y
    // una factura que se cobra más tarde.
    $factura = facturaDePrueba($this->scenario);
    InvoiceLink::issue($factura);

    $vence = DB::table('invoices')->where('id', $factura->id)->value('public_token_expires_at');

    expect(now()->parse($vence)->isAfter(now()->parse($factura->due_date)))->toBeTrue();
});

// ─────────────────────────────────────────────────────────────────── el cobro

it('dos pulsaciones del mismo botón no cobran dos veces', function () {
    // La idempotencia la da el índice único, no una comprobación: entre un
    // «¿ya existe?» y un insert hay una ventana, y las pasarelas reintentan
    // justo ahí.
    $factura = facturaDePrueba($this->scenario);
    $tenantId = (string) $this->scenario->tenant->id;

    $clave = 'inv_'.$factura->id.'_'.$factura->balance_cents;

    expect(InvoicePayments::start($tenantId, (string) $factura->id, 250000, 'card', $clave, 'pi_1'))->not->toBeNull()
        ->and(InvoicePayments::start($tenantId, (string) $factura->id, 250000, 'card', $clave, 'pi_2'))->toBeNull();

    expect(DB::table('payment_attempts')->where('invoice_id', $factura->id)->count())->toBe(1);
});

it('el cobro que entra se anota y salda la factura', function () {
    $factura = facturaDePrueba($this->scenario);
    $tenantId = (string) $this->scenario->tenant->id;
    $clave = 'inv_'.$factura->id.'_250000';

    InvoicePayments::start($tenantId, (string) $factura->id, 250000, 'card', $clave, 'pi_1');

    expect(InvoicePayments::settle($clave, true, providerReference: 'pi_1'))->toBeTrue();

    $fresca = DB::table('invoices')->where('id', $factura->id)->first();

    expect($fresca->status)->toBe('paid')
        ->and((int) $fresca->balance_cents)->toBe(0)
        ->and((int) $fresca->amount_paid_cents)->toBe(250000)
        ->and($fresca->paid_at)->not->toBeNull()
        ->and(DB::table('payments')->where('invoice_id', $factura->id)->count())->toBe(1);
});

it('un pago parcial NO da la factura por pagada', function () {
    // Darla por pagada con saldo pendiente es cómo se pierde dinero sin que
    // salte ninguna alarma.
    $factura = facturaDePrueba($this->scenario, 250000);
    $tenantId = (string) $this->scenario->tenant->id;

    InvoicePayments::start($tenantId, (string) $factura->id, 100000, 'card', 'parcial', 'pi_1');
    InvoicePayments::settle('parcial', true);

    $fresca = DB::table('invoices')->where('id', $factura->id)->first();

    expect($fresca->status)->not->toBe('paid')
        ->and((int) $fresca->balance_cents)->toBe(150000);
});

it('un pago que falla no anota ningún cobro, y deja el motivo', function () {
    $factura = facturaDePrueba($this->scenario);
    $tenantId = (string) $this->scenario->tenant->id;

    InvoicePayments::start($tenantId, (string) $factura->id, 250000, 'card', 'fallido', 'pi_1');
    InvoicePayments::settle('fallido', false, 'card_declined', 'Fondos insuficientes.');

    expect(DB::table('payments')->where('invoice_id', $factura->id)->count())->toBe(0);

    $intento = DB::table('payment_attempts')->where('idempotency_key', 'fallido')->first();

    expect($intento->status)->toBe('failed')
        ->and($intento->failure_code)->toBe('card_declined')
        ->and((int) DB::table('invoices')->where('id', $factura->id)->value('balance_cents'))->toBe(250000);
});

it('un reintento del proveedor no vuelve a cobrar', function () {
    $factura = facturaDePrueba($this->scenario);
    $tenantId = (string) $this->scenario->tenant->id;

    InvoicePayments::start($tenantId, (string) $factura->id, 250000, 'card', 'unico', 'pi_1');

    expect(InvoicePayments::settle('unico', true))->toBeTrue()
        ->and(InvoicePayments::settle('unico', true))->toBeFalse()
        ->and(DB::table('payments')->where('invoice_id', $factura->id)->count())->toBe(1);
});

it('tras un pago rechazado se puede volver a intentar', function () {
    // Con una clave fija por factura e importe, el segundo intento chocaba
    // contra el primero y la factura quedaba IMPAGABLE PARA SIEMPRE. Lo encontró
    // el navegador recorriendo el camino del fallo antes que el del éxito.
    $factura = facturaDePrueba($this->scenario, 250000);
    $token = InvoiceLink::issue($factura);

    $this->post("/i/{$token}/pay")->assertRedirect();

    $primero = DB::table('payment_attempts')->where('invoice_id', $factura->id)->first();
    InvoicePayments::settle((string) $primero->idempotency_key, false, 'card_declined');

    // Y otra vez.
    $this->post("/i/{$token}/pay")->assertRedirect();

    expect(DB::table('payment_attempts')->where('invoice_id', $factura->id)->count())->toBe(2);

    $segundo = DB::table('payment_attempts')
        ->where('invoice_id', $factura->id)
        ->where('status', 'pending')
        ->first();

    expect($segundo)->not->toBeNull()
        ->and(InvoicePayments::settle((string) $segundo->idempotency_key, true))->toBeTrue()
        ->and(DB::table('invoices')->where('id', $factura->id)->value('status'))->toBe('paid');
});

it('dos pulsaciones seguidas del botón son un solo intento', function () {
    $factura = facturaDePrueba($this->scenario, 250000);
    $token = InvoiceLink::issue($factura);

    $this->post("/i/{$token}/pay")->assertRedirect();
    $this->post("/i/{$token}/pay")->assertRedirect();

    expect(DB::table('payment_attempts')->where('invoice_id', $factura->id)->count())->toBe(1);
});
