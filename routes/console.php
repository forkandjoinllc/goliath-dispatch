<?php

declare(strict_types=1);

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
|--------------------------------------------------------------------------
| Lo que ocurre solo
|--------------------------------------------------------------------------
|
| Este fichero estuvo vacío hasta el lote de avisos, y eso quería decir que la
| aplicación no hacía NADA por su cuenta: un documento caducaba y nadie se
| enteraba, una factura cruzaba su vencimiento sin cambiar de estado, y el plazo
| de revalidación de FMCSA se guardaba en los ajustes sin revalidar a nadie.
|
| A las 06:00 y no a medianoche: el barrido escribe avisos que alguien va a leer
| esa mañana, y a las 06:00 la fecha ya es la de hoy en todos los husos de
| Estados Unidos continental. A medianoche UTC, en Los Ángeles todavía es ayer.
|
| `withoutOverlapping` porque el barrido recorre todas las empresas y puede
| tardar; dos ejecuciones solapadas no romperían nada —el índice único de
| `notifications` las deduplica— pero sí duplicarían el trabajo.
|
| Para que esto corra de verdad en el servidor hace falta UNA línea de cron, que
| Forge añade sola al marcar el planificador. Sin ella este fichero no se ejecuta
| nunca y no lo dice nadie:
|
|     * * * * * cd /home/forge/goliathdispatch.com && php artisan schedule:run >> /dev/null 2>&1
|
*/
Schedule::command('notifications:sweep')
    ->dailyAt('06:00')
    ->withoutOverlapping()
    ->onOneServer();
