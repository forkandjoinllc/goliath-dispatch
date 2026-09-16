<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Dashboard\Panel;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * La lista filtrada dice que lo está, y los totales son de ese filtro.
 *
 * El guardián de `tests/Unit/Suite/ListFiltersTest.php` sujeta la estructura —
 * que ninguna pantalla vuelva a reconstruir la consulta a mano—. Esto mide el
 * otro lado: que el servidor devuelve el filtro en `filters` para que la
 * pantalla pueda conservarlo, y que los totales que van encima de la lista son
 * los de esas filas y no los de todas.
 */
function facturaVencida(Scenario $s, int $centavos, bool $vencida): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $centavos, $vencida): string {
        $id = (string) Str::uuid();

        DB::table('invoices')->insert([
            'id' => $id,
            'tenant_id' => $s->tenant->id,
            'carrier_id' => $s->assignedCarrier->id,
            'invoice_number' => 'INV-'.substr($id, 0, 6),
            'status' => $vencida ? 'overdue' : 'sent',
            'issue_date' => now()->subDays(60)->toDateString(),
            'due_date' => $vencida ? now()->subDays(10)->toDateString() : now()->addDays(20)->toDateString(),
            'subtotal_cents' => $centavos,
            'total_cents' => $centavos,
            'balance_cents' => $centavos,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    });
}

it('la tarjeta del panel lleva a una lista que sabe que está filtrada', function () {
    facturaVencida($this->scenario, 22500, vencida: true);
    facturaVencida($this->scenario, 157500, vencida: false);

    signIn($this->scenario, Role::Admin);

    // El destino es el que declara el panel, no uno inventado en la prueba.
    expect(Panel::DESTINOS['invoicesOverdue'])->toBe('/invoices?overdue=1');

    $this->get(Panel::DESTINOS['invoicesOverdue'])
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $props = $page->toArray()['props'];

            // El filtro VUELVE en `filters`. Sin eso la pantalla no puede
            // conservarlo al tocar un control, que es exactamente lo que
            // pasaba.
            expect($props['filters']['overdue'])->toBe('1');

            // Y los totales son los de ESTAS filas. «Pendiente de cobro» con la
            // suma de todas las facturas encima de una lista de siete es la
            // versión cara del problema: un recuento desconcierta, una suma se
            // apunta.
            expect($props['totals']['outstandingCents'])->toBe(22500);
        });
});

it('sin el filtro, los totales son los de todas', function () {
    facturaVencida($this->scenario, 22500, vencida: true);
    facturaVencida($this->scenario, 157500, vencida: false);

    signIn($this->scenario, Role::Admin);

    // La otra mitad: el filtro recorta de verdad, no es decoración.
    $this->get('/invoices')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.overdue', '')
            ->where('totals.outstandingCents', 180000));
});

it('el filtro sobrevive a la búsqueda', function () {
    $vencida = facturaVencida($this->scenario, 22500, vencida: true);
    facturaVencida($this->scenario, 157500, vencida: false);

    $numero = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn (): string => (string) DB::table('invoices')->where('id', $vencida)->value('invoice_number'),
    );

    signIn($this->scenario, Role::Admin);

    // Es lo que la pantalla manda ahora al teclear: los dos filtros juntos.
    $this->get('/invoices?overdue=1&search='.substr($numero, 4))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.overdue', '1')
            ->where('totals.outstandingCents', 22500)
            ->has('invoices.data', 1));
});

it('liquidaciones conserva la búsqueda al cambiar el estado', function () {
    signIn($this->scenario, Role::Admin);

    // El servidor sabe buscar por número y la pantalla no tiene caja: un
    // `?search=` que llegue de fuera tiene que seguir vivo al tocar el estado.
    $this->get('/settlements?search=LIQ-0001&status=draft')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.search', 'LIQ-0001')
            ->where('filters.status', 'draft'));
});

it('gastos devuelve el filtro de carga que llega por la dirección', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/expenses?load='.$this->scenario->load->id)
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.load', (string) $this->scenario->load->id));
});
