<?php

declare(strict_types=1);

namespace App\Support\Retention;

use App\Authorization\Actor;
use App\Enums\AuditAction;
use App\Support\Audit;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * El bloqueo legal: «a partir de ahora no se toca nada de esto».
 *
 * Es la mitad del módulo que de verdad se usa un martes cualquiera. Llega una
 * reclamación por una carga —una detención discutida, un daño, un accidente— y
 * a partir de ese momento todo lo relacionado tiene que dejar de envejecer:
 * los papeles, la conversación con el transportista, las horas del viaje, la
 * factura. Sin esto, la política de retención hace su trabajo puntualmente y
 * borra la prueba.
 *
 * Tres alcances, que el esquema ya declaraba en `scope_type`:
 *
 *  - `tenant` — toda la empresa. El martillo: se usa cuando llega una citación
 *    amplia y todavía no se sabe qué pide.
 *  - `entity_type` — todas las filas de un tipo (todos los documentos).
 *  - `record` — una carga concreta y lo que cuelga de ella.
 *
 * ## Por qué se marca la columna `legal_hold` de cada fila
 *
 * Se podría no marcarla y preguntar por `legal_holds` en cada barrido. No se
 * hace, por dos motivos y el segundo pesa más:
 *
 *  1. El barrido recorre veintiuna tablas. Cruzar cada una contra los bloqueos
 *     vigentes es una consulta cara repetida veintiuna veces cada noche.
 *  2. **La columna existe en treinta tablas y no la escribía nadie.** Una
 *     columna que nadie escribe es una columna que miente: cualquiera que mire
 *     `documents.legal_hold` y vea ceros concluye que no hay bloqueos. Ahora
 *     dice la verdad, y el barrido puede confiar en ella.
 *
 * El precio es que aplicar un bloqueo escribe en muchas filas, y levantarlo
 * también. Se acepta: un bloqueo se aplica una vez y se consulta cada noche
 * durante años.
 */
final class Holds
{
    public const SCOPES = ['tenant', 'entity_type', 'record'];

