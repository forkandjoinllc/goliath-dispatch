<?php

declare(strict_types=1);

use App\Enums\CommissionBasis;
use App\Support\Finance\Calculator;
use App\Support\Finance\FeeBase;
use App\Support\Finance\Money;

/*
| Sin base de datos y sin aplicación: Calculator es aritmética pura. Que se
| pueda probar así es la prueba de que está en el sitio correcto — comprobar que
| un 10 % de $2.250 son $225 no debería exigir montar una empresa entera.
|
| ADVERTENCIA: no se han ejecutado con Pest (ver docs/testing.md). Pero TODOS los
| valores esperados de este fichero se comprobaron llamando a Calculator y Money
| a mano, uno por uno, y varios se cotejaron además contra la pantalla.
*/

/* ── El redondeo ────────────────────────────────────────────────────────── */

it('redondea medio hacia arriba', function (int $cents, int $bps, int $expected) {
    expect(Money::applyBps($cents, $bps))->toBe($expected);
})->with([
    '10% de 2.250,05 sube' => [225005, 1000, 22501],
    '10% exacto no mueve' => [225000, 1000, 22500],
    '10% de 2.400 exacto' => [240000, 1000, 24000],
    'mitad de un céntimo sube' => [1, 5000, 1],
    'uno y medio sube a dos' => [3, 5000, 2],
    'cero por ciento es cero' => [999999, 0, 0],
    'cien por cien es todo' => [123456, 10000, 123456],
]);

it('el abono de una cantidad es esa cantidad con el signo cambiado', function () {
    // Redondeando «hacia arriba» sin más, cobrar 225,01 y abonar 225,00 dejaría
    // un céntimo colgando en cada abono. Por eso se redondea sobre el valor
    // absoluto y luego se aplica el signo.
    expect(Money::applyBps(-225005, 1000))->toBe(-Money::applyBps(225005, 1000));
});

it('nunca usa coma flotante', function () {
    // Un porcentaje de un importe grande. Con floats, 0.1 * 79999999 no da un
    // entero exacto y el resultado dependería del redondeo del procesador.
    expect(Money::applyBps(7999999999, 1000))->toBeInt()->toBe(800000000);
});

/* ── La cuenta completa ─────────────────────────────────────────────────── */

function compute(array $overrides = []): App\Support\Finance\LoadFinancials
{
    return Calculator::compute(...[
        'customerCharge' => 500000,
        'carrierGrossRate' => 240000,
        'dispatchFeeBps' => 1000,
        'commissionBps' => 2500,
        'commissionBasis' => CommissionBasis::DispatchFeeAmount,
        'feeBase' => FeeBase::Commissionable,
        'excludedExpenses' => 0,
        'reimbursableExpenses' => 0,
        'tenantAbsorbedExpenses' => 0,
        'carrierDeductions' => 0,
        ...$overrides,
    ]);
}

it('sin gastos, la base es el bruto entero', function () {
    $f = compute();

    expect($f->commissionableBase)->toBe(240000)
        ->and($f->dispatchFee)->toBe(24000)
        ->and($f->netCarrierSettlement)->toBe(216000)
        ->and($f->grossMargin)->toBe(24000)
        ->and($f->dispatcherCommission)->toBe(6000);
});

it('el ejemplo completo con los cuatro tratamientos', function () {
    // Es el caso con el que se tomó la decisión de la base de la tarifa, con las
    // dos tablas delante. Ver docs/finanzas.md.
    $f = compute([
        'excludedExpenses' => 15000,
        'reimbursableExpenses' => 7500,
        'tenantAbsorbedExpenses' => 4000,
        'carrierDeductions' => 20000,
    ]);

    expect($f->commissionableBase)->toBe(225000)   // 2400 − 150
        ->and($f->dispatchFee)->toBe(22500)         // 10 % de 2250
        ->and($f->netCarrierSettlement)->toBe(205000) // 2400 − 225 + 75 − 200
        ->and($f->grossMargin)->toBe(18500)         // 225 − 40
        ->and($f->dispatcherCommission)->toBe(5625) // 25 % de 225
        ->and($f->netMargin())->toBe(12875);        // 185 − 56,25
});

