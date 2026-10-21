<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Platform\ScheduledRuns;
use App\Support\Webhooks\Deliveries;
use Illuminate\Console\Command;

/**
 * Entrega los webhooks pendientes.
 *
 *     php artisan webhooks:deliver
 *     php artisan webhooks:deliver --limit=50
 *
 * ## Por qué un barrido y no una cola
 *
 * Este proyecto no tiene cola: ni `app/Jobs`, ni un solo `ShouldQueue`, ni un
 * worker en Forge. Un webhook montado sobre una cola que nadie consume se
 * «dispara» y no llega nunca — que es justo el fallo que este lote existe para
 * no cometer. El planificador, en cambio, ya corre dos barridos en producción.
 *
 * ## Cada minuto, y con `withoutOverlapping`
 *
 * Un alta que llega a las 9:03 tiene que estar en el CRM del cliente a las
 * 9:04, no a la mañana siguiente. Es el único barrido de este proyecto que
 * corre tan seguido, y por eso es el único que reclama las filas antes de
 * salir: dos ejecuciones solapadas mandarían la misma entrega dos veces, y un
 * transportista duplicado en el CRM de alguien es un problema de verdad.
 *
 * ## Deja rastro aunque no haya trabajo
 *
 * `ScheduledRuns::wrap` anota la ejecución pase lo que pase. Sin esa fila,
 * «ninguna entrega» y «el cron no está puesto» se ven exactamente igual desde
 * la pantalla de ajustes — y son cosas muy distintas para quien está esperando
 * que su CRM se llene.
 */
final class DeliverWebhooks extends Command
{
    protected $signature = 'webhooks:deliver {--limit=25 : Cuántas entregas como mucho en esta pasada}';

    protected $description = 'Entrega los webhooks pendientes y reintenta los que fallaron, con espera creciente';

    public function handle(): int
    {
        return ScheduledRuns::wrap('webhooks:deliver', function (): array {
            $limite = max(1, (int) $this->option('limit'));

            $rescatadas = Deliveries::rescueStuck();
            $pendientes = Deliveries::claimDue($limite);

            $cuenta = ['delivered' => 0, 'pending' => 0, 'abandoned' => 0];

            foreach ($pendientes as $fila) {
                $estado = Deliveries::attempt($fila);
                $cuenta[$estado] = ($cuenta[$estado] ?? 0) + 1;
            }

            $resumen = [
                'claimed' => count($pendientes),
                'rescued' => $rescatadas,
                ...$cuenta,
            ];

            $this->info(sprintf(
                'Webhooks: %d reclamadas, %d entregadas, %d en espera, %d abandonadas%s',
                $resumen['claimed'],
                $cuenta['delivered'],
                $cuenta['pending'],
                $cuenta['abandoned'],
                $rescatadas > 0 ? sprintf(' (%d rescatadas de «enviando»)', $rescatadas) : '',
            ));

            return [self::SUCCESS, $resumen];
        });
    }
}
