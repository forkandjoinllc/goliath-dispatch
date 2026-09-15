<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Finance\DefaultExpenseCategories;
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
 * El margen de la casa no sale de la casa.
 *
 * El guardián de `tests/Unit/Suite/MoneyAudienceTest.php` sujeta la estructura
 * —que ninguna cifra se cuele sin clasificar—. Esto pide las pantallas con la
 * sesión del transportista abierta y mira lo que llega en la respuesta, que es
 * donde estaba el defecto: no en lo que React pinta, sino en lo que viaja.
 *
 * Un transportista tiene `load:financials:read`. Se lo dio quien quería que
 * viera su liquidación, y con ella se llevaba el otro lado de la mesa.
 */
function cargaConDinero(Scenario $s): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s): string {
        DB::table('loads')->where('id', $s->load->id)->update([
            'carrier_id' => $s->assignedCarrier->id,
            'dispatcher_user_id' => $s->user(Role::Dispatcher)->id,
            'status' => 'delivered',
            'actual_delivery_at' => now()->subDay(),
            'customer_charge_cents' => 300000,
            'carrier_gross_rate_cents' => 250000,
            'carrier_dispatch_fee_bps' => 1000,
            'dispatcher_commission_bps' => 2500,
            'dispatcher_commission_basis' => 'dispatch_fee_amount',
            'updated_at' => now(),
        ]);

        return (string) $s->load->id;
    });
}

/**
 * Un conductor ATADO al usuario conductor, y montado en la carga.
 *
 * `Scenario::crew()` crea un conductor suyo, sin relación con el usuario que
 * inicia sesión: con él, el alcance PROPIO no encuentra la carga y la petición
 * sale 403 antes de llegar al dinero. Es el mismo montaje que usa
 * `ConsentTest`.
 */
function conductorDeLaCarga(Scenario $s): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s): string {
        $driverId = (string) Str::uuid();

        DB::table('drivers')->insert([
            'id' => $driverId,
            'tenant_id' => $s->tenant->id,
            'first_name' => 'Propio',
            'last_name' => 'Conductor',
            'license_state' => 'TX',
            'license_number_hash' => hash('sha256', Str::random(16)),
            'license_number_last4' => '0007',
            'cdl_class' => 'A',
            'license_expires_at' => now()->addYear(),
            'medical_card_expires_at' => now()->addYear(),
            'status' => 'available',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_tenant_memberships')
            ->where('tenant_id', $s->tenant->id)
            ->where('user_id', $s->user(Role::Driver)->id)
            ->update(['driver_id' => $driverId]);

        $s->crew($s->load);

        DB::table('load_assignments')
            ->where('load_id', $s->load->id)
            ->whereNotNull('driver_id')
            ->update(['driver_id' => $driverId]);

        return $driverId;
    });
}

/* ── La ficha de la carga ──────────────────────────────────────────────── */

it('el transportista ve su liquidación entera', function () {
    $carga = cargaConDinero($this->scenario);
    signIn($this->scenario, Role::Carrier);

    // Lo que NO se puede hacer es esconderle su cuenta: si no ve de dónde sale
    // su liquidación, la discute por teléfono. Estas cifras tienen que seguir
    // llegando todas.
    $this->get("/loads/{$carga}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('financials.carrierGrossRate')
            ->has('financials.dispatchFeeBps')
            ->has('financials.dispatchFee')
            ->has('financials.commissionableBase')
            ->has('financials.excludedExpenses')
            ->has('financials.reimbursableExpenses')
            ->has('financials.carrierDeductions')
            ->has('financials.feeBase')
            ->where('financials.carrierGrossRate', 250000)
            // 10 % de 250.000. Es la factura que se le emite a él.
            ->where('financials.dispatchFee', 25000)
            ->where('financials.netCarrierSettlement', 225000));
});

it('el transportista NO recibe el margen de la casa', function () {
    $carga = cargaConDinero($this->scenario);
    signIn($this->scenario, Role::Carrier);

    // Ausentes, no en cero ni en null: una clave con null todavía dice que el
    // dato existe y que alguien decidió no dártelo.
    $this->get("/loads/{$carga}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->missing('financials.customerCharge')
            ->missing('financials.grossMargin')
            ->missing('financials.netMargin')
            ->missing('financials.dispatcherCommission')
            ->missing('financials.commissionBps')
            ->missing('financials.commissionBasis')
            ->missing('financials.tenantAbsorbedExpenses')
            ->missing('financials.commissionOwner')
            ->missing('financials.commissionOrphaned'));
});

it('el despachador sí ve el margen: es de la casa', function () {
    $carga = cargaConDinero($this->scenario);
    signIn($this->scenario, Role::Dispatcher);

    // La frontera no es «menos permisos»: es de qué lado de la mesa. El
    // despachador mira con alcance ASIGNADO —ve menos cargas— y de las que ve,
    // las ve enteras.
    $this->get("/loads/{$carga}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('financials.customerCharge', 300000)
            ->where('financials.grossMargin', 25000)
            // 25 % de la tarifa de despacho.
            ->where('financials.dispatcherCommission', 6250)
            ->where('financials.netMargin', 18750));
});

