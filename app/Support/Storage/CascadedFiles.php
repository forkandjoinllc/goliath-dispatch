<?php

declare(strict_types=1);

namespace App\Support\Storage;

use Illuminate\Support\Facades\DB;

/**
 * Los ficheros que se lleva por delante un borrado en cascada.
 *
 * ## El fallo que esta clase existe para arreglar
 *
 * La purga de retención recorre las tablas de la política una por una,
 * recogiendo las claves de almacenamiento de las filas que va a borrar. Parecía
 * completo. No lo era, y el hueco es de los que no se ven leyendo el código:
 *
 *     documents          ← la purga borra esta fila
 *       └─ document_versions   ← MySQL la borra en cascada, y aquí vive el fichero
 *
 * La clave del PDF vive en `document_versions`, no en `documents`. Al borrar el
 * documento, MySQL se lleva la versión por su clave foránea `on delete cascade`
 * **sin que el código pase por ella**, así que nadie leyó su `storage_key` y el
 * fichero se quedó en el disco para siempre. Y peor: la pasada siguiente sobre
 * `document_versions` ya no encontraba nada, así que el resumen decía
 * «ficheros: 0» y parecía correcto.
 *
 * Pasa en tres sitios de este esquema:
 *
 *  - `documents` → `document_versions`
 *  - `messages` → `message_attachments`
 *  - `signature_requests` → `signature_records`
 *
 * ## Por qué se lee de `information_schema` y no de una lista
 *
 * Podría enumerar esos tres pares a mano. No lo hago porque una lista escrita a
 * mano describe el esquema de hoy y calla el de mañana: la cuarta cascada que
 * alguien añada dejaría ficheros huérfanos exactamente igual, en silencio, y el
 * único síntoma sería un disco que crece. Preguntándoselo a la base de datos, la
 * cuarta cascada se cubre sola el día que exista.
 */
final class CascadedFiles
{
    /** @var array<string, list<array{table: string, column: string}>>|null */
    private static ?array $mapa = null;

    /**
     * Padre => hijos que guardan ficheros y cuelgan de él en cascada.
     *
     * @return array<string, list<array{table: string, column: string}>>
     */
    public static function map(): array
    {
        if (self::$mapa !== null) {
            return self::$mapa;
        }

        $conFicheros = array_keys(StoredFiles::COLUMNS);

        $filas = DB::select(
            'select k.TABLE_NAME as child, k.COLUMN_NAME as col, k.REFERENCED_TABLE_NAME as parent
             from information_schema.KEY_COLUMN_USAGE k
             join information_schema.REFERENTIAL_CONSTRAINTS r
               on r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
              and r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
             where k.TABLE_SCHEMA = database()
               and r.DELETE_RULE = ?
               and k.REFERENCED_TABLE_NAME is not null',
            ['CASCADE'],
        );

        $mapa = [];

        foreach ($filas as $f) {
            $hijo = (string) $f->child;
            $columna = (string) $f->col;
            $padre = (string) $f->parent;

            if (! in_array($hijo, $conFicheros, true)) {
                continue;
            }

            // `tenant_id` es la mitad de las claves foráneas compuestas que
            // impone el aislamiento entre empresas (ver 85_cross_tenant_isolation).
            // No identifica una fila del padre: filtrar por ella borraría los
            // ficheros de la empresa entera en vez de los de estas filas.
            if ($columna === 'tenant_id') {
                continue;
            }

            // Un hijo no cuelga de sí mismo, y `tenants` no está en la política.
            if ($padre === $hijo) {
                continue;
            }

            $mapa[$padre][] = ['table' => $hijo, 'column' => $columna];
        }

        foreach ($mapa as $padre => $hijos) {
            // El mismo par puede llegar dos veces: una por la clave simple y
            // otra por la compuesta del aislamiento.
            $vistos = [];
            $unicos = [];

            foreach ($hijos as $h) {
                $firma = $h['table'].'.'.$h['column'];

                if (! isset($vistos[$firma])) {
                    $vistos[$firma] = true;
                    $unicos[] = $h;
                }
            }

            $mapa[$padre] = $unicos;
        }

        return self::$mapa = $mapa;
    }

