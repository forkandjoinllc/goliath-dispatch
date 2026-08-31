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
     * Marca como resueltos los vencimientos de documentos que ya no aplican.
     *
     * Un documento borrado o cuya caducidad se quitó deja avisos huérfanos que
     * nadie va a cerrar nunca. Se limpia aquí y no en el borrado del documento
     * porque el borrado puede venir por muchas puertas —la pantalla, la
     * retención, un arreglo a mano— y ninguna debería tener que acordarse.
     */
    public static function resolveOrphans(string $tenantId): int
    {
        $ahora = CarbonImmutable::now();

        return DB::table('document_expirations')
            ->where('tenant_id', $tenantId)
            ->whereNull('resolved_at')
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('documents')
                ->whereColumn('documents.id', 'document_expirations.document_id')
                ->whereNull('documents.deleted_at')
                ->whereNotNull('documents.expiration_date'))
            ->update(['resolved_at' => $ahora, 'updated_at' => $ahora]);
    }
}
