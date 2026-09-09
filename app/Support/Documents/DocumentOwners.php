<?php

declare(strict_types=1);

namespace App\Support\Documents;

use Illuminate\Support\Facades\DB;

/**
 * De quién puede ser un documento, y cómo se llama ese dueño.
 *
 * ## El defecto
 *
 * `documents.owner_type` es un varchar SIN CHECK, y la aplicación escribía en
 * él nueve valores distintos. El diccionario tenía rótulo para cuatro
 * —transportista, conductor, camión, remolque— y `DocumentController::ownerNames()`
 * sabía resolver el nombre de esos mismos cuatro.
 *
 * El propio `Attachment::store()` lo dice en su firma desde el primer día:
 *
 *     ...string $ownerType   // 'load', 'expense', 'permit', 'escort'…
 *
 * Cuatro de los que enumera ahí no existían en ningún catálogo. En la lista de
 * documentos, un recibo de gasto salía así:
 *
 *     —
 *     documents.owners.expense
 *
 * Un guion donde va el nombre, porque `ownerNames()` no sabía buscarlo, y la
 * clave del diccionario en crudo debajo, porque `t()` devuelve la clave cuando
 * no la encuentra. Diez filas de la base de datos de demostración con `load` y
 * ocho con `expense`, comprobado en el navegador.
 *
 * ## Por qué una clase y no un CHECK en el esquema
 *
 * Un CHECK sería lo correcto y no cabe en este lote: es una migración sobre una
 * tabla viva, y la que va antes de esta ya le pide una a quien despliegue. Queda
 * escrito en `docs/document-names.md` como deuda con nombre. Lo que esta clase
 * sí da mientras tanto es lo que faltaba de verdad: que los nueve tengan nombre
 * y rótulo, y un guardián que impida el décimo sin ellos.
 */
final class DocumentOwners
{
    /** Una persona elige este dueño en un formulario de subida. */
    public const PERSONA = 'person';

    /** Lo pone la aplicación al colgar el papel donde corresponde. */
    public const SISTEMA = 'system';

    /**
     * dueño => [quién lo elige, tabla donde vive, cómo se llama la fila]
     *
     * La tercera posición es una LISTA de columnas que se unen con un espacio.
     * No es un `concat` en SQL porque hay que saber cuáles vinieron nulas: un
     * escolta sin nombre de proveedor tiene que caer a su tipo, no quedarse en
     * una cadena vacía que se lee igual que el guion de antes.
     *
     * @var array<string, array{0: string, 1: string, 2: list<string>}>
     */
    private const CATALOG = [
        // Los cuatro que el formulario genérico ofrece en un desplegable.
        'carrier' => [self::PERSONA, 'carriers', ['legal_name']],
        'driver' => [self::PERSONA, 'drivers', ['first_name', 'last_name']],
        'truck' => [self::PERSONA, 'trucks', ['unit_number']],
        'trailer' => [self::PERSONA, 'trailers', ['unit_number']],

        // La carga se admite al GUARDAR pero no sale en el desplegable: una
        // empresa tiene cuatro camiones y treinta mil cargas. Sus papeles se
        // cuelgan desde la carga, donde el dueño ya está decidido. Ver el
        // comentario de DocumentController::create.
        'load' => [self::SISTEMA, 'loads', ['load_number']],

        // Documents\ExpenseFile: el recibo de un gasto.
        'expense' => [self::SISTEMA, 'expenses', ['description']],

        // Oversize\Papers, las tres ranuras. El dueño es la FILA del permiso o
        // del escolta, no la carga: el papel se cuelga de ella y se sustituye
        // con ella.
        'permit' => [self::SISTEMA, 'permits', ['state_code', 'permit_number']],
        'route_survey' => [self::SISTEMA, 'permits', ['state_code', 'permit_number']],
        'escort' => [self::SISTEMA, 'escorts', ['provider_name', 'agency_name']],
    ];

    public static function isKnown(string $ownerType): bool
    {
        return isset(self::CATALOG[$ownerType]);
    }

    /**
     * Todos los dueños que existen.
     *
     * @return list<string>
     */
    public static function all(): array
    {
        return array_keys(self::CATALOG);
    }

    /**
     * Los que una persona puede elegir en el formulario genérico de subida.
     *
     * @return list<string>
     */
    public static function selectable(): array
    {
        return array_keys(array_filter(
            self::CATALOG,
            static fn (array $fila): bool => $fila[0] === self::PERSONA,
        ));
    }

    /**
     * El nombre de cada dueño de estas filas: «dueño:id» => nombre.
     *
     * Una consulta por TIPO, no una por fila: la lista pagina de treinta en
     * treinta y sin agrupar serían treinta consultas por pantalla.
     *
     * Devuelve solo lo que encuentra. Quien llama decide qué enseñar cuando
     * falta —hoy, el número corto del identificador— porque una fila borrada de
     * verdad puede dejar un documento huérfano y eso no es motivo para que la
     * pantalla se caiga.
     *
     * @param  array<int, array{0: string, 1: string}>  $pares  [dueño, id]
     * @return array<string, string>
     */
    public static function names(array $pares): array
    {
        $porTipo = [];

        foreach ($pares as [$tipo, $id]) {
            if (self::isKnown($tipo)) {
                $porTipo[$tipo][$id] = true;
            }
        }

        $nombres = [];

        foreach ($porTipo as $tipo => $ids) {
            [, $tabla, $columnas] = self::CATALOG[$tipo];

            $filas = DB::table($tabla)
                ->whereIn('id', array_keys($ids))
                ->get(array_merge(['id'], $columnas));

            foreach ($filas as $fila) {
                $trozos = array_filter(array_map(
                    static fn (string $c): string => trim((string) ($fila->{$c} ?? '')),
                    $columnas,
                ), static fn (string $v): bool => $v !== '');

                if ($trozos === []) {
                    continue;
                }

                // Al minuto de leerlo: la descripción de un gasto puede ser un
                // párrafo, y esto va en una celda de tabla que ya trunca. Se
                // recorta aquí para no mandar un texto largo por la red en cada
                // fila de cada página.
                $nombres["{$tipo}:{$fila->id}"] = mb_substr(implode(' ', $trozos), 0, 80);
            }
        }

        return $nombres;
    }
}
