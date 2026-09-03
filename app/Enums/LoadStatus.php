<?php

namespace App\Enums;

enum LoadStatus: string
{
    case Draft = 'draft';
    case Available = 'available';
    case Assigned = 'assigned';
    case Dispatched = 'dispatched';
    case EnRouteToPickup = 'en_route_to_pickup';
    case AtPickup = 'at_pickup';
    case InTransit = 'in_transit';
    case AtDelivery = 'at_delivery';
    case Delivered = 'delivered';
    case PodReceived = 'pod_received';
    case Invoiced = 'invoiced';
    case Paid = 'paid';
    case Cancelled = 'cancelled';

    /**
     * Los estados de una carga que YA SE ENTREGÓ, pase lo que pase después.
     *
     * Existe porque media aplicación preguntaba «¿está entregada?» comparando
     * contra el literal `'delivered'`, y `delivered` es solo el PRIMERO de
     * cuatro estados en los que la carga está entregada. Mientras nada movía
     * una carga más allá de ahí el atajo funcionaba; en cuanto facturar la
     * mueve solo, cada una de esas consultas empieza a perder cargas de vista.
     *
     * Se nota antes en las liquidaciones: al transportista se le paga por haber
     * llevado la carga, y que nosotros le hayamos facturado —o cobrado— nuestra
     * comisión no tiene nada que ver. Una carga cobrada que desapareciera de la
     * pantalla de liquidar sería dinero que se le debe a alguien y ya no se ve.
     *
     * @return list<string>
     */
    public static function delivered(): array
    {
        return [
            self::Delivered->value,
            self::PodReceived->value,
            self::Invoiced->value,
            self::Paid->value,
        ];
    }
}
