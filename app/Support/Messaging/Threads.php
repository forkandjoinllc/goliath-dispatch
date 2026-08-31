<?php

declare(strict_types=1);

namespace App\Support\Messaging;

use App\Authorization\Actor;
use App\Enums\AuditAction;
use App\Models\Conversation;
use App\Support\Audit;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Crear hilos y decidir quién está dentro.
 *
 * Las tres clases de hilo que el esquema declara en `conversations.kind`:
 *
 *  - `load` — cuelga de una carga. Es el que importa: hoy «¿le avisaste al
 *    transportista de que la cita cambió?» se contesta por teléfono y no queda
 *    nada. Se busca-o-crea, uno por carga: dos hilos de la misma carga es
 *    peor que ninguno, porque la mitad de la conversación queda en el otro.
 *  - `direct` — entre personas, sin carga.
 *  - `broadcast` — de la casa a un grupo.
 *
 * Sobre los participantes de un hilo de carga: quien lo abre, y el transportista
 * de la carga. NO todo el mundo con permiso. Un hilo con quince personas dentro
 * es un hilo que nadie lee, y la gente vuelve al teléfono.
 */
final class Threads
{
    public const KINDS = ['direct', 'load', 'broadcast'];

    /**
     * El hilo de una carga, creándolo la primera vez.
     *
     * Idempotente por `load_id`: la segunda llamada devuelve el mismo. El
     * esquema no lo impone con un índice único —un hilo de carga borrado y otro
     * nuevo son legítimos— así que lo impone esta función, que es el único sitio
     * que los crea.
     */
    public static function forLoad(Actor $actor, string $loadId): Conversation
    {
        $existente = Conversation::query()
            ->where('load_id', $loadId)
            ->where('kind', 'load')
            ->first();

        if ($existente !== null) {
            // Quien abre el hilo se mete en él. Sin esto, el despachador que
            // hereda una carga vería el hilo en la lista y no podría leerlo.
            self::addParticipant($actor, (string) $existente->id, $actor);

            return $existente;
        }

        $carga = DB::table('loads')->where('id', $loadId)->first(['id', 'load_number', 'carrier_id']);

        if ($carga === null) {
            throw new \RuntimeException('No existe la carga '.$loadId);
        }

        return DB::transaction(function () use ($actor, $carga, $loadId): Conversation {
            $hilo = new Conversation;
            $hilo->kind = 'load';
            $hilo->load_id = $loadId;
            $hilo->carrier_id = $carga->carrier_id;
            $hilo->subject = (string) $carga->load_number;
            // Un hilo de carga es operativo por definición: en él se acuerdan
            // citas, se avisan retrasos y se discuten detenciones. La columna
            // marca lo que la política de retención no puede tirar sin más.
            $hilo->is_operational = true;
            $hilo->created_by_user_id = $actor->auditUserId();
            $hilo->save();

            self::addParticipant($actor, (string) $hilo->id, $actor);
            self::addCarrierUsers($actor, (string) $hilo->id, $carga->carrier_id);

            return $hilo;
        });
    }

