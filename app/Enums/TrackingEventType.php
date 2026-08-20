<?php

namespace App\Enums;

enum TrackingEventType: string
{
    case SessionStarted = 'session_started';
    case ConsentGranted = 'consent_granted';
    case ConsentRevoked = 'consent_revoked';
    case LocationUpdate = 'location_update';
    case GeofenceEnter = 'geofence_enter';
    case GeofenceExit = 'geofence_exit';
    case ArrivedPickup = 'arrived_pickup';
    case DepartedPickup = 'departed_pickup';
    case ArrivedDelivery = 'arrived_delivery';
    case DepartedDelivery = 'departed_delivery';
    case Stopped = 'stopped';
    case SessionEnded = 'session_ended';
    case Error = 'error';
}
