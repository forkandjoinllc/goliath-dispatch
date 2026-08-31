<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Database\Seeders\DemoDataSeeder;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;

uses(DatabaseTransactions::class);

beforeEach(fn () => app(TenantContext::class)->forget());
afterEach(fn () => app(TenantContext::class)->forget());

/**
 * El sembrador de demostración como PRUEBA DE HUMO.
 *
 * No se comprueba que la demostración sea bonita: se comprueba que la cadena del
 * dinero entera —facturar, cobrar, liquidar, devengar— corre de principio a fin
 * llamando al código real. Si alguien rompe un eslabón, esto lo dice aquí y no
 * delante de un cliente.
 */
it('siembra la cadena del dinero entera', function () {
    $this->seed(DemoDataSeeder::class);

    $tenantId = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('tenants')->where('slug', 'demo-dispatch')->value('id')
    );

    expect($tenantId)->not->toBeNull();

    $cuenta = static fn (string $tabla): int => (int) DB::table($tabla)
        ->where('tenant_id', $tenantId)->count();

    // Cada eslabón tiene que haber dejado filas. Un cero aquí significa que la
    // demostración enseñaría esa pantalla vacía.
    expect($cuenta('invoices'))->toBeGreaterThan(0)
        ->and($cuenta('invoice_line_items'))->toBeGreaterThan(0)
        ->and($cuenta('financial_snapshots'))->toBeGreaterThan(0)
        ->and($cuenta('payments'))->toBeGreaterThan(0)
        ->and($cuenta('carrier_settlements'))->toBeGreaterThan(0)
        ->and($cuenta('dispatcher_commissions'))->toBeGreaterThan(0);
});

it('deja facturas en tramos distintos de antigüedad', function () {
    $this->seed(DemoDataSeeder::class);

    $tenantId = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('tenants')->where('slug', 'demo-dispatch')->value('id')
    );

    $facturas = DB::table('invoices')->where('tenant_id', $tenantId)->get(['balance_cents', 'due_date']);

    // Con todas las facturas en el mismo tramo, la antigüedad del cobro enseña
    // una sola barra y no se ve para qué sirve.
    expect($facturas->where('balance_cents', 0)->count())->toBeGreaterThan(0)
        ->and($facturas->where('balance_cents', '>', 0)->count())->toBeGreaterThan(0);

    $vencidas = $facturas->filter(
        fn ($f): bool => (int) $f->balance_cents > 0
            && $f->due_date !== null
            && $f->due_date < now()->toDateTimeString()
    );

    expect($vencidas)->not->toBeEmpty();
});

it('el saldo de cada factura cuadra con sus cobros', function () {
    $this->seed(DemoDataSeeder::class);

    $tenantId = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('tenants')->where('slug', 'demo-dispatch')->value('id')
    );

    foreach (DB::table('invoices')->where('tenant_id', $tenantId)->get() as $f) {
        $cobrado = (int) DB::table('payments')
            ->where('invoice_id', $f->id)
            ->whereNull('deleted_at')
            ->whereIn('status', ['succeeded', 'partially_refunded'])
            ->sum(DB::raw('amount_cents - refunded_amount_cents'));

        // La columna es una caché de la suma de las filas. Si se separan, el
        // sembrador ha metido dinero por su cuenta en vez de por PaymentLedger.
        expect((int) $f->amount_paid_cents)->toBe($cobrado, "factura {$f->invoice_number}")
            ->and((int) $f->balance_cents)->toBe((int) $f->total_cents - $cobrado);
    }
});

it('sembrar dos veces no duplica nada', function () {
    $this->seed(DemoDataSeeder::class);

    $tenantId = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('tenants')->where('slug', 'demo-dispatch')->value('id')
    );

    $antes = collect(['loads', 'invoices', 'payments', 'carrier_settlements', 'dispatcher_commissions'])
        ->mapWithKeys(static fn (string $t): array => [
            $t => (int) DB::table($t)->where('tenant_id', $tenantId)->count(),
        ]);

    $this->seed(DemoDataSeeder::class);

    foreach ($antes as $tabla => $n) {
        expect((int) DB::table($tabla)->where('tenant_id', $tenantId)->count())
            ->toBe($n, "la tabla {$tabla} creció al sembrar dos veces");
    }
});

it('ninguna carga sembrada recoge y entrega en el mismo sitio', function () {
    // Cinco de las once lo hacían. La causa: dos clientes tenían una sola
    // ubicación, y el sembrador elegía la primera para la recogida y la última
    // para la entrega —la misma fila—. En un sistema de despacho una carga que
    // sale y llega a la misma dirección no es un detalle cosmético: es una
    // carga que no existe, y está en la primera pantalla que abre quien evalúa
    // la demostración.
    //
    // Se vio en el desplegable de «¿de qué parada es este comprobante?», que
    // ofrecía dos veces el mismo sitio.
    $this->seed(DemoDataSeeder::class);

    $tenantId = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('tenants')->where('slug', 'demo-dispatch')->value('id')
    );

    $repetidas = app(TenantContext::class)->withoutTenant(fn () => DB::table('load_stops as s')
        ->join('loads as l', 'l.id', '=', 's.load_id')
        ->where('s.tenant_id', $tenantId)
        ->whereNull('s.deleted_at')
        ->groupBy('s.load_id', 'l.load_number')
        ->havingRaw('count(distinct s.customer_location_id) = 1')
        ->pluck('l.load_number')
        ->all());

    expect($repetidas)->toBe([], 'Cargas que recogen y entregan en el mismo sitio: '.implode(', ', $repetidas));
});

it('toda parada sembrada dice dónde está', function () {
    // La dirección de una parada puede vivir en la propia fila o en la
    // ubicación del cliente a la que apunta. Lo que no puede es no estar en
    // ninguno de los dos sitios: una parada sin dirección es una parada a la
    // que nadie puede ir.
    $this->seed(DemoDataSeeder::class);

    $tenantId = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('tenants')->where('slug', 'demo-dispatch')->value('id')
    );

    $mudas = app(TenantContext::class)->withoutTenant(fn () => DB::table('load_stops as s')
        ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
        ->where('s.tenant_id', $tenantId)
        ->whereNull('s.deleted_at')
        ->whereNull('cl.city')
        ->whereNull('s.city')
        ->count());

    expect($mudas)->toBe(0);
});
