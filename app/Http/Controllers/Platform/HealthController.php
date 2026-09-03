<?php

declare(strict_types=1);

namespace App\Http\Controllers\Platform;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Support\InertiaPage;
use App\Support\Platform\Expirations;
use App\Support\Platform\Providers;
use App\Support\Platform\ScheduledRuns;
use App\Support\Platform\ScheduledTasks;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

/**
 * La salud de la instalación: qué corre solo, qué está atado y qué está a medias.
 *
 * `platform/health` llevaba en el menú desde el primer lote sin existir. Este
 * lote la construye por un motivo concreto y no por completismo: **el
 * planificador de Forge sigue sin activar en producción**, y hasta ahora no
 * había forma de saberlo desde dentro del producto.
 *
 * Ese es el fallo que esta pantalla ataca de frente. Un cron muerto no produce
 * ningún error: produce SILENCIO, exactamente el mismo silencio que un día sin
 * documentos por caducar. `routes/console.php` lleva desde el lote de avisos con
 * un comentario que dice que sin esa línea el fichero no se ejecuta nunca «y no
 * lo dice nadie». Ahora lo dice alguien.
 *
 * TODO LO QUE ENSEÑA SE CALCULA AL ABRIRLA. Nada de banderas guardadas: los
 * proveedores se leen del contenedor, la base se le pregunta a la base, y las
 * ejecuciones salen de las filas que dejó cada tarea. Una pantalla de salud que
 * lee un estado escrito por otro sitio hereda la mentira de ese otro sitio.
 *
 * Es de PLATAFORMA, no de empresa: `platform:health:read` solo lo tiene el
 * super administrador, y las cifras cruzan todas las empresas.
 */
final class HealthController
{
    use InertiaPage;

    public function __invoke(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'platform:health:read', null, $current->policy());

        $this->usesDictionary($request, ['platform', 'nav', 'common']);

        return app(TenantContext::class)->withoutTenant(fn (): Response => Inertia::render('Platform/Health', [
            'scheduler' => [
                // La lista sale del PLANIFICADOR, no de una constante de aquí.
                // Era una copia a mano de `routes/console.php`: un
                // `Schedule::command()` nuevo corría en el servidor y no
                // aparecía en ninguna pantalla, así que si se le rompía el
                // cron nadie se enteraba.
                'tasks' => ScheduledRuns::summary(ScheduledTasks::all()),
                'cronLine' => '* * * * * cd /home/forge/goliathdispatch.com && php artisan schedule:run >> /dev/null 2>&1',
            ],
            'providers' => Providers::inventory(),
            'jobs' => $this->colaDeTrabajos(),
            'expirations' => $this->vencimientos(),
            'database' => $this->baseDeDatos(),
            'tenants' => DB::table('tenants')
                ->whereNull('deleted_at')
                ->selectRaw('status, count(*) as total')
                ->groupBy('status')
                ->pluck('total', 'status')
                ->all(),
        ]));
    }

    /**
     * La cola de trabajos, sin contar las ejecuciones programadas.
     *
     * Se excluyen las filas con el prefijo `schedule:` porque son otra cosa:
     * trabajo YA HECHO que se anota para dejar rastro, no trabajo pendiente.
     * Mezclarlas haría que «tareas correctas» creciera cada mañana y que el
     * número dejara de significar nada.
     *
     * @return array<string, mixed>
     */
    private function colaDeTrabajos(): array
    {
        $porEstado = DB::table('job_queue')
            ->where('job_type', 'not like', ScheduledRuns::PREFIJO.'%')
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status')
            ->all();

        $masAntigua = DB::table('job_queue')
            ->where('job_type', 'not like', ScheduledRuns::PREFIJO.'%')
            ->where('status', 'queued')
            ->min('run_at');

        return [
            'queued' => (int) ($porEstado['queued'] ?? 0),
            'running' => (int) ($porEstado['running'] ?? 0),
            'failed' => (int) ($porEstado['failed'] ?? 0),
            'deadLetter' => (int) ($porEstado['dead_letter'] ?? 0),
            'oldestQueuedAt' => $masAntigua === null ? null : substr((string) $masAntigua, 0, 16),
        ];
    }

    /**
     * Los vencimientos sin resolver, sumando todas las empresas.
     *
     * @return array<string, mixed>
     */
    private function vencimientos(): array
    {
        $total = ['warning' => 0, 'expired' => 0, 'oldestFirstDetectedAt' => null];

        foreach (DB::table('tenants')->whereNull('deleted_at')->pluck('id') as $tenantId) {
            $resumen = Expirations::summary((string) $tenantId);

            $total['warning'] += $resumen['warning'];
            $total['expired'] += $resumen['expired'];

            if ($resumen['oldestFirstDetectedAt'] !== null
                && ($total['oldestFirstDetectedAt'] === null
                    || $resumen['oldestFirstDetectedAt'] < $total['oldestFirstDetectedAt'])) {
                $total['oldestFirstDetectedAt'] = $resumen['oldestFirstDetectedAt'];
            }
        }

        return $total;
    }

    /** @return array<string, mixed> */
    private function baseDeDatos(): array
    {
        return [
            'name' => DB::connection()->getDatabaseName(),
            'version' => (string) (DB::selectOne('select version() as v')->v ?? ''),
        ];
    }
}