    /**
     * Mete a un usuario en un hilo.
     *
     * Idempotente: `conversation_participants` tiene un único
     * `(conversation_id, user_id)`, así que volver a añadir a quien ya está
     * reventaría. Y quien se salió y vuelve NO es una fila nueva —el único no
     * lo permitiría— sino la misma con `left_at` a nulo otra vez.
     *
     * Deja rastro en la bitácora, y eso no es papeleo: la regla de visibilidad
     * dice que un hilo se ve solo desde dentro, incluido el administrador. La
     * única forma legítima de que la casa lea una conversación privada es
     * meterse en ella, y si eso no dejara rastro la regla no valdría nada —
     * bastaría entrar, leer y salirse.
     */
    public static function addParticipant(Actor $actor, string $conversationId, Actor|string $target, ?string $role = null): void
    {
        $userId = $target instanceof Actor ? $target->auditUserId() : $target;

        if ($userId === null) {
            return;
        }

        $rol = $role
            ?? ($target instanceof Actor ? $target->role?->value : null)
            ?? (string) DB::table('user_tenant_memberships')
                ->where('user_id', $userId)
                ->where('tenant_id', $actor->tenantId)
                ->whereNull('deleted_at')
                ->value('role');

        // El CHECK de `role` no admite cualquier cosa, y sin rol conocido no se
        // inventa uno.
        //
        // Y REVIENTA, no devuelve en silencio. Es la diferencia entre las dos
        // formas de fallar aquí, y solo una es aceptable: quien llama a esto
        // está CONCEDIENDO ACCESO a una conversación. Un retorno callado deja al
        // que llama creyendo que metió a alguien en el hilo cuando no lo hizo —
        // el despachador manda un mensaje al transportista, el transportista no
        // lo recibe nunca, y nadie se entera hasta que hay una reclamación.
        // Fallar a la cara lo pone en los registros el mismo día.
        if (! in_array($rol, ['platform_super_admin', 'admin', 'accounting', 'dispatcher', 'carrier', 'driver'], true)) {
            throw new \RuntimeException(
                'No se puede meter al usuario '.$userId.' en el hilo '.$conversationId.': no consta su rol en esta empresa.'
            );
        }

        $existente = DB::table('conversation_participants')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->first(['id', 'left_at', 'deleted_at']);

        if ($existente !== null) {
            // Ya está y sigue dentro: nada que hacer, y sobre todo ningún
            // evento de auditoría — repetir la llamada no es un acto nuevo.
            if ($existente->left_at === null && $existente->deleted_at === null) {
                return;
            }

            DB::table('conversation_participants')->where('id', $existente->id)->update([
                'left_at' => null,
                'deleted_at' => null,
                'deleted_by' => null,
                'deletion_reason' => null,
                'role' => $rol,
                'updated_at' => now(),
            ]);
        } else {
            DB::table('conversation_participants')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $actor->tenantId,
                'conversation_id' => $conversationId,
                'user_id' => $userId,
                'role' => $rol,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        Audit::record(
            actor: $actor,
            action: AuditAction::MessageParticipantAdded,
            entityType: 'conversation',
            entityId: $conversationId,
            after: ['userId' => $userId, 'role' => $rol],
        );
    }

    /** Saca a alguien del hilo. Conserva la fila: sus mensajes siguen teniendo autor. */
    public static function removeParticipant(Actor $actor, string $conversationId, string $userId): bool
    {
        $tocadas = DB::table('conversation_participants')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->whereNull('left_at')
            ->update(['left_at' => now(), 'updated_at' => now()]);

        if ($tocadas === 0) {
            return false;
        }

        Audit::record(
            actor: $actor,
            action: AuditAction::MessageParticipantRemoved,
            entityType: 'conversation',
            entityId: $conversationId,
            before: ['userId' => $userId],
        );

        return true;
    }

    /**
     * Mete en el hilo a los usuarios del transportista de la carga.
     *
     * Sin esto el hilo tendría un solo lado: despacho hablando solo. Es
     * literalmente el fallo que este módulo viene a arreglar, así que conviene
     * que sea la misma función la que crea el hilo y la que mete al otro lado.
     */
    private static function addCarrierUsers(Actor $actor, string $conversationId, ?string $carrierId): void
    {
        if ($carrierId === null) {
            return;
        }

        $usuarios = DB::table('user_tenant_memberships')
            ->where('tenant_id', $actor->tenantId)
            ->where('carrier_id', $carrierId)
            ->whereNull('deleted_at')
            ->get(['user_id', 'role']);

        foreach ($usuarios as $u) {
            self::addParticipant($actor, $conversationId, (string) $u->user_id, (string) $u->role);
        }
    }
}
