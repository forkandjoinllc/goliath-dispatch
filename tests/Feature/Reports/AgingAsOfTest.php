<?php

declare(strict_types=1);

use App\Enums\Role;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * «Un periodo cerrado dice siempre lo mismo» — ahora medido.
 *
 * El rótulo del informe lo promete. La antigüedad del cobro leía TODAS las
 * facturas abiertas de la historia, contra el día de hoy, sin mirar el periodo.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    $this->escenario = Scenario::create();
    $this->tenantId = (string) $this->escenario->tenant->id;
});

/**
 * @param  array<string, mixed>  $extra
 */
function factura(string $tenantId, Scenario $e, string $emitida, int $centavos, array $extra = []): string
{
    $id = (string) Str::uuid();

    DB::table('invoices')->insert([
        'id' => $id, 'tenant_id' => $tenantId,
        'customer_id' => $e->customer->id, 'carrier_id' => $e->assignedCarrier->id,
        'invoice_number' => 'INV-'.substr($id, 0, 8),
        'status' => 'sent', 'issue_date' => $emitida,
        'due_date' => $emitida, 'subtotal_cents' => $centavos,
        'total_cents' => $centavos, 'balance_cents' => $centavos,
        'created_at' => $emitida.' 12:00:00', 'updated_at' => $emitida.' 12:00:00',
        ...$extra,
    ]);

    return $id;
}

function cobro(string $tenantId, string $invoiceId, int $centavos, string $recibido, ?string $devuelto = null, int $reembolso = 0): void
{
    DB::table('payments')->insert([
        'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'invoice_id' => $invoiceId,
        'amount_cents' => $centavos, 'method' => 'check',
        'status' => $devuelto === null ? 'succeeded' : 'refunded',
        'received_at' => $recibido.' 12:00:00',
        'refunded_amount_cents' => $reembolso,
        'refunded_at' => $devuelto === null ? null : $devuelto.' 12:00:00',
        'created_at' => $recibido.' 12:00:00', 'updated_at' => $recibido.' 12:00:00',
    ]);
}

/**
 * @return array{pendiente: int, aFecha: string, tramos: array<string, mixed>}
 */
function informe(object $prueba, string $desde, string $hasta): array
{
    $r = $prueba->get("/reports?from={$desde}&to={$hasta}");
    $p = json_decode((string) json_encode($r->viewData('page')['props'] ?? []), true);

    return [
        'pendiente' => (int) ($p['summary']['outstandingCents'] ?? -1),
        'aFecha' => (string) ($p['agingAsOf'] ?? ''),
        'tramos' => $p['aging'] ?? [],
    ];
}

/* ── Lo que se midió ─────────────────────────────────────────────────────── */

it('una factura posterior al periodo no entra en el informe del periodo', function (): void {
    // La medida exacta de antes de arreglarlo: enero decía 0, se emitía una
    // factura en septiembre, y enero pasaba a decir 250.000.
    signIn($this->escenario, Role::Admin);

    $enero = informe($this, '2026-01-01', '2026-01-31');

    factura($this->tenantId, $this->escenario, '2026-09-01', 250000);

    expect(informe($this, '2026-01-01', '2026-01-31')['pendiente'])->toBe($enero['pendiente']);
});

it('una factura del periodo sí entra, y en su tramo', function (): void {
    signIn($this->escenario, Role::Admin);

    factura($this->tenantId, $this->escenario, '2026-01-05', 100000);

    // A 31 de enero llevaba 26 días vencida.
    $r = informe($this, '2026-01-01', '2026-01-31');

    expect($r['pendiente'])->toBe(100000)
        ->and($r['tramos']['d1_30']['amountCents'] ?? 0)->toBe(100000)
        ->and($r['tramos']['d1_30']['count'] ?? 0)->toBe(1);
});

it('el mismo periodo dice lo mismo en marzo que en enero', function (): void {
    // El tramo se cuenta contra la fecha del periodo, no contra hoy. Si se
    // contara contra hoy, esa misma factura iría saltando de tramo cada mes y
    // el informe de enero sería distinto en cada visita.
    signIn($this->escenario, Role::Admin);

    factura($this->tenantId, $this->escenario, '2026-01-05', 100000);

    $r = informe($this, '2026-01-01', '2026-01-31');

    expect($r['tramos']['d90plus']['amountCents'] ?? 0)->toBe(0)
        ->and($r['aFecha'])->toBe('2026-01-31');
});

/* ── El saldo de una fecha pasada ────────────────────────────────────────── */

it('un cobro posterior al periodo no salda la factura de ese periodo', function (): void {
    // `balance_cents` es el saldo de HOY. Leerlo diría que en enero no se debía
    // nada, cuando el dinero llegó en junio.
    signIn($this->escenario, Role::Admin);

    $id = factura($this->tenantId, $this->escenario, '2026-01-05', 100000);
    cobro($this->tenantId, $id, 100000, '2026-06-10');

    expect(informe($this, '2026-01-01', '2026-01-31')['pendiente'])->toBe(100000)
        ->and(informe($this, '2026-01-01', '2026-06-30')['pendiente'])->toBe(0);
});

