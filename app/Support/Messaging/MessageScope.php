<?php

declare(strict_types=1);

namespace App\Support\Messaging;

use App\Authorization\Actor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Models\Conversation;
use App\Models\Load;
use App\Support\Loads\LoadScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Quién ve qué hilo.
 *
 * Esta clase toma una decisión de producto que conviene dejar escrita, porque
 * es la única de todo el sistema donde el alcance de un rol NO basta:
 *
 *   **Un hilo se ve si estás dentro de él. También si eres administrador.**
 *
 * En el resto del sistema el alcance manda: quien tiene `Scope::Tenant` sobre
 * las cargas ve todas las cargas de su empresa, y eso está bien — una carga es
 * un hecho de la empresa. Una conversación no. Si `message:read` con alcance de
 * empresa dejara leer cualquier hilo, entonces «hablar en privado con
 * contabilidad» no existiría en este producto, y la gente se iría a WhatsApp
 * —que es exactamente lo que este módulo viene a evitar—. Un sistema que
 * promete un canal y lo deja abierto es peor que no tener canal.
 *
 * Así que la pertenencia (`conversation_participants`) es la condición
 * necesaria, para todos.
 *
 * Y ADEMÁS el alcance, encima. No es redundante: son dos preguntas distintas.
 *
 *  - La pertenencia contesta «¿me metieron en este hilo?».
 *  - El alcance contesta «¿me PODÍAN meter?».
 *
 * Sin lo segundo, una fila mal escrita en `conversation_participants` —un fallo
 * al añadir gente, un hilo creado desde la carga equivocada— le enseñaría a un
 * transportista la conversación de otro. Y la fila que sobra es justo la que
 * nadie mira. Con las dos, hace falta equivocarse dos veces.
 *
 * La cuenta de la casa —`Scope::Tenant` y `Scope::Platform`— no queda sin
 * salida: puede AÑADIRSE a un hilo, y eso deja rastro en la bitácora. Mirar sin
 * dejar rastro es lo que no puede.
 */
final class MessageScope
{
    /**
     * Estrecha una consulta de hilos a los que este actor puede ver.
     *
     * @param  Builder<Conversation>  $query
     * @return Builder<Conversation>
     */
    public static function apply(Builder $query, PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        if ($actor->tenantId !== null) {
            $query->where('conversations.tenant_id', $actor->tenantId);
        }

        // Sin usuario no hay pertenencia posible. Cero filas, no todas.
        if ($actor->userId === null) {
            return $query->whereRaw('1 = 0');
        }

        $query->whereExists(function ($sub) use ($actor): void {
            $sub->selectRaw('1')
                ->from('conversation_participants as p')
                ->whereColumn('p.conversation_id', 'conversations.id')
                ->where('p.user_id', $actor->userId)
                // Quien se sale de un hilo deja de verlo, pero el hilo conserva
                // que estuvo: `left_at` en vez de borrar la fila. Borrarla haría
                // que un mensaje suyo apareciera sin remitente conocido.
                ->whereNull('p.left_at')
                ->whereNull('p.deleted_at');
        });

        return self::withinScope($query, $checker, $actor, $scope);
    }

    /**
     * La segunda mitad: el alcance, encima de la pertenencia.
     *
     * LA CARGA SE PREGUNTA CON `LoadScope`, no con una consulta propia.
     *
     * La primera versión de esto miraba `conversations.carrier_id` y los
     * transportistas asignados, y nada más. Parecía bastar y no bastaba: un
     * despachador alcanza una carga por DOS caminos —el transportista que lleva,
     * o ser él mismo el `dispatcher_user_id` de esa carga— y `ScopeFilter` los
     * une con un OR. Mirando solo el primero, un despachador que abría el hilo
     * de SU PROPIA carga recibía un 404 en el hilo que acababa de crear.
     *
     * No lo vio ninguna de las nueve pruebas de alcance, y por un motivo que ya
     * está tres veces en docs/testing.md: el escenario de pruebas asigna el
     * despachador al transportista, así que el primer camino siempre cubría el
     * segundo. Lo encontró abrir el navegador con los datos de demostración,
     * donde el despachador no lleva ningún transportista.
     *
     * La regla general, que este proyecto lleva reaprendiendo desde el lote 44:
     * **cuando dos sitios contestan la misma pregunta, uno de los dos se
     * equivoca.** Aquí la pregunta es «¿alcanzo esta carga?» y ya tenía dueño.
     *
     * @param  Builder<Conversation>  $query
     * @return Builder<Conversation>
     */
    private static function withinScope(Builder $query, PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        // La casa puede estar en cualquier hilo de su empresa. El WHERE de
        // tenant_id de más arriba ya es el techo.
        if (in_array($scope, [Scope::Platform, Scope::Tenant], true)) {
            return $query;
        }

        $carrierIds = match ($scope) {
            Scope::Carrier => array_values(array_filter([$actor->carrierId])),
            Scope::Assigned => $actor->assignments->carrierIds,
            default => [],
        };

        return $query->where(function (Builder $q) use ($checker, $actor, $scope, $carrierIds): void {
            // El hilo dice de qué transportista es.
            if ($carrierIds !== []) {
                $q->orWhereIn('conversations.carrier_id', $carrierIds);
            }

            // O cuelga de una carga que alcanzo. `carrier_id` puede estar vacío
            // en un hilo abierto antes de asignar transportista, y entonces la
            // carga es lo único que lo sitúa.
            $q->orWhereIn('conversations.load_id', LoadScope::apply(
                Load::query(),
                $checker,
                $actor,
                $scope,
            )->select('loads.id')->getQuery());

            // Un hilo sin carga y sin transportista —un directo entre dos
            // personas— no lo sitúa nada, y ahí la pertenencia es todo el
            // alcance que hay. Es correcto: para estar dentro alguien tuvo que
            // meterte, y eso quedó anotado en la bitácora.
            $q->orWhere(function (Builder $inner): void {
                $inner->whereNull('conversations.load_id')
                    ->whereNull('conversations.carrier_id');
            });
        });
    }

    /**
     * ¿Puede este actor escribir en este hilo?
     *
     * Leer y escribir se preguntan por separado porque no son lo mismo: quien se
     * ha salido del hilo o lo tiene archivado sigue viendo lo dicho, y no puede
     * añadir nada nuevo. Aquí, de momento, la respuesta es la misma que la de
     * leer más el permiso de enviar — pero tener la pregunta separada evita que
     * el día que se separen haya que buscar todos los sitios.
     */
    public static function canPost(PermissionChecker $checker, Actor $actor, Scope $scope, string $conversationId): bool
    {
        return self::apply(Conversation::query(), $checker, $actor, $scope)
            ->where('conversations.id', $conversationId)
            ->exists();
    }

    /**
     * Los ids de usuario que participan de verdad en un hilo.
     *
     * @return list<string>
     */
    public static function participantIds(string $conversationId): array
    {
        return DB::table('conversation_participants')
            ->where('conversation_id', $conversationId)
            ->whereNull('left_at')
            ->whereNull('deleted_at')
            ->pluck('user_id')
            ->map(static fn ($id): string => (string) $id)
            ->all();
    }
}