    /**
     * Aplica un bloqueo y marca las filas que cubre.
     *
     * @return string el id del bloqueo
     */
    public static function apply(
        Actor $actor,
        string $name,
        string $reason,
        string $scopeType = 'tenant',
        ?string $entityType = null,
        ?string $entityId = null,
        ?string $matterReference = null,
    ): string {
        if (! in_array($scopeType, self::SCOPES, true)) {
            throw new \InvalidArgumentException('Alcance de bloqueo desconocido: '.$scopeType);
        }

        if ($scopeType !== 'tenant' && $entityType === null) {
            throw new \InvalidArgumentException('Un bloqueo por tipo o por registro necesita saber de qué tipo.');
        }

        if ($scopeType === 'record' && $entityId === null) {
            throw new \InvalidArgumentException('Un bloqueo de un registro necesita saber cuál.');
        }

        $usuarioId = $actor->auditUserId();
        $id = (string) Str::uuid();

        DB::transaction(function () use ($id, $actor, $name, $reason, $scopeType, $entityType, $entityId, $matterReference, $usuarioId): void {
            DB::table('legal_holds')->insert([
                'id' => $id,
                'tenant_id' => $actor->tenantId,
                'name' => mb_substr($name, 0, 200),
                'reason' => $reason,
                'scope_type' => $scopeType,
                'entity_type' => $entityType,
                'entity_id' => $entityId,
                'matter_reference' => $matterReference === null ? null : mb_substr($matterReference, 0, 120),
                'applied_by_user_id' => $usuarioId,
                'applied_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            self::stamp($actor, $scopeType, $entityType, $entityId, true);
        });

        Audit::record(
            actor: $actor,
            action: AuditAction::LegalHoldApplied,
            entityType: 'legal_hold',
            entityId: $id,
            entityLabel: $name,
            after: ['scope' => $scopeType, 'entityType' => $entityType, 'entityId' => $entityId],
            reason: $reason,
        );

        return $id;
    }

    /**
     * Levanta un bloqueo.
     *
     * Y aquí está la parte con trampa: al levantar NO se puede poner
     * `legal_hold = 0` sin más en las filas que cubría, porque OTRO bloqueo
     * vigente puede cubrir las mismas. Dos reclamaciones sobre la misma carga es
     * lo normal, no lo raro —el cliente por un lado, el seguro por otro—, y
     * cerrar la primera dejaría la carga desprotegida frente a la segunda.
     *
     * Así que se limpia todo y se vuelve a marcar desde los bloqueos que siguen
     * vigentes. Es más caro y es lo correcto.
     */
    public static function release(Actor $actor, string $holdId, string $releaseReason): bool
    {
        $bloqueo = DB::table('legal_holds')
            ->where('id', $holdId)
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('released_at')
            ->first();

        if ($bloqueo === null) {
            return false;
        }

        DB::transaction(function () use ($actor, $holdId, $releaseReason): void {
            DB::table('legal_holds')->where('id', $holdId)->update([
                'released_by_user_id' => $actor->auditUserId(),
                'released_at' => now(),
                'release_reason' => $releaseReason,
                'updated_at' => now(),
            ]);

            self::rebuild($actor);
        });

        Audit::record(
            actor: $actor,
            action: AuditAction::LegalHoldReleased,
            entityType: 'legal_hold',
            entityId: $holdId,
            entityLabel: (string) $bloqueo->name,
            before: ['appliedAt' => (string) $bloqueo->applied_at],
            reason: $releaseReason,
        );

        return true;
    }

    /** Los bloqueos vigentes de una empresa. */
    public static function active(string $tenantId): \Illuminate\Support\Collection
    {
        return DB::table('legal_holds')
            ->where('tenant_id', $tenantId)
            ->whereNull('released_at')
            ->orderByDesc('applied_at')
            ->get();
    }

    /** ¿Cubre algún bloqueo vigente a este registro? */
    public static function covers(string $tenantId, string $entityType, ?string $entityId = null): bool
    {
        return self::active($tenantId)->contains(function (object $h) use ($entityType, $entityId): bool {
            return match ((string) $h->scope_type) {
                'tenant' => true,
                'entity_type' => (string) $h->entity_type === $entityType,
                'record' => (string) $h->entity_type === $entityType
                    && $entityId !== null
                    && (string) $h->entity_id === $entityId,
                default => false,
            };
        });
    }

    /**
     * Vuelve a marcar `legal_hold` desde cero, a partir de los bloqueos vigentes.
     *
     * Se usa al levantar uno. Limpiar y reconstruir en vez de restar es lo único
     * que no se equivoca cuando dos bloqueos se solapan.
     */
    public static function rebuild(Actor $actor): void
    {
        foreach (array_keys(Policy::ENTITIES) as $tabla) {
            DB::table($tabla)->where('tenant_id', $actor->tenantId)->update(['legal_hold' => 0]);
        }

        foreach (self::active((string) $actor->tenantId) as $h) {
            self::stamp(
                $actor,
                (string) $h->scope_type,
                $h->entity_type === null ? null : (string) $h->entity_type,
                $h->entity_id === null ? null : (string) $h->entity_id,
                true,
            );
        }
    }

    /** Pone o quita la marca en las filas que un alcance cubre. */
    private static function stamp(Actor $actor, string $scopeType, ?string $entityType, ?string $entityId, bool $held): void
    {
        $valor = $held ? 1 : 0;

        $tablas = match ($scopeType) {
            'tenant' => array_keys(Policy::ENTITIES),
            'entity_type', 'record' => isset(Policy::ENTITIES[$entityType]) ? [$entityType] : [],
            default => [],
        };

        foreach ($tablas as $tabla) {
            $q = DB::table($tabla)->where('tenant_id', $actor->tenantId);

            if ($scopeType === 'record' && $entityId !== null) {
                $q->where('id', $entityId);
            }

            $q->update(['legal_hold' => $valor]);
        }
    }
}