    /**
     * Las claves de almacenamiento que desaparecerán al borrar estas filas.
     *
     * Se llama ANTES del DELETE, igual que `StoredFiles::keysOf()`: después ya
     * no hay hijos que preguntar porque MySQL ya se los llevó.
     *
     * @param  list<string>  $parentIds
     * @return list<string>
     */
    public static function keysFor(string $parentTable, array $parentIds): array
    {
        if ($parentIds === []) {
            return [];
        }

        $claves = [];

        foreach (self::map()[$parentTable] ?? [] as $hijo) {
            $columnas = StoredFiles::COLUMNS[$hijo['table']] ?? [];

            if ($columnas === []) {
                continue;
            }

            $ids = DB::table($hijo['table'])
                ->whereIn($hijo['column'], $parentIds)
                ->pluck('id')
                ->map(static fn ($id): string => (string) $id)
                ->all();

            $claves = [...$claves, ...StoredFiles::keysOf($hijo['table'], $ids)];

            // Nietos: un hijo puede tener a su vez hijos con ficheros. Hoy no
            // ocurre en este esquema, y se recorre igual porque el día que
            // ocurra nadie va a acordarse de venir a añadirlo.
            $claves = [...$claves, ...self::keysFor($hijo['table'], $ids)];
        }

        return array_values(array_unique($claves));
    }

    /**
     * De estas filas padre, cuáles tienen algún descendiente bajo bloqueo legal.
     *
     * Es la otra mitad del mismo problema, y la más grave. Un bloqueo legal
     * sobre `document_versions` marca sus filas, pero **no marca los
     * `documents` de los que cuelgan**. La purga miraba el `legal_hold` de la
     * fila que iba a borrar, veía cero, borraba el documento — y MySQL se
     * llevaba en cascada la versión que alguien había bloqueado para un pleito.
     *
     * El bloqueo protegía la fila y no protegía nada.
     *
     * Aquí se pregunta al revés: antes de borrar un padre, ¿hay debajo algo que
     * no se pueda borrar? Si lo hay, el padre no se toca. Es más conservador de
     * lo estrictamente necesario —salva el documento entero por una sola versión
     * bloqueada— y esa es la dirección correcta en la que equivocarse.
     *
     * @param  list<string>  $parentIds
     * @return list<string>
     */
    public static function heldParentIds(string $parentTable, array $parentIds): array
    {
        if ($parentIds === []) {
            return [];
        }

        $bloqueados = [];

        foreach (self::map()[$parentTable] ?? [] as $hijo) {
            $ids = DB::table($hijo['table'])
                ->whereIn($hijo['column'], $parentIds)
                ->where('legal_hold', 1)
                ->pluck($hijo['column'])
                ->map(static fn ($id): string => (string) $id)
                ->all();

            $bloqueados = [...$bloqueados, ...$ids];

            // Y los nietos: un hijo bloqueado protege a su padre, y el padre de
            // ese padre tampoco se puede borrar.
            $todosLosHijos = DB::table($hijo['table'])
                ->whereIn($hijo['column'], $parentIds)
                ->pluck('id', $hijo['column'])
                ->all();

            if ($todosLosHijos !== []) {
                $nietosBloqueados = self::heldParentIds(
                    $hijo['table'],
                    array_map(static fn ($id): string => (string) $id, array_values($todosLosHijos)),
                );

                foreach ($todosLosHijos as $padreId => $hijoId) {
                    if (in_array((string) $hijoId, $nietosBloqueados, true)) {
                        $bloqueados[] = (string) $padreId;
                    }
                }
            }
        }

        return array_values(array_unique($bloqueados));
    }

    /** Para las pruebas: olvida el mapa memorizado. */
    public static function forget(): void
    {
        self::$mapa = null;
    }
}
