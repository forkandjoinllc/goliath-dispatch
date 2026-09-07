<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Que una parada se pueda quitar sin borrarla de verdad.
 *
 * ## Por qué hacía falta tocar el esquema
 *
 * `load_stops` tiene `deleted_at`, `deleted_by` y `deletion_reason`, `LoadStop`
 * usa `SoftDeletes`, y las trece lecturas del proyecto filtran
 * `whereNull('deleted_at')`. El borrado blando estaba diseñado por todas
 * partes. Y aun así `LoadController::syncStops()` hacía un DELETE crudo.
 *
 * No era pereza: era el único camino que dejaba el índice.
 *
 *     UNIQUE KEY `load_stops_load_sequence_uq` (`load_id`, `sequence`)
 *
 * Ese índice no mira `deleted_at`, así que una parada borrada en blando se
 * quedaba con su número de orden ocupado PARA SIEMPRE. Quita la parada 2 de una
 * carga y esa carga no vuelve a tener una parada 2 nunca. Con esa restricción
 * puesta, borrar de verdad era lo único que funcionaba — y por eso el arreglo
 * empieza aquí y no en el controlador.
 *
 * ## La forma es la que ya usa el esquema
 *
 * `carrier_contacts` resolvió el mismo problema con una columna generada que
 * vale NULL salvo en la fila viva, porque MySQL ignora los NULL en un índice
 * único. Aquí igual: `live_sequence` es el número de orden mientras la parada
 * está viva, y NULL en cuanto se borra. Las vivas siguen sin poder repetir
 * número; las borradas caben todas.
 *
 * La columna generada NO mira `load_id`, y eso importa: `load_id` es columna de
 * una clave ajena con ON DELETE CASCADE, y MySQL no admite las dos cosas a la
 * vez. Va en el índice, que es donde no estorba — misma nota que en
 * `carrier_contacts` y en la migración de requisitos.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('
            alter table load_stops
            add column `live_sequence` int
            generated always as (
                case when `deleted_at` is null then `sequence` end
            ) stored
        ');

        DB::statement('alter table load_stops drop index `load_stops_load_sequence_uq`');

        DB::statement('
            alter table load_stops
            add unique key `load_stops_live_sequence_uq` (`load_id`, `live_sequence`)
        ');
    }

    public function down(): void
    {
        DB::statement('alter table load_stops drop index `load_stops_live_sequence_uq`');
        DB::statement('alter table load_stops drop column `live_sequence`');

        // Se vuelve a poner el índice de antes. Ojo: si mientras tanto se
        // quitaron paradas en blando, esto puede fallar por duplicado — y es
        // correcto que falle en vez de borrar filas para poder revertir.
        DB::statement('
            alter table load_stops
            add unique key `load_stops_load_sequence_uq` (`load_id`, `sequence`)
        ');
    }
};
