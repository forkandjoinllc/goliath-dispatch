<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Finance\FeeBase;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * La medida: qué le pasa a una carga que ya existe cuando cambia el ajuste.
 *
 * Las dos bases solo se separan cuando hay gastos EXCLUIDOS —la comisionable es
 * el bruto menos lo que no es flete—, así que todas estas pruebas plantan un
 * gasto excluido. Sin él la base cambia de nombre y el dinero no se mueve, que
 * es exactamente la forma en que este defecto pasó desapercibido.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    $this->escenario = Scenario::create();
    $this->tenantId = (string) $this->escenario->tenant->id;
});

afterEach(function (): void {
    TenantPolicy::forget();
    app(TenantContext::class)->forget();
});

function gastoExcluido(string $tenantId, string $loadId, string $userId, int $centavos = 100000): void
{
    $categoria = (string) Str::uuid();

    DB::table('expense_categories')->insert([
        'id' => $categoria, 'tenant_id' => $tenantId, 'code' => 'permiso-'.substr($categoria, 0, 8),
        'label_en' => 'Permit', 'label_es' => 'Permiso', 'treatment' => 'excluded_from_commission',
        'is_system' => 0, 'requires_receipt' => 0, 'active' => 1, 'sort_order' => 1,
        'created_at' => now(), 'updated_at' => now(),
    ]);

    DB::table('expenses')->insert([
        'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'load_id' => $loadId,
        'category_id' => $categoria, 'treatment_snapshot' => 'excluded_from_commission',
        'requires_receipt_snapshot' => 0, 'amount_cents' => $centavos, 'description' => 'Permiso',
        'incurred_on' => now()->toDateString(), 'status' => 'approved',
        'submitted_by_user_id' => $userId, 'created_at' => now(), 'updated_at' => now(),
    ]);
}

/**
 * El alta de una carga. Deliberadamente propia y no la de LoadFormTest: una
 * función de otro fichero de pruebas solo existe cuando ese fichero se carga, y
 * apoyarse en ella hace que este pase o falle según con quién lo ejecuten.
 *
 * @return array<string, mixed>
 */
function altaDeCarga(Scenario $escenario, string $mercancia): array
{
    return [
        'customer_id' => $escenario->customer->id,
        'commodity' => $mercancia,
        'weight_pounds' => 68000,
        'customer_charge_cents' => 780000,
        'miles' => 390,
        'stops' => [
            ['stop_type' => 'pickup', 'facility_name' => 'Planta Odessa', 'city' => 'Odessa', 'state' => 'TX'],
            ['stop_type' => 'delivery', 'facility_name' => 'Obra Dallas', 'city' => 'Dallas', 'state' => 'TX'],
        ],
    ];
}

function cambiarBase(string $tenantId, string $base): void
{
    DB::table('tenant_settings')->where('tenant_id', $tenantId)->update(['dispatch_fee_base' => $base]);
    TenantPolicy::forget($tenantId);
}

/* ── Lo que ya existe ────────────────────────────────────────────────────── */

it('cambiar el ajuste no mueve el dinero de una carga que ya existe', function (): void {
    $carga = $this->escenario->load;

    gastoExcluido($this->tenantId, (string) $carga->id, (string) $this->escenario->user(Role::Admin)->id);

    signIn($this->escenario, Role::Admin);

    $cuentas = fn (): array => json_decode((string) json_encode(
        $this->get("/loads/{$carga->id}")->viewData('page')['props']['financials'] ?? []), true);

    $antes = $cuentas();

    // Esto es lo que medí antes de arreglarlo: la tarifa pasaba de 30000 a
    // 40000, lo del transportista de 370000 a 360000 y la comisión de 7500 a
    // 10000, sobre una carga acordada hacía semanas.
    cambiarBase($this->tenantId, 'carrier_gross_rate');

    expect($cuentas())->toBe($antes);
});

it('y la carga sigue diciendo con qué base se calcula', function (): void {
    $carga = $this->escenario->load;

    cambiarBase($this->tenantId, 'carrier_gross_rate');

    signIn($this->escenario, Role::Admin);

    $f = json_decode((string) json_encode(
        $this->get("/loads/{$carga->id}")->viewData('page')['props']['financials'] ?? []), true);

    expect($f['feeBase'] ?? null)->toBe((string) DB::table('loads')->where('id', $carga->id)->value('dispatch_fee_base'));
});

/* ── Lo que nace después ─────────────────────────────────────────────────── */

