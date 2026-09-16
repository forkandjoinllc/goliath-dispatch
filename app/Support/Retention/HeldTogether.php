<?php

declare(strict_types=1);

namespace App\Support\Retention;

use App\Support\Documents\DocumentOwners;
use Illuminate\Support\Facades\DB;

/**
 * Lo que cuelga de una fila bloqueada, y por tanto se bloquea con ella.
 *
 * ## El defecto
 *
 * `Holds` describe su propio alcance `record` así, en su cabecera:
 *
 * > `record` — una carga concreta **y lo que cuelga de ella**.
 *
 * Y un párrafo antes:
 *
 * > Llega una reclamación por una carga —una detención discutida, un daño, un
 * > accidente— y a partir de ese momento todo lo relacionado tiene que dejar de
 * > envejecer: **los papeles, la conversación con el transportista, las horas
 * > del viaje, la factura**. Sin esto, la política de retención hace su trabajo
 * > puntualmente y borra la prueba.
 *
 * `Holds::stamp()` marcaba UNA fila:
 *
 * ```php
 * if ($scopeType === 'record' && $entityId !== null) {
 *     $q->where('id', $entityId);
 * }
 * ```
 *
 * Los papeles, la conversación, las horas del viaje y la factura seguían
 * envejeciendo con `legal_hold = 0`, y el barrido —que pregunta a esa columna
 * fila por fila— los purgaba en su fecha. El bloqueo protegía la carga y dejaba
 * que se borrara la prueba, que es exactamente lo que la clase existe para
 * impedir.
 *
 * Es la forma de siempre y la peor versión de ella: **el defecto ya estaba
 * diagnosticado por escrito, en el mismo fichero, y no se aplicó**.
 *
 * ## La dirección que sí estaba cubierta
 *
 * `Storage\CascadedFiles::heldParentIds()` resuelve la dirección CONTRARIA: un
 * hijo bloqueado impide borrar a su padre, porque MySQL se lo llevaría en
 * cascada. Su cabecera lo dice igual de claro —«el bloqueo protegía la fila y
 * no protegía nada»—. Media escalera construida hacia arriba y ningún peldaño
 * hacia abajo.
 *
 * ## Por qué esto no se puede preguntar a `information_schema`
 *
 * Porque casi nada de lo que cuelga de una carga cuelga por una clave foránea
 * en cascada. Los papeles se enganchan por `owner_type` + `owner_id`, que para
 * la base de datos son dos columnas cualesquiera; los avisos, por `subject_type`
 * + `subject_id`; y el PDF de una factura va en sentido contrario, de la factura
 * al documento. `CascadedFiles` puede deducir su mapa porque solo le interesan
 * las cascadas reales. Aquí hay que declararlo.
 *
 * Declarado, además, con un guardián que lo compara contra el esquema: toda
 * tabla de la política con una columna `load_id` tiene que estar en la lista, o
 * la suite se pone roja. Así la tabla número veintidós no se queda fuera en
 * silencio — que es como se queda fuera todo.
 */
final class HeldTogether
{
    /**
     * Padre => lo que cuelga de él, con la forma del enganche.
     *
     * Tres formas, porque el esquema usa tres:
     *
     *  - `por`   — el hijo guarda el id del padre (`conversations.load_id`).
     *  - `desde` — el PADRE guarda el id del hijo (`invoices.pdf_document_id`).
     *              Va en sentido contrario y es igual de real: ese PDF es la
     *              factura que alguien va a pedir en el pleito.
     *  - `cuando`— condición extra sobre el hijo, para los enganches
     *              polimórficos que no son de documentos (`notifications`).
     *
     * Los documentos NO se declaran aquí: `Documents\DocumentOwners` ya dice qué
     * tipo de dueño vive en qué tabla, y repetirlo sería la segunda lista que
     * contesta la misma pregunta — la forma exacta del defecto que este lote
     * arregla. Se derivan en `aristas()`.
     *
     * @var array<string, list<array{tabla: string, por?: string, desde?: string, cuando?: array<string, string>}>>
     */
    public const CUELGA = [
        'loads' => [
            ['tabla' => 'conversations', 'por' => 'load_id'],
            ['tabla' => 'tracking_sessions', 'por' => 'load_id'],
            ['tabla' => 'tracking_events', 'por' => 'load_id'],
            ['tabla' => 'permits', 'por' => 'load_id'],
            ['tabla' => 'escorts', 'por' => 'load_id'],
            ['tabla' => 'rate_confirmation_acceptances', 'por' => 'load_id'],
            ['tabla' => 'invoices', 'por' => 'load_id'],
            ['tabla' => 'expenses', 'por' => 'load_id'],
            ['tabla' => 'dispatcher_commissions', 'por' => 'load_id'],
            ['tabla' => 'financial_snapshots', 'por' => 'load_id'],
            ['tabla' => 'notifications', 'por' => 'subject_id', 'cuando' => ['subject_type' => 'load']],
        ],

        'conversations' => [
            ['tabla' => 'messages', 'por' => 'conversation_id'],
        ],
        'messages' => [
            ['tabla' => 'message_attachments', 'por' => 'message_id'],
        ],

        'documents' => [
            ['tabla' => 'document_versions', 'por' => 'document_id'],
        ],

        'invoices' => [
            ['tabla' => 'payments', 'por' => 'invoice_id'],
            ['tabla' => 'documents', 'desde' => 'pdf_document_id'],
        ],
        'carrier_settlements' => [
            ['tabla' => 'documents', 'desde' => 'pdf_document_id'],
        ],
        'rate_confirmation_acceptances' => [
            ['tabla' => 'documents', 'desde' => 'document_id'],
            ['tabla' => 'document_versions', 'desde' => 'document_version_id'],
        ],

        'signature_requests' => [
            ['tabla' => 'signature_records', 'por' => 'request_id'],
            ['tabla' => 'signature_audit_events', 'por' => 'request_id'],
        ],
        'signature_records' => [
            ['tabla' => 'documents', 'desde' => 'signed_document_id'],
            ['tabla' => 'documents', 'desde' => 'audit_certificate_document_id'],
        ],
    ];