it('la otra lectura de la base da otro número, y por eso hubo que elegir', function () {
    $args = [
        'excludedExpenses' => 15000,
        'reimbursableExpenses' => 7500,
        'tenantAbsorbedExpenses' => 4000,
        'carrierDeductions' => 20000,
    ];

    $a = compute([...$args, 'feeBase' => FeeBase::Commissionable]);
    $b = compute([...$args, 'feeBase' => FeeBase::CarrierGross]);

    // $15 de diferencia en una sola carga con $150 de gastos excluidos. Sobre
    // una carga pesada con $5.250 de permisos, la diferencia fue de $525.
    expect($b->dispatchFee - $a->dispatchFee)->toBe(1500)
        ->and($a->netCarrierSettlement - $b->netCarrierSettlement)->toBe(1500);
});

/* ── Lo que NO debe hacer ───────────────────────────────────────────────── */

it('no resta los gastos excluidos dos veces', function () {
    // Se quitan SOLO para calcular el porcentaje. No son dinero que el
    // transportista deje de recibir; restarlos también de la liquidación sería
    // cobrárselos otra vez.
    $f = compute(['excludedExpenses' => 100000]);

    expect($f->commissionableBase)->toBe(140000)
        ->and($f->dispatchFee)->toBe(14000)
        // 2400 − 140, y NO 2400 − 1000 − 140.
        ->and($f->netCarrierSettlement)->toBe(226000);
});

it('la base no baja de cero aunque el permiso cueste más que el flete', function () {
    // Sin suelo, la tarifa saldría negativa: la empresa PAGANDO al transportista
    // por despacharle una carga. Eso no es un caso de negocio, es un error de
    // captura, y el cero lo deja a la vista en vez de repartirlo por la cuenta.
    $f = compute(['carrierGrossRate' => 100000, 'excludedExpenses' => 340000]);

    expect($f->commissionableBase)->toBe(0)
        ->and($f->dispatchFee)->toBe(0)
        ->and($f->netCarrierSettlement)->toBe(100000);
});

it('el margen SÍ puede ser negativo', function () {
    // Una carga vendida por debajo de coste es un hecho de negocio legítimo, no
    // un fallo de integridad. El esquema lo permite a propósito y no lleva CHECK.
    $f = compute(['tenantAbsorbedExpenses' => 90000]);

    expect($f->grossMargin)->toBe(24000 - 90000)->toBeLessThan(0);
});

it('la liquidación puede ser negativa si las retenciones superan la tarifa', function () {
    $f = compute(['carrierDeductions' => 300000]);

    expect($f->netCarrierSettlement)->toBeLessThan(0);
});

/* ── Las tres bases de la comisión ──────────────────────────────────────── */

it('la comisión se calcula sobre la base que diga la carga', function (
    CommissionBasis $basis,
    int $expectedBasisAmount,
    int $expectedCommission,
) {
    $f = compute(['excludedExpenses' => 15000, 'commissionBasis' => $basis]);

    expect($f->commissionBasisAmount)->toBe($expectedBasisAmount)
        ->and($f->dispatcherCommission)->toBe($expectedCommission);
})->with([
    'sobre la tarifa de despacho' => [CommissionBasis::DispatchFeeAmount, 22500, 5625],
    'sobre el bruto del transportista' => [CommissionBasis::CarrierGrossRate, 240000, 60000],
    'sobre la base comisionable' => [CommissionBasis::CommissionableBase, 225000, 56250],
]);

/* ── El puente al esquema ───────────────────────────────────────────────── */

it('produce exactamente las columnas de financial_snapshots', function () {
    $columns = compute()->toSnapshotColumns();

    // Si el esquema gana una columna y esta lista no, la instantánea se
    // insertaría incompleta y el fallo aparecería meses después, al reabrir una
    // liquidación.
    expect(array_keys($columns))->toBe([
        'customer_charge_cents',
        'carrier_gross_rate_cents',
        'carrier_dispatch_fee_bps',
        'dispatcher_commission_bps',
        'dispatcher_commission_basis',
        'approved_excluded_expenses_cents',
        'approved_reimbursable_expenses_cents',
        'tenant_absorbed_expenses_cents',
        'carrier_deductions_cents',
        'commissionable_base_cents',
        'dispatch_fee_amount_cents',
        'net_carrier_settlement_cents',
        'gross_margin_cents',
        'dispatcher_commission_amount_cents',
    ]);
});
