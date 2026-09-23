<?php

declare(strict_types=1);

namespace App\Support\Equipment;

/**
 * Pies y pulgadas por fuera, pulgadas por dentro.
 *
 * La pantalla pide las medidas como se leen de una cinta y como vienen en un
 * permiso —13 pies 6 pulgadas—, y la base guarda UNA cifra en pulgadas.
 *
 * ## Por qué no dos columnas
 *
 * Porque dos columnas admiten el estado imposible: 13 pies y 14 pulgadas. Y
 * porque todo lo que ya compara medidas —`Oversize\Evaluator` contra
 * `oversize_rules`— trabaja en pulgadas desde el primer día: una segunda unidad
 * en la base obligaría a convertir en cada comparación, y el día que alguien
 * olvide una conversión el resultado no es un error, es un permiso mal
 * evaluado.
 *
 * La conversión vive aquí y en un solo sitio para que no haya dos respuestas a
 * «¿cuántas pulgadas son trece pies?». El camino de vuelta —partir una cifra en
 * pies y pulgadas para enseñarla y para rellenar el formulario— lo hace la
 * pantalla, en `resources/js/lib/measure.ts`, con esta misma constante. El
 * guardián `MeasureUnitsTest` comprueba que las dos digan doce.
 */
final class Measure
{
    public const PULGADAS_POR_PIE = 12;

    /** De pies y pulgadas a pulgadas. Nulo si no se dio ninguna de las dos. */
    public static function aPulgadas(?int $pies, ?int $pulgadas): ?int
    {
        if ($pies === null && $pulgadas === null) {
            return null;
        }

        return ($pies ?? 0) * self::PULGADAS_POR_PIE + ($pulgadas ?? 0);
    }
}
