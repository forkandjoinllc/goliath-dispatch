<?php

declare(strict_types=1);

namespace App\Support\Equipment;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Lo que mide una PAREJA de camión y remolque, y no cada uno por su lado.
 *
 * ## El hueco que no cabía en ninguna ficha
 *
 * `AxleSpacings` guarda los huecos de una unidad. En una combinación de cinco
 * ejes hay cuatro huecos y solo tres son de alguna unidad: dos del tractor y
 * uno del remolque. El cuarto —de la última tracción al primer eje del
 * remolque— es de la pareja, y es el que decide la fórmula del puente.
 *
 * ## Entera o nada, otra vez
 *
 * `AxleSpacings::cuadran()` ya decide que unas distancias a medias no sirven
 * para calcular nada. Aquí vale lo mismo un nivel más arriba: la cadena de la
 * combinación existe cuando existen las tres piezas —los huecos del tractor
 * completos, el enganche, y los del remolque completos— y no existe en cuanto
 * falta una. Devolver una suma a la que le falta un tramo sería dar un número
 * que se parece a la distancia de un permiso sin serlo, y ese número acabaría
 * copiado en un papel.
 *
 * Por eso `cadena()` necesita saber cuántos ejes tiene cada unidad y no le
 * basta con contar lo que hay guardado: un remolque de un solo eje tiene CERO
 * huecos legítimamente, y una lista vacía sin el recuento al lado no distingue
 * «no tiene» de «nadie lo ha medido».
 */
final class ComboSpacing
{
    /**
     * Las medidas de una pareja, o nada si no se han tomado.
     *
     * @return array{id: string, driveToTrailerInches: int, bumperToBumperInches: int|null, kingpinToRearInches: int|null, kingpinToTrailerAxlesInches: int|null, measuredOn: string|null, notes: string|null}|null
     */
    public static function de(string $tenantId, string $truckId, string $trailerId): ?array
    {
        $todas = self::deParejas($tenantId, [[$truckId, $trailerId]]);

        return $todas[self::clave($truckId, $trailerId)] ?? null;
    }

    /**
     * Las de varias parejas de una vez, para una lista.
     *
     * @param  list<array{0: string, 1: string}>  $parejas
     * @return array<string, array{id: string, driveToTrailerInches: int, bumperToBumperInches: int|null, kingpinToRearInches: int|null, kingpinToTrailerAxlesInches: int|null, measuredOn: string|null, notes: string|null}>
     */
    public static function deParejas(string $tenantId, array $parejas): array
    {
        if ($parejas === []) {
            return [];
        }

        $consulta = DB::table('equipment_combo_spacings')
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at');

        // Un `or` por pareja y no dos `whereIn` sueltos: con los camiones por
        // un lado y los remolques por otro saldrían también las parejas que
        // nadie ha formado —el camión de una con el remolque de otra— y la
        // pantalla enseñaría medidas de un conjunto que no existe.
        $consulta->where(function ($q) use ($parejas): void {
            foreach ($parejas as [$camion, $remolque]) {
                $q->orWhere(function ($q) use ($camion, $remolque): void {
                    $q->where('truck_id', $camion)->where('trailer_id', $remolque);
                });
            }
        });

        $salida = [];

        foreach ($consulta->get() as $fila) {
            $salida[self::clave((string) $fila->truck_id, (string) $fila->trailer_id)] = [
                'id' => (string) $fila->id,
                'driveToTrailerInches' => (int) $fila->drive_to_trailer_inches,
                'bumperToBumperInches' => $fila->bumper_to_bumper_inches === null ? null : (int) $fila->bumper_to_bumper_inches,
                'kingpinToRearInches' => $fila->kingpin_to_rear_inches === null ? null : (int) $fila->kingpin_to_rear_inches,
                'kingpinToTrailerAxlesInches' => $fila->kingpin_to_trailer_axles_inches === null ? null : (int) $fila->kingpin_to_trailer_axles_inches,
                'measuredOn' => $fila->measured_on === null ? null : substr((string) $fila->measured_on, 0, 10),
                'notes' => $fila->notes === null ? null : (string) $fila->notes,
            ];
        }

        return $salida;
    }

    /** La clave con la que se leen las de una lista. */
    public static function clave(string $truckId, string $trailerId): string
    {
        return $truckId.':'.$trailerId;
    }

