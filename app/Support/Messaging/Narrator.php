<?php

declare(strict_types=1);

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Support\Messaging\Posting;
use Illuminate\Support\Facades\DB;

/**
 * Cuenta en el hilo de una carga lo que le pasa a la carga.
 *
 * Un hilo de carga en el que solo aparece lo que la gente teclea cuenta media
 * historia. «Voy con dos horas de retraso» seguido de nada, y quince días
 * después nadie sabe si la carga llegó. Estos mensajes ponen los hechos entre
 * las frases: cuándo se despachó, cuándo se entregó, cuándo llegó el
 * comprobante.
 *
 * NO CREA HILOS. Y esto es deliberado, no una limitación.
 *
 * Si narrar creara el hilo, cada cambio de estado de cada carga abriría una
 * conversación — y una empresa con seiscientas cargas al mes tendría una bandeja
 * con seiscientos hilos que nadie ha abierto nunca, donde los cinco que
 * importan quedan enterrados. El hilo lo abre una persona cuando tiene algo que
 * decir; a partir de ahí, y solo a partir de ahí, los hechos se van anotando
 * solos.
 *
 * También significa que narrar no puede fallar de forma que rompa un cambio de
 * estado: sin hilo no hace nada. Un cambio de estado de carga no puede quedarse
 * sin hacer porque la mensajería tuviera un mal día.
 */
final class Narrator
{
    /**
     * El cambio de estado de una carga, si esa carga tiene hilo.
     *
     * @param  array<string, string|int>  $extra
     */
    public static function loadStatusChanged(
        string $tenantId,
        string $loadId,
        string $fromStatus,
        string $toStatus,
        array $extra = [],
    ): void {
        $hiloId = self::threadFor($loadId);

        if ($hiloId === null) {
            return;
        }

        Posting::narrate(
            tenantId: $tenantId,
            conversationId: $hiloId,
            systemKey: 'loadStatusChanged',
            // Las CLAVES de los estados, no sus etiquetas. La pantalla las
            // traduce al idioma de quien lee — que es todo el sentido de
            // guardar clave y parámetros en vez de una frase ya redactada.
            params: ['from' => $fromStatus, 'to' => $toStatus] + $extra,
        );
    }

    /** El hilo de esta carga, o nulo si nadie lo ha abierto. */
    private static function threadFor(string $loadId): ?string
    {
        $id = Conversation::query()
            ->where('load_id', $loadId)
            ->where('kind', 'load')
            ->value('id');

        return $id === null ? null : (string) $id;
    }
}
