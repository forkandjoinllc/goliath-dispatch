<?php

declare(strict_types=1);

namespace App\Support\Platform;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Lo que hay materializado en `document_expirations`, para quien lo mire.
 *
 * La tabla la escribe el barrido; esto solo la lee. Se separa del comando
 * porque una pantalla no debería tener que ejecutar un barrido para saber qué
 * está por vencer — que es justo la diferencia entre una tabla materializada y
 * un cálculo repetido.
 */
final class Expirations
{
    /**
     * Resumen por empresa de lo que está sin resolver.
     *
     * @return array{warning: int, expired: int, oldestFirstDetectedAt: string|null}
     */
    public static function summary(string $tenantId): array
    {
        $filas = DB::table('document_expirations')
            ->where('tenant_id', $tenantId)
            ->whereNull('resolved_at')
            ->selectRaw('kind, count(*) as total, min(first_detected_at) as primero')
            ->groupBy('kind')
            ->get();

        return [
            'warning' => (int) ($filas->firstWhere('kind', 'warning')->total ?? 0),
            'expired' => (int) ($filas->firstWhere('kind', 'expired')->total ?? 0),
            'oldestFirstDetectedAt' => $filas->min('primero') === null
                ? null
                : substr((string) $filas->min('primero'), 0, 16),
        ];
    }

    /**
     * Los vencimientos sin resolver de una empresa, con el documento.
     *
     * @return list<array<string, mixed>>
     */
    public static function pending(string $tenantId, int $limite = 100): array
    {
        return DB::table('document_expirations as e')
            ->leftJoin('documents as d', 'd.id', '=', 'e.document_id')
            ->where('e.tenant_id', $tenantId)
            ->whereNull('e.resolved_at')
            ->orderBy('e.expiration_date')
            ->limit($limite)
            ->get([
                'e.id', 'e.kind', 'e.expiration_date', 'e.first_detected_at', 'e.notified_at',
                'd.id as document_id', 'd.title', 'd.document_type', 'd.owner_type', 'd.owner_id',
            ])
            ->map(static fn (object $e): array => [
                'id' => (string) $e->id,
                'kind' => (string) $e->kind,
                'expiresOn' => substr((string) $e->expiration_date, 0, 10),
                'firstDetectedAt' => substr((string) $e->first_detected_at, 0, 16),
                'documentId' => $e->document_id === null ? null : (string) $e->document_id,
                'title' => $e->title,
                'documentType' => $e->document_type,
            ])
            ->all();
    }

    /**
     * Cierra todo aviso que ya no describe el estado de su documento.
     *
     * ## El defecto que arregla
     *
     * Esta función cerraba solo los HUÉRFANOS: documentos borrados o a los que
     * se les quitó la caducidad. El barrido, por su lado, cerraba los de fecha
     * ANTERIOR:
     *
     * ```php
     * ->whereDate('expiration_date', '<', $vence)
     * ```
     *
     * Entre las dos quedaron dos agujeros, y los dos suman al mismo contador:
     *
     *  1. **La transición.** Cuando un documento pasa de «por vencer» a
     *     «vencido», la fecha de caducidad es LA MISMA y solo cambia el `kind`.
     *     La consulta de arriba busca estrictamente anterior, así que no
     *     encontraba nada: el índice único `(document_id, kind,
     *     expiration_date)` dejaba entrar la fila nueva y la vieja se quedaba
     *     sin resolver. Salud de plataforma decía «Por vencer: 1 · Ya vencidos:
     *     1» sobre UN solo documento.
     *
     *  2. **La renovación.** Si alguien renueva el papel, su fecha se va un año
     *     adelante y el documento deja de entrar en la consulta del barrido
     *     —que solo mira los que caducan dentro del plazo—, así que
     *     `materializar()` no vuelve a ejecutarse para él nunca. Sus filas
     *     viejas se quedaban colgadas PARA SIEMPRE: «Ya vencidos: 12» sobre
     *     papeles renovados hace meses, mientras el listado del inquilino,
     *     que recalcula, decía cero.
     *
     * ## La regla, que es una sola
     *
     * Un aviso materializado se cierra **en cuanto deja de describir el estado
     * de hoy de su documento**. Eso cubre las dos cosas de arriba y también los
     * huérfanos, que eran un caso particular: un documento borrado no tiene
     * estado que describir.
     *
     * El estado de hoy se deriva aquí y no se lee de ningún sitio, porque no
     * está guardado en ninguna parte: un documento con fecha anterior a hoy
     * está `expired`, uno dentro del plazo de aviso está `warning`, y el resto
     * no tiene aviso que valga.
     */
    public static function resolveStale(string $tenantId, int $diasDeAviso): int
    {
        $ahora = CarbonImmutable::now();
        $hoy = $ahora->toDateString();
        $limite = $ahora->addDays($diasDeAviso)->toDateString();

        return DB::table('document_expirations')
            ->where('tenant_id', $tenantId)
            ->whereNull('resolved_at')
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('documents')
                ->whereColumn('documents.id', 'document_expirations.document_id')
                ->whereNull('documents.deleted_at')
                ->whereNotNull('documents.expiration_date')
                // La MISMA fecha: si el documento se renovó, la fila vieja
                // habla de un vencimiento que ya no existe.
                ->whereRaw('date(documents.expiration_date) = date(document_expirations.expiration_date)')
                // Y dentro del plazo: un papel que caduca dentro de un año no
                // tiene ningún aviso vivo.
                ->whereRaw('date(documents.expiration_date) <= ?', [$limite])
                // Y el MISMO tipo: en la transición de «por vencer» a
                // «vencido», la fecha no cambia y el tipo sí. Sin esta línea,
                // el mismo documento se contaba en los dos cubos.
                ->whereRaw(
                    "document_expirations.kind = case when date(documents.expiration_date) < ? then 'expired' else 'warning' end",
                    [$hoy],
                ))
            ->update(['resolved_at' => $ahora, 'updated_at' => $ahora]);
    }
}