    /**
     * Guarda las medidas de una pareja, reemplazando las que hubiera.
     *
     * **El único sitio que escribe en la tabla**, igual que `AxleSpacings`, y
     * por la misma razón: la unicidad de la pareja vive en una columna
     * generada que solo cuenta las filas vivas, y un `insert` suelto en otro
     * controlador la duplicaría en cuanto alguien retirara una medida y la
     * volviera a tomar.
     */
    public static function guardar(
        string $tenantId,
        string $truckId,
        string $trailerId,
        int $engancheEnPulgadas,
        ?int $parachoques = null,
        ?int $kingpinAlFinal = null,
        ?int $kingpinAEjes = null,
        ?string $medidoEl = null,
        ?string $porUsuario = null,
        ?string $nota = null,
    ): void {
        $columnas = [
            'drive_to_trailer_inches' => $engancheEnPulgadas,
            'bumper_to_bumper_inches' => $parachoques,
            'kingpin_to_rear_inches' => $kingpinAlFinal,
            'kingpin_to_trailer_axles_inches' => $kingpinAEjes,
            'measured_on' => $medidoEl,
            'measured_by_user_id' => $porUsuario,
            'notes' => $nota,
            'updated_at' => now(),
        ];

        $existente = DB::table('equipment_combo_spacings')
            ->where('tenant_id', $tenantId)
            ->where('truck_id', $truckId)
            ->where('trailer_id', $trailerId)
            ->whereNull('deleted_at')
            ->value('id');

        if ($existente !== null) {
            DB::table('equipment_combo_spacings')->where('id', $existente)->update($columnas);

            return;
        }

        DB::table('equipment_combo_spacings')->insert([
            ...$columnas,
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'truck_id' => $truckId,
            'trailer_id' => $trailerId,
            'created_at' => now(),
        ]);
    }

    /**
     * Retira la medida de una pareja.
     *
     * En blando: quién midió qué y cuándo es parte de por qué un permiso se
     * pidió con una cifra y no con otra.
     */
    public static function olvidar(string $tenantId, string $truckId, string $trailerId): bool
    {
        return DB::table('equipment_combo_spacings')
            ->where('tenant_id', $tenantId)
            ->where('truck_id', $truckId)
            ->where('trailer_id', $trailerId)
            ->whereNull('deleted_at')
            ->update(['deleted_at' => now(), 'updated_at' => now()]) > 0;
    }

    /**
     * La cadena entera de la combinación, de delante atrás, o nada.
     *
     * Nada en cuanto falta una pieza. Ver la cabecera de la clase: media
     * cadena no es media respuesta, es un número equivocado con pinta de dato.
     *
     * @param  list<int>  $camion
     * @param  list<int>  $remolque
     * @return list<int>|null
     */
    public static function cadena(
        ?int $ejesCamion,
        array $camion,
        ?int $enganche,
        ?int $ejesRemolque,
        array $remolque,
    ): ?array {
        if ($enganche === null || ! self::completas($ejesCamion, $camion) || ! self::completas($ejesRemolque, $remolque)) {
            return null;
        }

        return [...$camion, $enganche, ...$remolque];
    }

    /**
     * La distancia del primer eje al último de la combinación.
     *
     * La que pide la fórmula federal del puente y la que pregunta la oficina
     * de permisos. `AxleSpacings::total()` da la de UNA unidad, que para un
     * tractor es del eje de dirección a la última tracción: cierta, y no es
     * esta.
     *
     * @param  list<int>|null  $cadena
     */
    public static function total(?array $cadena): ?int
    {
        return $cadena === null || $cadena === [] ? null : array_sum($cadena);
    }

    /** Cuántos ejes tiene la combinación, o nada si falta el recuento de alguna. */
    public static function ejes(?int $ejesCamion, ?int $ejesRemolque): ?int
    {
        return $ejesCamion === null || $ejesRemolque === null ? null : $ejesCamion + $ejesRemolque;
    }

    /**
     * ¿Están tomadas TODAS las distancias de una unidad de tantos ejes?
     *
     * Sin el recuento no se puede decir: cero huecos guardados es lo correcto
     * para un remolque de un eje y es «sin medir» para uno de tres.
     *
     * @param  list<int>  $huecos
     */
    private static function completas(?int $ejes, array $huecos): bool
    {
        return $ejes !== null && $ejes >= 1 && count($huecos) === $ejes - 1;
    }
}
