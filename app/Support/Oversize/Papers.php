<?php

declare(strict_types=1);

namespace App\Support\Oversize;

use App\Authorization\Actor;
use App\Support\Documents\Attachment;
use App\Support\Storage\DocumentStore;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Los papeles de una carga sobredimensionada.
 *
 * ## El defecto
 *
 * La puerta de despacho de una carga sobredimensionada dice, con estas
 * palabras en el código que la implementa, que alguien tiene que declarar que
 * «los papeles están todos». Y no había dónde poner un papel:
 * `permits.document_id`, `permits.route_survey_document_id` y
 * `escorts.document_id` existían desde el primer día y no las escribía nadie.
 *
 * Los tres rótulos ya estaban escritos en el diccionario VIVO —«Documento del
 * permiso», «Documento del estudio de ruta», «Documento de la escolta»— y no
 * los pedía ninguna pantalla.
 *
 * O sea que la oficina marcaba el permiso como emitido, declaraba los papeles
 * completos, y el conductor salía sin ninguno. Un permiso de sobredimensión es
 * exactamente el papel que le piden en una báscula.
 *
 * ## Tres columnas, un mismo gesto
 *
 * Las tres se manejan igual y por eso viven juntas: cada una apunta a un
 * documento, se sustituye por otro, y al sustituirla el anterior se borra en
 * suave. Lo común con el resto de la aplicación —escribir el documento y su
 * versión— está en `Attachment`.
 */
final class Papers
{
    /**
     * Dónde puede colgarse un papel: tabla, columna y tipo de documento.
     *
     * Lista cerrada a propósito. La ruta recibe la ranura desde el navegador, y
     * sin esta lista un nombre de columna elegido por el cliente acabaría en un
     * `update()`.
     *
     * @var array<string, array{tabla: string, columna: string, tipo: string}>
     */
    public const RANURAS = [
        'permit' => ['tabla' => 'permits', 'columna' => 'document_id', 'tipo' => 'permit'],
        'route_survey' => ['tabla' => 'permits', 'columna' => 'route_survey_document_id', 'tipo' => 'route_survey'],
        'escort' => ['tabla' => 'escorts', 'columna' => 'document_id', 'tipo' => 'escort_document'],
    ];

    /** Estados de permiso que cuentan como «tramitado». */
    public const EMITIDO = 'issued';

    /** El permiso no hace falta, así que su papel tampoco. */
    public const NO_REQUERIDO = 'not_required';

    public static function conoce(string $ranura): bool
    {
        return array_key_exists($ranura, self::RANURAS);
    }

    /**
     * Cuelga un papel en una ranura, sustituyendo el que hubiera.
     *
     * La fila tiene que ser DE ESTA CARGA y de esta empresa: quien llama pasa
     * las dos cosas y aquí se comprueban, porque el identificador de la fila
     * viene del navegador.
     *
     * @return bool si se colgó
     */
    public static function attach(
        Actor $actor,
        string $ranura,
        string $loadId,
        string $filaId,
        UploadedFile $file,
        DocumentStore $store,
    ): bool {
        if (! self::conoce($ranura)) {
            return false;
        }

        ['tabla' => $tabla, 'columna' => $columna, 'tipo' => $tipo] = self::RANURAS[$ranura];

        $anterior = DB::table($tabla)
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $loadId)
            ->where('id', $filaId)
            ->whereNull('deleted_at')
            ->value($columna);

        // `exists()` aparte no haría falta si `value()` distinguiera «no hay
        // fila» de «la columna es nula», y no lo hace: las dos devuelven null.
        $existe = DB::table($tabla)
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $loadId)
            ->where('id', $filaId)
            ->whereNull('deleted_at')
            ->exists();

        if (! $existe) {
            return false;
        }

        $document = Attachment::store($actor, $ranura, $filaId, $tipo, $file, $store);

        DB::table($tabla)->where('id', $filaId)->update([
            $columna => $document->id,
            'updated_at' => CarbonImmutable::now(),
        ]);

        if ($anterior !== null) {
            Attachment::retire($actor, (string) $anterior);
        }

        return true;
    }

    /** Quita el papel de una ranura. */
    public static function detach(Actor $actor, string $ranura, string $loadId, string $filaId): bool
    {
        if (! self::conoce($ranura)) {
            return false;
        }

        ['tabla' => $tabla, 'columna' => $columna] = self::RANURAS[$ranura];

        $documentId = DB::table($tabla)
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $loadId)
            ->where('id', $filaId)
            ->whereNull('deleted_at')
            ->value($columna);

        if ($documentId === null) {
            return false;
        }

        DB::table($tabla)->where('id', $filaId)->update([
            $columna => null,
            'updated_at' => CarbonImmutable::now(),
        ]);

        Attachment::retire($actor, (string) $documentId);

        return true;
    }

    /**
     * Qué le falta a esta carga para que «los papeles están todos» sea verdad.
     *
     * Devuelve CLAVES de motivo, no frases: las traduce la pantalla, y el mismo
     * motivo lo usan el error del servidor y el aviso que se enseña antes de
     * pulsar. Que salgan del mismo sitio es lo que impide que digan cosas
     * distintas.
     *
     * @return list<array{reason: string, state: string}>
     */
    public static function faltan(string $tenantId, string $loadId, ?CarbonImmutable $entregaPlanificada): array
    {
        $faltas = [];

        $permisos = DB::table('permits')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->whereNull('deleted_at')
            ->orderBy('state_code')
            ->get(['state_code', 'status', 'document_id', 'expires_at']);

        foreach ($permisos as $permiso) {
            $estado = (string) $permiso->state_code;

            if ((string) $permiso->status !== self::EMITIDO) {
                // Los pendientes ya los cuenta la comprobación de siempre; aquí
                // solo se miran los que se dan por hechos.
                continue;
            }

            // Un permiso emitido SIN su papel es el defecto entero de este
            // lote: la casilla dice que está y el conductor no lo lleva.
            if ($permiso->document_id === null) {
                $faltas[] = ['reason' => 'permitWithoutDocument', 'state' => $estado];
            }

            /*
             * Y uno que caduca antes de entregar.
             *
             * `expires_at` se guardaba desde el primer día y no lo miraba
             * nadie. Un permiso válido hasta el jueves en una carga que entrega
             * el sábado no es un permiso: es un permiso vencido esperando a que
             * lo paren.
             *
             * Se compara contra la entrega PLANIFICADA porque es lo que se sabe
             * al despachar. Sin fecha planificada no se puede decir nada, y no
             * se inventa: no se avisa.
             */
            if ($entregaPlanificada !== null
                && $permiso->expires_at !== null
                && CarbonImmutable::parse((string) $permiso->expires_at)->isBefore($entregaPlanificada)) {
                $faltas[] = ['reason' => 'permitExpiresBeforeDelivery', 'state' => $estado];
            }
        }

        return $faltas;
    }
}
