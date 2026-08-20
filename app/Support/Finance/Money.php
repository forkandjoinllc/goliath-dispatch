<?php

declare(strict_types=1);

namespace App\Support\Finance;

/**
 * Aritmética de dinero en centavos enteros.
 *
 * No hay ni un `float` en todo el cálculo financiero, y esa es la única regla
 * que no admite excepción. `0.1 + 0.2` no es `0.3` en coma flotante, y un
 * sistema que reparte el dinero de un transportista no puede permitirse que la
 * suma dependa del orden en que se hicieron las cosas.
 */
final class Money
{
    /**
     * Un porcentaje en puntos básicos, aplicado a un importe en centavos.
     *
     * 10.000 pb = 100 %. Se guarda en puntos básicos y no en decimales para que
     * «10,25 %» sea el entero 1025 y no un número con coma que hay que redondear
     * antes de poder usarlo.
     *
     * El redondeo es MEDIO HACIA ARRIBA sobre el valor absoluto: 225,005 →
     * 225,01. Es lo que hace cualquiera que rehaga la cuenta con una
     * calculadora, y que el resultado coincida con lo que sale a mano importa
     * más de lo que parece — la alternativa es una llamada de teléfono por cada
     * céntimo de diferencia.
     *
     * Sobre el valor absoluto y no sobre el número con signo: así −225,005 da
     * −225,01 y no −225,00. Un importe negativo aparece en un abono, y el abono
     * de una cantidad tiene que ser exactamente esa cantidad con el signo
     * cambiado. Si el redondeo se hiciera «hacia arriba» sin más, cobrar 225,01
     * y abonar 225,00 dejaría un céntimo colgando en cada abono.
     */
    public static function applyBps(int $amountCents, int $bps): int
    {
        $product = $amountCents * $bps;
        $sign = $product < 0 ? -1 : 1;
        $magnitude = abs($product);

        // intdiv sobre enteros: nada de dividir entre 10000.0 y redondear
        // después, que es donde entraría la coma flotante por la puerta de atrás.
        return $sign * intdiv($magnitude + 5000, 10000);
    }

    /** Puntos básicos a texto legible: 1025 → «10,25 %». */
    public static function bpsToPercent(int $bps): string
    {
        return rtrim(rtrim(number_format($bps / 100, 2, '.', ''), '0'), '.').'%';
    }
}
