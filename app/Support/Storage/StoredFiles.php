<?php

declare(strict_types=1);

namespace App\Support\Storage;

use Illuminate\Support\Facades\DB;

/**
 * Quién guarda ficheros, y en qué columna.
 *
 * Siete tablas del esquema tienen una columna que apunta al almacén, repartidas
 * por cinco ficheros de DDL distintos, y hasta este lote **nadie tenía la lista
 * entera**. El efecto no era teórico: la purga de retención del lote 52 borraba
 * filas de `document_versions` y `message_attachments` sin tocar sus ficheros,
 * porque quien la escribió —yo— no tenía delante qué columnas apuntaban dónde.
 *
 * Con la lista en un sitio se puede contestar las dos preguntas que importan:
 *
 *  - «Voy a borrar estas filas, ¿qué ficheros se llevan?»
 *  - «¿Qué ficheros hay en el almacén que ninguna fila nombre?»
 *
 * La lista se comprueba contra el esquema en
 * `tests/Unit/Suite/StoredFilesTest.php`. Sin esa prueba, la siguiente tabla que
 * guarde ficheros y no se registre aquí dejaría huérfanos para siempre y nadie
 * se enteraría — que es exactamente lo que acababa de pasar.
 */
final class StoredFiles
{
    /**
     * tabla => [columnas que guardan una clave de almacenamiento]
     *
     * @var array<string, list<string>>
     */
    public const COLUMNS = [
        'document_versions' => ['storage_key'],
        'message_attachments' => ['storage_key'],
        'equipment_media' => ['storage_key'],
        'export_jobs' => ['storage_key'],
        'signature_records' => ['signature_storage_key'],
        'tenant_branding' => ['logo_storage_key', 'logo_dark_storage_key', 'favicon_storage_key'],
        'users' => ['avatar_storage_key'],
    ];

    /**
     * Tablas cuya columna NO lleva `tenant_id`, para saber cómo acotarlas.
     *
     * `users` es la única: una persona puede pertenecer a varias empresas y su
     * avatar es suyo, no de ninguna. Importa al buscar huérfanos por empresa —
     * un avatar sin empresa no se puede atribuir a ninguna y no debe contarse
     * como huérfano de todas.
     *
     * @var list<string>
     */
    public const WITHOUT_TENANT = ['users'];

    /**
     * Las claves que nombran estas filas, para borrarlas junto con ellas.
     *
     * Se llama ANTES del DELETE. Después ya no hay fila que preguntar, y ese es
     * el orden que hay que respetar: leer las claves, borrar las filas,
     * confirmar la transacción, y solo entonces borrar los ficheros. Si se
     * borraran los ficheros primero y la transacción se deshiciera, quedarían
     * filas apuntando a ficheros que ya no están — que es peor que un huérfano:
     * un huérfano ocupa disco, una fila rota rompe una pantalla.
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    public static function keysOf(string $table, array $ids): array
    {
        if ($ids === [] || ! isset(self::COLUMNS[$table])) {
            return [];
        }

        $columnas = self::COLUMNS[$table];

        $filas = DB::table($table)->whereIn('id', $ids)->get($columnas);

        $claves = [];

        foreach ($filas as $fila) {
            foreach ($columnas as $columna) {
                $valor = $fila->{$columna} ?? null;

                if (is_string($valor) && $valor !== '') {
                    $claves[] = $valor;
                }
            }
        }

        return array_values(array_unique($claves));
    }

    /**
     * Todas las claves que la base de datos conoce.
     *
     * Es el lado «lo que debería existir» de la búsqueda de huérfanos. Se
     * devuelve como conjunto —claves del array— porque el barrido lo consulta
     * una vez por cada fichero del almacén, y con cien mil ficheros un
     * `in_array` sobre una lista es cien mil recorridos completos.
     *
     * INCLUYE las filas borradas suavemente, a propósito: una fila con
     * `deleted_at` sigue nombrando su fichero, y el fichero no es huérfano
     * mientras alguien pueda restaurarla. Los ficheros de las filas borradas se
     * van cuando la retención purga la fila, no antes.
     *
     * @return array<string, true>
     */
    public static function knownKeys(): array
    {
        $conocidas = [];

        foreach (self::COLUMNS as $tabla => $columnas) {
            foreach ($columnas as $columna) {
                DB::table($tabla)
                    ->whereNotNull($columna)
                    ->select($columna)
                    ->orderBy('id')
                    ->chunk(2000, function ($filas) use ($columna, &$conocidas): void {
                        foreach ($filas as $fila) {
                            $valor = $fila->{$columna};

                            if (is_string($valor) && $valor !== '') {
                                $conocidas[$valor] = true;
                            }
                        }
                    });
            }
        }

        return $conocidas;
    }

    /**
     * Filas que nombran un fichero que ya no está en el almacén.
     *
     * La dirección contraria del huérfano, y la que de verdad duele: un
     * huérfano ocupa disco y no molesta a nadie; una fila rota es un botón de
     * descargar que da error delante de un cliente.
     *
     * @return list<array{table: string, column: string, id: string, key: string}>
     */
    public static function danglingRows(DocumentStore $store, int $limite = 500): array
    {
        $rotas = [];

        foreach (self::COLUMNS as $tabla => $columnas) {
            foreach ($columnas as $columna) {
                DB::table($tabla)
                    ->whereNotNull($columna)
                    ->select(['id', $columna])
                    ->orderBy('id')
                    ->chunk(500, function ($filas) use ($tabla, $columna, $store, $limite, &$rotas): bool {
                        foreach ($filas as $fila) {
                            $clave = $fila->{$columna};

                            if (! is_string($clave) || $clave === '' || $store->exists($clave)) {
                                continue;
                            }

                            $rotas[] = [
                                'table' => $tabla,
                                'column' => $columna,
                                'id' => (string) $fila->id,
                                'key' => $clave,
                            ];

                            if (count($rotas) >= $limite) {
                                return false;
                            }
                        }

                        return true;
                    });
            }
        }

        return $rotas;
    }
}
