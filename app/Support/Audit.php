<?php

declare(strict_types=1);

namespace App\Support;

use App\Authorization\Actor;
use App\Enums\AuditAction;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Escribe en la pista de auditoría.
 *
 * `audit_events` es de solo-añadir: un disparador de la base de datos rechaza
 * cualquier UPDATE o DELETE. Eso significa que lo que se escriba aquí no se
 * puede corregir después, ni siquiera con acceso a la base de datos, así que lo
 * que se guarda tiene que ser exacto a la primera.
 *
 * Dos detalles que no son opcionales:
 *
 *  - El actor se atribuye con `auditUserId()`, que durante una suplantación
 *    devuelve a quien está REALMENTE a los mandos, no a la persona suplantada.
 *    Atribuir la acción al suplantado sería falsificar el registro.
 *  - Los resúmenes son resúmenes, no volcados de fila. Un `before_summary` con
 *    la fila entera acabaría guardando datos personales y cifrados en una tabla
 *    que por diseño no se puede purgar.
 */
final class Audit
{
    /**
     * @param  array<string, mixed>|null  $before
     * @param  array<string, mixed>|null  $after
     */
    public static function record(
        ?Actor $actor,
        AuditAction $action,
        ?string $entityType = null,
        ?string $entityId = null,
        ?string $entityLabel = null,
        ?array $before = null,
        ?array $after = null,
        ?string $reason = null,
    ): void {
        $request = request();

        DB::table('audit_events')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $actor?->tenantId,
            'actor_user_id' => $actor?->auditUserId(),
            'actor_email' => $actor?->email,
            'actor_role' => $actor?->role?->value,
            'effective_user_id' => $actor?->userId,
            'impersonation_session_id' => $actor?->impersonation?->impersonationSessionId,
            'action' => $action->value,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            // 200 caracteres en la columna. Se corta aquí y no en la base de
            // datos porque en modo estricto MySQL rechazaría la fila entera, y
            // perder el evento de auditoría por un nombre largo es peor que
            // guardarlo truncado.
            'entity_label' => $entityLabel === null ? null : Str::limit($entityLabel, 197),
            'before_summary' => $before === null ? null : json_encode($before),
            'after_summary' => $after === null ? null : json_encode($after),
            'reason' => $reason,
            'ip_address' => $request?->ip(),
            'user_agent' => Str::limit((string) $request?->userAgent(), 500),
            'request_id' => $request?->header('X-Request-Id'),
            'occurred_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
