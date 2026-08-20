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
}
