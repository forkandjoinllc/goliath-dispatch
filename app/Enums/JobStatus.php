<?php

namespace App\Enums;

enum JobStatus: string
{
    case Queued = 'queued';
    case Running = 'running';
    case Succeeded = 'succeeded';
    case Failed = 'failed';
    case DeadLetter = 'dead_letter';
    case Cancelled = 'cancelled';
}
