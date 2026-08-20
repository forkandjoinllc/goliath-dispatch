<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Enums\LoadStatus;

/**
 * El ciclo de vida de una carga: trece estados y qué puede pasar entre ellos.
 *
 * Vive aparte del controlador porque no es una regla de HTTP. El mismo grafo lo
 * necesitan el seguimiento por GPS —que adelanta la carga sola cuando el camión
 * entra en la geocerca del destino— y el trabajo que marca `invoiced` al emitir
 * la factura.
 *
 * El grafo es una CADENA, no una malla. Nadie salta de `assigned` a `delivered`
 * aunque tenga todos los permisos del mundo, porque cada paso deja una fila en
 * `load_status_history` con su hora, y esa cadena de horas es lo que responde
 * «¿cuándo llegó de verdad el camión?» cuando el cliente reclama una detención.
 * Un atajo convertiría el historial en un campo con el último valor.
 *
 * Las dos excepciones al camino recto están abajo y son deliberadas.
 */
final class Transitions
{
    /**
     * acción => [orígenes permitidos, permiso exigido]
     *
     * @var array<string, array{0: list<LoadStatus>, 1: string}>
     */
    private const GRAPH = [
        // Publicar: la carga deja de ser un borrador y se puede buscar
        // transportista. Exige paradas — ver Guards.
        'available' => [
            [LoadStatus::Draft, LoadStatus::Assigned],
            'load:status:update',
        ],
        // Se eligió transportista. Exige carrier_id — ver Guards.
        'assigned' => [
            [LoadStatus::Available],
            'load:assign_carrier',
        ],
        // Despachar: el camión tiene orden de salir. Es la puerta de
        // cumplimiento más importante del sistema — ver Guards::forDispatch().
        'dispatched' => [
            [LoadStatus::Assigned],
            'load:status:update',
        ],
        'en_route_to_pickup' => [[LoadStatus::Dispatched], 'load:status:update'],
        'at_pickup' => [[LoadStatus::EnRouteToPickup], 'load:status:update'],
        'in_transit' => [[LoadStatus::AtPickup], 'load:status:update'],
        'at_delivery' => [[LoadStatus::InTransit], 'load:status:update'],
        'delivered' => [[LoadStatus::AtDelivery], 'load:status:update'],
        // El comprobante de entrega firmado. Sin él no se factura.
        'pod_received' => [[LoadStatus::Delivered], 'load:status:update'],
        // Facturar no es un cambio de estado a mano: lo hace el dominio de
        // finanzas al emitir la factura. Se declara aquí para que el grafo esté
        // completo y para que la pantalla enseñe el paso, pero exige el permiso
        // de facturación, que un despachador no tiene.
        'invoiced' => [[LoadStatus::PodReceived], 'invoice:create'],
        'paid' => [[LoadStatus::Invoiced], 'payment:record'],
    ];

    /**
     * Cancelar es la primera excepción: se puede desde casi cualquier sitio.
     *
     * Un cliente que anula a las tres de la mañana no consulta en qué estado
     * tenemos su carga. Lo único que no se cancela es lo ya pagado —eso es un
     * abono, que es otra cosa y vive en finanzas— y lo ya cancelado.
     */
    private const CANCELLABLE_EXCEPT = [LoadStatus::Paid, LoadStatus::Cancelled];

    /**
     * Segunda excepción: de `assigned` se puede VOLVER a `available`.
     *
     * Es el caso más común de todos y el que más se olvida al modelar esto: el
     * transportista se cae a última hora. La carga sigue existiendo, el cliente
     * sigue esperando, y hay que buscar otro. Sin esta arista habría que
     * cancelarla y duplicarla, perdiendo el historial justo cuando más falta
     * hace para explicarle al cliente por qué llegó tarde.
     */
    public static function target(string $action): ?LoadStatus
    {
        if ($action === 'cancelled') {
            return LoadStatus::Cancelled;
        }

        return LoadStatus::tryFrom($action);
    }

    public static function permission(string $action): ?string
    {
        if ($action === 'cancelled') {
            return 'load:cancel';
        }

        return self::GRAPH[$action][1] ?? null;
    }

    public static function allowedFrom(string $action, LoadStatus $current): bool
    {
        if ($action === 'cancelled') {
            return ! in_array($current, self::CANCELLABLE_EXCEPT, true);
        }

        return in_array($current, self::GRAPH[$action][0] ?? [], true);
    }

    /**
     * Las acciones legales desde el estado actual, en orden de grafo.
     *
     * @return list<string>
     */
    public static function availableFrom(LoadStatus $current): array
    {
        $actions = [];

        foreach (array_keys(self::GRAPH) as $action) {
            if (self::allowedFrom($action, $current)) {
                $actions[] = $action;
            }
        }

        if (self::allowedFrom('cancelled', $current)) {
            $actions[] = 'cancelled';
        }

        return $actions;
    }

    /** Cancelar exige motivo escrito. Es lo único que perjudica a alguien. */
    public static function requiresReason(string $action): bool
    {
        return $action === 'cancelled';
    }

    /** El siguiente paso del camino recto, para el botón principal. */
    public static function nextInChain(LoadStatus $current): ?string
    {
        foreach (array_keys(self::GRAPH) as $action) {
            if (self::allowedFrom($action, $current) && $action !== 'available') {
                return $action;
            }
        }

        // Desde `assigned`, «volver a disponible» es legal pero no es el camino
        // recto: el botón principal debe ser «despachar».
        return null;
    }
}