    /**
     * Las aristas de una tabla: las declaradas más los papeles que le cuelgan.
     *
     * @return list<array{tabla: string, por?: string, desde?: string, cuando?: array<string, string>}>
     */
    public static function aristas(string $tabla): array
    {
        $aristas = self::CUELGA[$tabla] ?? [];

        foreach (DocumentOwners::tiposDeTabla($tabla) as $tipo) {
            $aristas[] = [
                'tabla' => 'documents',
                'por' => 'owner_id',
                'cuando' => ['owner_type' => $tipo],
            ];
        }

        return $aristas;
    }

    /**
     * Todo lo que cuelga de estas filas, tabla por tabla, hasta el final.
     *
     * Solo devuelve tablas que la política barre: marcar `legal_hold` en una
     * tabla que no se purga no protege nada y sí escribe donde no toca.
     *
     * @param  list<string>  $ids
     * @return array<string, list<string>> tabla => ids
     */
    public static function alcance(string $tenantId, string $tabla, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $encontrado = [];
        // (tabla, id) ya visitados. Sin esto, dos caminos hasta el mismo
        // documento —el de `owner_type` y el de `pdf_document_id`— lo recorren
        // dos veces, y un ciclo en el esquema no terminaría nunca.
        $vistos = [$tabla => array_fill_keys($ids, true)];
        $pendientes = [[$tabla, $ids]];

        while ($pendientes !== []) {
            [$desde, $lote] = array_shift($pendientes);

            foreach (self::aristas($desde) as $arista) {
                $hija = $arista['tabla'];
                $nuevos = self::idsDe($tenantId, $desde, $lote, $arista);

                $nuevos = array_values(array_filter(
                    $nuevos,
                    static fn (string $id): bool => ! isset($vistos[$hija][$id]),
                ));

                if ($nuevos === []) {
                    continue;
                }

                foreach ($nuevos as $id) {
                    $vistos[$hija][$id] = true;
                }

                if (isset(Policy::ENTITIES[$hija])) {
                    $encontrado[$hija] = [...($encontrado[$hija] ?? []), ...$nuevos];
                }

                $pendientes[] = [$hija, $nuevos];
            }
        }

        return $encontrado;
    }

    /**
     * Los ids del otro lado de una arista.
     *
     * @param  list<string>  $ids
     * @param  array{tabla: string, por?: string, desde?: string, cuando?: array<string, string>}  $arista
     * @return list<string>
     */
    private static function idsDe(string $tenantId, string $desdeTabla, array $ids, array $arista): array
    {
        $hija = $arista['tabla'];

        if (isset($arista['desde'])) {
            // El padre guarda el id del hijo. Se leen esas columnas y ya está:
            // no hace falta consultar la tabla hija.
            return DB::table($desdeTabla)
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $ids)
                ->whereNotNull($arista['desde'])
                ->pluck($arista['desde'])
                ->map(static fn ($id): string => (string) $id)
                ->unique()
                ->values()
                ->all();
        }

        $q = DB::table($hija)
            ->where('tenant_id', $tenantId)
            ->whereIn($arista['por'], $ids);

        foreach ($arista['cuando'] ?? [] as $columna => $valor) {
            $q->where($columna, $valor);
        }

        return $q->pluck('id')->map(static fn ($id): string => (string) $id)->unique()->values()->all();
    }
}
