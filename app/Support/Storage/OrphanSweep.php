<?php

declare(strict_types=1);

namespace App\Support\Storage;

use Carbon\CarbonImmutable;

/**
 * Ficheros sin fila, y filas sin fichero.
 *
 * Las dos direcciones de la misma desincronización, con consecuencias muy
 * distintas:
 *
 *  - **Fichero sin fila (huérfano).** Ocupa disco y no molesta a nadie. Aparece
 *    solo: alguien sube un documento, el fichero se guarda, y la transacción
 *    que iba a escribir la fila revienta —o el navegador se cierra a mitad—.
 *    `LoadFile::attach()` y `DocumentController::store()` guardan el fichero
 *    FUERA de la transacción a propósito, para no tener las tablas bloqueadas
 *    mientras sube; el precio de esa decisión correcta es exactamente este.
 *  - **Fila sin fichero (rota).** Es un botón de descargar que da error delante
 *    de un cliente. No debería pasar nunca, y si pasa es que alguien borró algo
 *    a mano en el servidor.
 *
 * ## Por qué el huérfano tiene que ser VIEJO
 *
 * Un fichero recién subido cuya fila todavía no se ha escrito parece un
 * huérfano y no lo es: es una subida en curso. Un barrido que lo borrara
 * rompería la subida de alguien que está mirando la pantalla en ese momento.
 *
 * Por eso solo cuenta como huérfano el que lleva más de `MARGEN_HORAS` sin que
 * nadie lo reclame. Veinticuatro horas es holgado a propósito: el coste de
 * esperar un día es un fichero de más en el disco, y el de no esperar es una
 * subida rota sin explicación posible.
 */
final class OrphanSweep
{
    /**
     * Cuánto tiempo se le da a un fichero para que aparezca su fila.
     *
     * Ver la nota de la clase: el error barato es esperar de más.
     */
    public const MARGEN_HORAS = 24;

    /**
     * Los ficheros que nadie reclama, SIN borrar nada.
     *
     * @return array{files: list<array{key: string, bytes: int}>, bytes: int, scanned: int, tooRecent: int}
     */
    public static function find(DocumentStore $store, ?CarbonImmutable $now = null, int $limite = 1000): array
    {
        $now ??= CarbonImmutable::now();
        $corte = $now->subHours(self::MARGEN_HORAS);

        // Todas las claves que la base de datos conoce, de una vez y como
        // conjunto: se consulta una por cada fichero del almacén, y con cien mil
        // ficheros un `in_array` sobre una lista serían cien mil recorridos.
        $conocidas = StoredFiles::knownKeys();

        $huerfanos = [];
        $bytes = 0;
        $revisados = 0;
        $recientes = 0;

        foreach ($store->keys() as $clave) {
            $revisados++;

            if (isset($conocidas[$clave])) {
                continue;
            }

            // Una subida en curso todavía no tiene fila. No es un huérfano: es
            // alguien mirando la pantalla ahora mismo.
            if (! self::isOlderThan($store, $clave, $corte)) {
                $recientes++;

                continue;
            }

            $tam = self::sizeOf($store, $clave);
            $huerfanos[] = ['key' => $clave, 'bytes' => $tam];
            $bytes += $tam;

            if (count($huerfanos) >= $limite) {
                break;
            }
        }

        return ['files' => $huerfanos, 'bytes' => $bytes, 'scanned' => $revisados, 'tooRecent' => $recientes];
    }

    /**
     * Borra los huérfanos. Permanente.
     *
     * Detrás del MISMO interruptor que la purga de retención, y no de uno
     * propio. Son la misma decisión —«esta instalación puede borrar ficheros
     * para siempre»— y partirla en dos opciones significaría que alguien puede
     * tener una encendida y la otra apagada sin haber decidido nada.
     */
    public static function purge(DocumentStore $store, ?CarbonImmutable $now = null, int $limite = 1000): int
    {
        if (! config('retention.purge_enabled')) {
            return 0;
        }

        $encontrados = self::find($store, $now, $limite);

        $claves = array_map(
            static fn (array $f): string => $f['key'],
            $encontrados['files'],
        );

        return $claves === [] ? 0 : $store->deleteMany($claves);
    }

    /**
     * La otra dirección: filas que nombran un fichero que ya no está.
     *
     * No se arregla sola —no hay de dónde sacar el fichero— así que solo se
     * cuenta y se enseña. Lo que hace falta saber es si el número es cero.
     *
     * @return list<array{table: string, column: string, id: string, key: string}>
     */
    public static function dangling(DocumentStore $store, int $limite = 500): array
    {
        return StoredFiles::danglingRows($store, $limite);
    }

    private static function isOlderThan(DocumentStore $store, string $clave, CarbonImmutable $corte): bool
    {
        // La fecha del fichero la sabe el disco, no la aplicación. `size()` es
        // lo único que la interfaz garantiza, así que el adaptador local expone
        // la fecha aparte y los demás caen a «sí, es viejo» — que para S3 es
        // correcto porque allí el listado ya trae la fecha de modificación.
        if (! method_exists($store, 'lastModified')) {
            return true;
        }

        /** @var int $ts */
        $ts = $store->lastModified($clave);

        return $ts > 0 && CarbonImmutable::createFromTimestamp($ts)->lessThan($corte);
    }

    private static function sizeOf(DocumentStore $store, string $clave): int
    {
        try {
            return $store->size($clave);
        } catch (\Throwable) {
            // Un fichero que desaparece entre el listado y la medición no es un
            // error del barrido: es que alguien lo borró mientras mirábamos.
            return 0;
        }
    }
}
