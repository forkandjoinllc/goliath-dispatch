<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Finance\DefaultExpenseCategories;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * La suma que hay encima de una lista es la suma de esa lista.
 *
 * Cuatro pantallas de dinero enseñan una fila de totales sobre la lista. Gastos
 * y cobros no aplicaban NINGÚN filtro al sumar; facturas y liquidaciones
 * aplicaban solo el de estado, con su propia copia, e ignoraban la búsqueda y
 * «solo vencidas».
 *
 * Medido en la demostración:
 *
 *     /payments?status=disputed   → 0 filas, «En casa 1.721,74 $»
 *     /expenses?status=submitted  → 0 filas, «Ya cuenta 7.909,00 $»
 *     /settlements?search=zzz     → 0 filas, «Neto 14.874,00 $»
 *     /invoices?search=INV-01001  → 1 fila,  la suma de las TRES
 *
 * Estas pruebas suman las filas que la pantalla devuelve y las comparan con el
 * total que pone encima. Sumar las filas visibles y no repetir la consulta es a
 * propósito: una prueba que vuelve a consultar puede equivocarse igual que el
 * controlador, y entonces las dos coinciden y no se mide nada.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Los props de una pantalla de lista. */
function propsDe(string $href): array
{
    return json_decode((string) json_encode(
        test()->get($href)->assertOk()->viewData('page')['props'] ?? []
    ), true);
}

/**
 * Suma un campo de las filas que la pantalla enseña.
 *
 * OJO: solo vale mientras quepan en una página. Las pruebas de aquí plantan
 * pocas filas a propósito — si algún día una pasa de la paginación, la suma de
 * lo visible dejaría de ser la del filtro y la prueba mediría otra cosa.
 */
function sumaVisible(array $props, string $lista, string $campo): int
{
    $filas = $props[$lista]['data'] ?? [];

    test()->assertLessThanOrEqual(
        (int) ($props[$lista]['meta']['perPage'] ?? 0),
        (int) ($props[$lista]['meta']['total'] ?? 0),
        'Esta prueba suma lo VISIBLE: con más de una página dejaría de medir el filtro.',
    );

    return (int) array_sum(array_column($filas, $campo));
}

function filasVisibles(array $props, string $lista): int
{
    return (int) ($props[$lista]['meta']['total'] ?? -1);
}

/* ── Gastos ────────────────────────────────────────────────────────────── */