it('el conductor no recibe dinero en absoluto', function () {
    $carga = cargaConDinero($this->scenario);
    conductorDeLaCarga($this->scenario);
    signIn($this->scenario, Role::Driver);

    // Esto ya era así antes de este lote y tiene que seguir siéndolo: el bloque
    // entero no se calcula cuando falta `load:financials:read`.
    $this->get("/loads/{$carga}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('financials', null));
});

/* ── El listado ────────────────────────────────────────────────────────── */

it('la columna del cobro al cliente llega vacía al transportista', function () {
    cargaConDinero($this->scenario);
    signIn($this->scenario, Role::Carrier);

    $this->get('/loads')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            // Tiene el permiso del dinero, así que la tabla enseña su columna
            // de tarifa...
            $page->where('showMoney', true);

            $filas = $page->toArray()['props']['loads']['data'];

            expect($filas)->not->toBeEmpty();

            foreach ($filas as $fila) {
                // ...y la del cobro al cliente viaja vacía. En este listado
                // `null` ya significa «no te toca», y lo que no puede pasar es
                // que el número vaya dentro.
                expect($fila['customerChargeCents'])->toBeNull();
                expect($fila['carrierGrossRateCents'])->not->toBeNull();
            }
        });
});

/**
 * Un gasto APROBADO de esta carga, con el tratamiento que se le diga.
 *
 * Hace falta para el informe: sin una fila `tenant_absorbed` aprobada, la clave
 * no aparece en el desglose de ninguna manera y la comprobación pasaría igual
 * con el filtro puesto y sin él. Un sabotaje me lo enseñó: quité el filtro y la
 * prueba siguió verde.
 */
function gastoAprobado(Scenario $s, string $tratamiento, int $centavos): void
{
    app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $tratamiento, $centavos): void {
        DefaultExpenseCategories::ensureFor((string) $s->tenant->id);

        DB::table('expenses')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $s->tenant->id,
            'load_id' => $s->load->id,
            'carrier_id' => $s->assignedCarrier->id,
            'category_id' => (string) DB::table('expense_categories')
                ->where('tenant_id', $s->tenant->id)->value('id'),
            'treatment_snapshot' => $tratamiento,
            'requires_receipt_snapshot' => false,
            'amount_cents' => $centavos,
            'description' => 'Reimpresión de documentación',
            'status' => 'approved',
            'submitted_by_user_id' => $s->user(Role::Admin)->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });
}

/* ── El informe del periodo ────────────────────────────────────────────── */

it('el informe del transportista no lleva el margen ni el cobro al cliente', function () {
    cargaConDinero($this->scenario);

    // Los dos: uno que es suyo y tiene que seguir saliendo, y uno que es de la
    // casa y no. Sin el primero, la comprobación del segundo no distingue
    // «filtrado» de «no había».
    gastoAprobado($this->scenario, 'carrier_deduction', 4000);
    gastoAprobado($this->scenario, 'tenant_absorbed', 7500);

    signIn($this->scenario, Role::Carrier);

    $this->get('/reports')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $props = $page->toArray()['props'];

            // El total de arriba: sin él la pantalla sumaría cero y un cero se
            // lee como un dato.
            expect($props['summary'])->not->toHaveKey('marginCents');
            expect($props['summary'])->toHaveKey('feeCents');

            foreach ($props['byCarrier'] as $fila) {
                expect($fila)->not->toHaveKey('marginCents');
                expect($fila)->toHaveKey('netCents');
            }

            foreach ($props['byCustomer'] as $fila) {
                expect($fila)->not->toHaveKey('marginCents');
                expect($fila)->not->toHaveKey('chargeCents');
            }

            // Y lo que la casa se come tampoco: el margen bruto es la tarifa
            // MENOS esto, así que su total es el margen por la puerta de atrás.
            expect($props['expensesByTreatment'])->not->toHaveKey('tenant_absorbed');

            // Lo suyo sigue estando. Un filtro que se lleve por delante los
            // tres tratamientos que SÍ mueven su liquidación le esconde su
            // propia cuenta, que es el defecto contrario.
            expect($props['expensesByTreatment'])->toHaveKey('carrier_deduction');
            expect($props['expensesByTreatment']['carrier_deduction'])->toBe(4000);

            // Esta ya estaba bien antes del lote, en el mismo fichero. Es la
            // que demuestra que la regla estaba escrita y aplicada a una sola
            // consulta.
            expect($props['commissionsByDispatcher'])->toBe([]);
        });
});

it('contabilidad sigue viendo el informe entero', function () {
    cargaConDinero($this->scenario);
    gastoAprobado($this->scenario, 'tenant_absorbed', 7500);
    signIn($this->scenario, Role::Accounting);

    $this->get('/reports')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $props = $page->toArray()['props'];

            // La otra mitad de la comprobación. Un filtro que se pasa de listo
            // y esconde el margen a quien lleva las cuentas rompe la pantalla
            // para la que se escribió.
            expect($props['summary'])->toHaveKey('marginCents');
            expect($props['expensesByTreatment'])->toHaveKey('tenant_absorbed');
        });
});
