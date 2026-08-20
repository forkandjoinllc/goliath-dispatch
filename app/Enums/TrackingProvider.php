<?php

namespace App\Enums;

enum TrackingProvider: string
{
    case Mock = 'mock';
    case TruckerTools = 'trucker_tools';
    case Macropoint = 'macropoint';
    case Highway = 'highway';
    case Manual = 'manual';
}