it('gastos: la suma es la de las filas filtradas, y cero cuando no hay ninguna', function (): void {
    // El escenario no siembra categorías: se crean las de serie, igual que
    // hace la aplicación la primera vez que una empresa entra a gastos.
    app(TenantContext::class)->runAs(
        (string) $this->scenario->tenant->id,
        fn () => DefaultExpenseCategories::ensureFor((string) $this->scenario->tenant->id),
    );

    $categoria = (string) DB::table('expense_categories')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->value('id');

    foreach ([['approved', 50000], ['approved', 30000], ['rejected', 99999]] as [$estado, $centavos]) {
        DB::table('expenses')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'load_id' => $this->scenario->load->id,
            'category_id' => $categoria,
            'treatment_snapshot' => 'tenant_absorbed',
            'description' => 'Gasto de prueba',
            'amount_cents' => $centavos,
            'status' => $estado,
            'incurred_on' => now(),
            'submitted_by_user_id' => $this->scenario->user(Role::Admin)->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    signIn($this->scenario, Role::Admin);

    // Aprobados: los dos primeros y no el rechazado.
    $p = propsDe('/expenses?status=approved');
    expect($p['totals']['countingCents'])->toBe(sumaVisible($p, 'expenses', 'amountCents'));
    expect($p['totals']['countingCents'])->toBe(80000);

    // Y la lista vacía lleva un cero encima, no la suma de otra cosa.
    $vacia = propsDe('/expenses?status=submitted');
    expect(filasVisibles($vacia, 'expenses'))->toBe(0);
    expect($vacia['totals']['countingCents'])->toBe(0);
    expect($vacia['totals']['pendingCents'])->toBe(0);
});

/* ── Cobros ────────────────────────────────────────────────────────────── */

it('cobros: la suma responde al método elegido', function (): void {
    $factura = facturaSuelta($this->scenario);

    cobroSuelto($this->scenario, $factura, 40000, 'check');
    cobroSuelto($this->scenario, $factura, 25000, 'wire');

    signIn($this->scenario, Role::Admin);

    $p = propsDe('/payments?method=check');
    expect(filasVisibles($p, 'payments'))->toBe(1);
    expect($p['totals']['settledCents'])->toBe(40000);

    $q = propsDe('/payments?method=wire');
    expect($q['totals']['settledCents'])->toBe(25000);

    // Sin filtro, los dos.
    expect(propsDe('/payments')['totals']['settledCents'])->toBe(65000);
});

it('cobros: filtrar por un estado sin filas deja la suma en cero', function (): void {
    $factura = facturaSuelta($this->scenario);
    cobroSuelto($this->scenario, $factura, 40000, 'check');

    signIn($this->scenario, Role::Admin);

    // Era el caso medido: cero filas y «En casa 1.721,74 $» encima.
    $p = propsDe('/payments?status=cancelled');

    expect(filasVisibles($p, 'payments'))->toBe(0);
    expect($p['totals']['settledCents'])->toBe(0);
    expect($p['totals']['pendingCents'])->toBe(0);
    expect($p['totals']['disputedCents'])->toBe(0);
});

/* ── Facturas: la suma que aplicaba MEDIO filtro ───────────────────────── */

it('facturas: la búsqueda mueve la suma, no solo la lista', function (): void {
    $a = facturaSuelta($this->scenario, 'INV-AAA-1', 100000);
    facturaSuelta($this->scenario, 'INV-BBB-2', 250000);

    signIn($this->scenario, Role::Admin);

    $p = propsDe('/invoices?search=AAA');

    expect(filasVisibles($p, 'invoices'))->toBe(1);
    expect($p['totals']['totalCents'])->toBe(100000);
    expect($p['totals']['totalCents'])->toBe(sumaVisible($p, 'invoices', 'totalCents'));

    expect($a)->not->toBe('');
});

it('facturas: «solo vencidas» mueve la suma', function (): void {
    $vencida = facturaSuelta($this->scenario, 'INV-VEN-1', 100000);
    facturaSuelta($this->scenario, 'INV-VIG-2', 250000);

    DB::table('invoices')->where('id', $vencida)->update([
        'due_date' => now()->subMonth(),
        'status' => 'overdue',
    ]);

    signIn($this->scenario, Role::Admin);

    $p = propsDe('/invoices?overdue=1');

    expect(filasVisibles($p, 'invoices'))->toBe(1);
    expect($p['totals']['totalCents'])->toBe(100000);
});

it('facturas: el filtro de estado sigue moviendo la suma', function (): void {
    // El medio filtro que SÍ funcionaba. Se fija para que arreglar el otro
    // medio no lo rompa.
    $anulada = facturaSuelta($this->scenario, 'INV-ANU-1', 100000);
    facturaSuelta($this->scenario, 'INV-VIV-2', 250000);

    DB::table('invoices')->where('id', $anulada)->update(['status' => 'voided']);

    signIn($this->scenario, Role::Admin);

    expect(propsDe('/invoices?status=voided')['totals']['totalCents'])->toBe(100000);
});

/* ── Liquidaciones ─────────────────────────────────────────────────────── */

it('liquidaciones: una búsqueda sin resultados deja la suma en cero', function (): void {
    DB::table('carrier_settlements')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'settlement_number' => 'STL-0001',
        'status' => 'draft',
        'period_start' => now()->subWeek()->toDateString(),
        'period_end' => now()->toDateString(),
        'gross_rate_cents' => 500000,
        'dispatch_fees_cents' => 50000,
        'net_amount_cents' => 450000,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    signIn($this->scenario, Role::Admin);

    expect(propsDe('/settlements')['totals']['netCents'])->toBe(450000);

    $p = propsDe('/settlements?search=NO-EXISTE');

    expect(filasVisibles($p, 'settlements'))->toBe(0);
    expect($p['totals']['netCents'])->toBe(0);
    expect($p['totals']['dispatchFeesCents'])->toBe(0);
});

/* ── El ámbito sigue en pie ────────────────────────────────────────────── */

it('las sumas siguen contando solo dentro del ámbito del actor', function (): void {
    // El arreglo añade filtros; no puede quitarle el ámbito. Un transportista
    // que viera la suma de la empresa sabría cuánto factura la oficina aunque
    // solo pueda abrir lo suyo.
    $mia = facturaSuelta($this->scenario, 'INV-MIA-1', 100000);
    $ajena = '';

    // Y una de OTRO transportista, que no debe sumar.
    $ajeno = (string) DB::table('carriers')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('id', '!=', $this->scenario->assignedCarrier->id)
        ->value('id');

    if ($ajeno !== '') {
        $ajena = (string) Str::uuid();

        DB::table('invoices')->insert([
            'id' => $ajena,
            'tenant_id' => $this->scenario->tenant->id,
            'carrier_id' => $ajeno,
            'invoice_number' => 'INV-AJENA-1',
            'status' => 'sent',
            'subtotal_cents' => 777000,
            'total_cents' => 777000,
            'balance_cents' => 777000,
            'issue_date' => now(),
            'due_date' => now()->addDays(30),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // Y un cobro contra cada una, para medir lo mismo en la pantalla de cobros:
    // un sabotaje que cambiara `scoped()` por la tabla entera se escapaba
    // mientras esta prueba solo miraba facturas.
    cobroSuelto($this->scenario, $mia, 40000, 'check');

    if ($ajena !== '') {
        cobroSuelto($this->scenario, $ajena, 500000, 'wire');
    }

    signIn($this->scenario, Role::Carrier);

    $facturas = propsDe('/invoices');

    expect($facturas['totals']['totalCents'])->toBe(sumaVisible($facturas, 'invoices', 'totalCents'));
    expect($facturas['totals']['totalCents'])->toBeLessThan(777000);

    $cobros = propsDe('/payments');

    expect($cobros['totals']['settledCents'])->toBe(sumaVisible($cobros, 'payments', 'amountCents'));
    expect($cobros['totals']['settledCents'])->toBeLessThan(500000);
});

/* ── Ayudantes ─────────────────────────────────────────────────────────── */

function facturaSuelta(Scenario $s, string $numero = '', int $centavos = 50000): string
{
    $id = (string) Str::uuid();

    DB::table('invoices')->insert([
        'id' => $id,
        'tenant_id' => $s->tenant->id,
        'carrier_id' => $s->assignedCarrier->id,
        'invoice_number' => $numero !== '' ? $numero : 'INV-'.Str::upper(Str::random(6)),
        'status' => 'sent',
        'subtotal_cents' => $centavos,
        'total_cents' => $centavos,
        'balance_cents' => $centavos,
        'issue_date' => now(),
        'due_date' => now()->addDays(30),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

function cobroSuelto(Scenario $s, string $invoiceId, int $centavos, string $metodo): void
{
    DB::table('payments')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $s->tenant->id,
        'invoice_id' => $invoiceId,
        'amount_cents' => $centavos,
        'method' => $metodo,
        'status' => 'succeeded',
        'received_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}