it('la carga nueva se sella con la base de su empresa, no con la de la columna', function (): void {
    // El sello tiene que salir de los ajustes de ESTA empresa. Si el camino de
    // alta se olvidara de ponerlo, la columna tiene valor por omisión y la
    // carga saldría con `commissionable_base` en silencio: esta prueba es la
    // que separa «se sella» de «coincide con el valor por omisión».
    cambiarBase($this->tenantId, 'carrier_gross_rate');

    signIn($this->escenario, Role::Admin);

    $this->post('/loads', altaDeCarga($this->escenario, 'Sellada con la nueva'))
        ->assertRedirect();

    expect(DB::table('loads')->where('commodity', 'Sellada con la nueva')->value('dispatch_fee_base'))
        ->toBe('carrier_gross_rate');
});

it('el ajuste sigue sirviendo para lo que dice: con qué empiezan las siguientes', function (): void {
    signIn($this->escenario, Role::Admin);

    $this->post('/loads', altaDeCarga($this->escenario, 'Antes del cambio'))->assertRedirect();

    cambiarBase($this->tenantId, 'carrier_gross_rate');

    $this->post('/loads', altaDeCarga($this->escenario, 'Después del cambio'))->assertRedirect();

    expect(DB::table('loads')->where('commodity', 'Antes del cambio')->value('dispatch_fee_base'))
        ->toBe('commissionable_base')
        ->and(DB::table('loads')->where('commodity', 'Después del cambio')->value('dispatch_fee_base'))
        ->toBe('carrier_gross_rate');
});

it('quien no ve el dinero también sella la base', function (): void {
    // El sello va FUERA del bloque de permiso de dinero. Dentro, una carga dada
    // de alta por quien no ve importes se quedaría con el valor por omisión de
    // la columna en vez de con el de su empresa, y nadie lo notaría hasta que
    // alguien rellenara el dinero semanas después.
    cambiarBase($this->tenantId, 'carrier_gross_rate');

    signIn($this->escenario, Role::Dispatcher);

    $this->post('/loads', altaDeCarga($this->escenario, 'Sin permiso de dinero'));

    $sellada = DB::table('loads')->where('commodity', 'Sin permiso de dinero')->value('dispatch_fee_base');

    expect($sellada)->toBe('carrier_gross_rate');
});

it('cada base cobra sobre lo que dice su nombre', function (): void {
    // Un sabotaje que cambiaba `FeeBase::CarrierGross => $carrierGrossRate` por
    // `=> $commissionableBase` salió VERDE: la prueba de fuente comprobaba que
    // el caso se MENCIONA, no que calcule lo que dice. Con las dos bases
    // dando la misma cifra, congelar la base no sirve de nada.
    //
    // Bruto $4.000, gasto excluido $1.000, tarifa 10 %:
    //   sobre la base comisionable ($3.000) -> $300
    //   sobre el bruto             ($4.000) -> $400
    $carga = $this->escenario->load;

    gastoExcluido($this->tenantId, (string) $carga->id, (string) $this->escenario->user(Role::Admin)->id);

    signIn($this->escenario, Role::Admin);

    $cuentas = fn (): array => json_decode((string) json_encode(
        $this->get("/loads/{$carga->id}")->viewData('page')['props']['financials'] ?? []), true);

    DB::table('loads')->where('id', $carga->id)->update(['dispatch_fee_base' => 'commissionable_base']);
    $comisionable = $cuentas();

    DB::table('loads')->where('id', $carga->id)->update(['dispatch_fee_base' => 'carrier_gross_rate']);
    $bruto = $cuentas();

    expect($comisionable['dispatchFee'])->toBe(30000)
        ->and($bruto['dispatchFee'])->toBe(40000);

    // Y la diferencia llega hasta el bolsillo del transportista.
    expect($comisionable['netCarrierSettlement'])->toBe(370000)
        ->and($bruto['netCarrierSettlement'])->toBe(360000);
});

/* ── La base de datos ────────────────────────────────────────────────────── */

it('la base de datos solo admite las bases que existen', function (): void {
    // El CHECK y la enumeración tienen que decir lo mismo. Si mañana se añade
    // una base al enum y no a la columna, las cargas nuevas de esa empresa
    // fallarían al insertarse; al revés, la columna admitiría un valor que
    // `FeeBase::from()` no sabe leer.
    foreach (['loads', 'financial_snapshots'] as $tabla) {
        $clausula = DB::selectOne(
            'select CHECK_CLAUSE as c from information_schema.CHECK_CONSTRAINTS where CONSTRAINT_NAME = ?',
            ["chk_{$tabla}_dispatch_fee_base"],
        );

        expect($clausula)->not->toBeNull("Falta el CHECK de dispatch_fee_base en {$tabla}.");

        foreach (FeeBase::cases() as $caso) {
            test()->assertStringContainsString($caso->value, (string) $clausula->c);
        }
    }
});