it('un cobro que entró en enero y se devolvió en marzo estaba en casa en enero', function (): void {
    signIn($this->escenario, Role::Admin);

    $id = factura($this->tenantId, $this->escenario, '2026-01-05', 100000);
    cobro($this->tenantId, $id, 100000, '2026-01-20', '2026-03-15', 100000);

    // En enero: cobrada. En marzo: vuelve a deberse.
    expect(informe($this, '2026-01-01', '2026-01-31')['pendiente'])->toBe(0)
        ->and(informe($this, '2026-01-01', '2026-03-31')['pendiente'])->toBe(100000);
});

it('un cobro parcial deja el resto en su tramo', function (): void {
    signIn($this->escenario, Role::Admin);

    $id = factura($this->tenantId, $this->escenario, '2026-01-05', 100000);
    cobro($this->tenantId, $id, 40000, '2026-01-10');

    expect(informe($this, '2026-01-01', '2026-01-31')['pendiente'])->toBe(60000);
});

it('un cheque que no ha compensado no salda nada', function (): void {
    // La regla de la casa de PaymentLedger: un cobro `pending` está anotado
    // para no perderlo de vista, no para dar la factura por cobrada. Aquí hace
    // falta el complemento de esa lista y no la lista: un cobro hoy en
    // `refunded` SÍ fue dinero en su día y para una foto de enero cuenta; uno
    // en `pending` no lo fue nunca.
    signIn($this->escenario, Role::Admin);

    $id = factura($this->tenantId, $this->escenario, '2026-01-05', 100000);

    DB::table('payments')->insert([
        'id' => (string) Str::uuid(), 'tenant_id' => $this->tenantId, 'invoice_id' => $id,
        'amount_cents' => 100000, 'method' => 'check', 'status' => 'pending',
        'received_at' => '2026-01-10 12:00:00', 'refunded_amount_cents' => 0,
        'created_at' => '2026-01-10 12:00:00', 'updated_at' => '2026-01-10 12:00:00',
    ]);

    expect(informe($this, '2026-01-01', '2026-01-31')['pendiente'])->toBe(100000);
});

it('una factura saldada no ocupa tramo ni cuenta', function (): void {
    // Sin el corte por saldo, una factura cobrada del todo seguiría apareciendo
    // en su tramo con importe cero: la cartera diría «$0 en 1 factura», y quien
    // la lee busca una factura que no debe nada.
    signIn($this->escenario, Role::Admin);

    $id = factura($this->tenantId, $this->escenario, '2026-01-05', 100000);
    cobro($this->tenantId, $id, 100000, '2026-01-10');

    $r = informe($this, '2026-01-01', '2026-01-31');

    expect($r['pendiente'])->toBe(0);

    foreach ($r['tramos'] as $tramo => $datos) {
        expect($datos['count'])->toBe(0, "El tramo {$tramo} cuenta una factura que no debe nada.");
    }
});

/* ── Las fechas de la factura ────────────────────────────────────────────── */

it('una factura anulada después del periodo se debía durante el periodo', function (): void {
    // Anular en marzo no borra que en enero se debía. `voided_at` lleva fecha.
    signIn($this->escenario, Role::Admin);

    factura($this->tenantId, $this->escenario, '2026-01-05', 100000, [
        'status' => 'voided', 'voided_at' => '2026-03-01 12:00:00', 'balance_cents' => 0,
    ]);

    expect(informe($this, '2026-01-01', '2026-01-31')['pendiente'])->toBe(100000)
        ->and(informe($this, '2026-01-01', '2026-03-31')['pendiente'])->toBe(0);
});

it('un borrador no se debe nunca', function (): void {
    signIn($this->escenario, Role::Admin);

    factura($this->tenantId, $this->escenario, '2026-01-05', 100000, ['status' => 'draft']);

    expect(informe($this, '2026-01-01', '2026-01-31')['pendiente'])->toBe(0);
});

/* ── La fecha de la foto ─────────────────────────────────────────────────── */

it('un periodo que llega al futuro se para en hoy', function (): void {
    // Una cartera no puede decir lo que se deberá el mes que viene.
    signIn($this->escenario, Role::Admin);

    $r = informe($this, '2026-01-01', now()->addYear()->toDateString());

    expect($r['aFecha'])->toBe(now()->toDateString());
});

it('la pantalla recibe la fecha de la foto', function (): void {
    signIn($this->escenario, Role::Admin);

    expect(informe($this, '2026-01-01', '2026-01-31')['aFecha'])->toBe('2026-01-31');
});
