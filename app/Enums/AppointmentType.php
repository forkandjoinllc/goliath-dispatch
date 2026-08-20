<?php

namespace App\Enums;

enum AppointmentType: string
{
    case Exact = 'exact';
    case Window = 'window';
    case Fcfs = 'fcfs';
    case Open = 'open';
}
