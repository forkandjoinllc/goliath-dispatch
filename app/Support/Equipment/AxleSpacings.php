<?php

declare(strict_types=1);

namespace App\Support\Equipment;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Las distancias entre ejes de una unidad.
 *
 * ## Por qué esto no es «un número de ejes»
 *
 * Porque lo que decide cuánto peso admite legalmente un conjunto no es cuántos
 * ejes tiene, sino cómo están repartidos: dos ejes a 40 pulgadas y dos a 120
 * admiten pesos distintos. La fórmula federal del puente se calcula sobre esas
 * distancias, no sobre el recuento.
 *
 * ## Una fila por HUECO
 *
 * Con cinco ejes hay cuatro distancias. `position` es el hueco, de 1 en
 * adelante, contando de delante atrás. La invariante que lo sostiene todo:
 *
 *     distancias = ejes - 1
 *
 * Se guarda entera o no se guarda: un conjunto con tres huecos de cuatro
 * rellenos no sirve para calcular nada, y dejarlo a medias es peor que dejarlo
 * vacío porque parece un dato.
 */
final class AxleSpacings
{
    public const CAMION = 'truck';

    public const REMOLQUE = 'trailer';

    /**
     * Las distancias de una unidad, en orden.
     *
     * @return list<int>
     */
    public static function de(string $tipo, string $id): array
    {
        return DB::table('equipment_axle_spacings')
            ->where('owner_type', $tipo)
            ->where('owner_id', $id)
            ->orderBy('position')
            ->pluck('inches')
            ->map(static fn ($v): int => (int) $v)
            ->all();
    }

    /**
     * Las de varias unidades de una vez, para una lista.
     *
     * @param  list<string>  $ids
     * @return array<string, list<int>>
     */
    public static function deVarias(string $tipo, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $filas = DB::table('equipment_axle_spacings')
            ->where('owner_type', $tipo)
            ->whereIn('owner_id', $ids)
            ->orderBy('position')
            ->get(['owner_id', 'inches']);

        $salida = [];

        foreach ($filas as $fila) {
            $salida[(string) $fila->owner_id][] = (int) $fila->inches;
        }

        return $salida;
    }

    /**
     * Guarda las distancias de una unidad, reemplazando las que hubiera.
     *
     * Reemplazar y no ir mezclando: si alguien baja de cinco ejes a tres, las
     * distancias sobrantes tienen que desaparecer. Mezclar dejaría un hueco
     * número cuatro de una unidad que ya no lo tiene.
     *
     * @param  list<int>  $pulgadas
     */
    public static function guardar(string $tenantId, string $tipo, string $id, array $pulgadas): void
    {
        DB::table('equipment_axle_spacings')
            ->where('owner_type', $tipo)
            ->where('owner_id', $id)
            ->delete();

        if ($pulgadas === []) {
            return;
        }

        $ahora = now();

        DB::table('equipment_axle_spacings')->insert(
            collect($pulgadas)
                ->values()
                ->map(static fn (int $valor, int $i): array => [
                    'id' => (string) Str::uuid(),
                    'tenant_id' => $tenantId,
                    'owner_type' => $tipo,
                    'owner_id' => $id,
                    'position' => $i + 1,
                    'inches' => $valor,
                    'created_at' => $ahora,
                    'updated_at' => $ahora,
                ])
                ->all(),
        );
    }

    /**
     * ¿Cuadran las distancias con el número de ejes?
     *
     * Tres respuestas y no dos:
     *
     *  - **Ninguna distancia** siempre cuadra. Las fichas que ya existen
     *    tienen número de ejes y no tienen distancias —la tabla acaba de
     *    nacer—, y una ficha vieja tiene que poder guardarse sin que se le
     *    exija un dato que nadie ha tomado todavía.
     *  - **Todas** cuadran si son n-1 para n ejes.
     *  - **Algunas** no cuadran nunca. Tres huecos de cuatro no sirven para
     *    calcular nada y parecen un dato.
     *
     * Los nulos son huecos en blanco de la pantalla, no ceros.
     *
     * @param  array<int, int|null>  $pulgadas
     */
    public static function cuadran(?int $ejes, array $pulgadas): bool
    {
        $dadas = count(array_filter($pulgadas, static fn ($v): bool => $v !== null));

        if ($dadas === 0) {
            return true;
        }

        $esperadas = $ejes === null || $ejes < 2 ? 0 : $ejes - 1;

        return $dadas === $esperadas;
    }

    /**
     * La distancia total entre el primer eje y el último.
     *
     * Es la que pide la fórmula del puente, y sumarla aquí evita que cada
     * pantalla la sume a su manera.
     *
     * @param  list<int>  $pulgadas
     */
    public static function total(array $pulgadas): ?int
    {
        return $pulgadas === [] ? null : array_sum($pulgadas);
    }
}
