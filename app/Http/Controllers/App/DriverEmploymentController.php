<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\AuditAction;
use App\Models\Driver;
use App\Support\Audit;
use App\Support\Drivers\DriverScope;
use App\Support\Drivers\Employment;
use App\Support\Fleet\StandingAssignment;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Parar a un conductor, darle de baja, o volver a ponerlo a trabajar.
 *
 * ## Las tres cosas que pasan además de cambiar una palabra
 *
 * **Se le retira de las cargas VIVAS.** Ni en espera ni de baja se conduce. Sin
 * esto, la carga seguiría diciendo que tiene conductor mientras el conductor no
 * puede salir, y quien lo descubriría sería el cliente preguntando por qué no
 * ha llegado su entrega. De las cargas ya entregadas no se le quita: eso
 * reescribiría el historial de quién las llevó. Misma regla que sacar una
 * unidad de servicio.
 *
 * **La baja suelta su equipo.** Un camión asignado a alguien que ya no trabaja
 * aquí no se le puede dar a nadie —la regla de «un camión, un conductor» lo
 * impide— y la flota se queda con un camión fantasma. La asignación se TERMINA,
 * no se borra: una carga de marzo se mira con el camión que se llevó en marzo.
 *
 * **En espera NO suelta el equipo**, y es a propósito: es temporal, y el camión
 * sigue siendo el suyo mientras se resuelve lo que sea.
 *
 * ## La nota, siempre
 *
 * Al parar, al dar de baja y al volver a activar. Un cambio de estado sin
 * motivo escrito es una fila que dentro de un año nadie sabe explicar, y estas
 * tres son justo las que alguien va a tener que explicar — a un seguro, a un
 * abogado, o al propio conductor.
 *
 * ## Y la recontratación se decide EN EL MOMENTO
 *
 * Quien firma la baja es quien sabe si se le volvería a contratar. Preguntarlo
 * dos años después, cuando vuelva a presentarse, es preguntárselo a alguien que
 * no estaba.
 */
final class DriverEmploymentController
{
    /** Una nota de dos palabras no es un motivo. */
    private const MINIMO = 5;

    public function __invoke(Request $request, string $driver, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();

        $modelo = Driver::query()
            ->where('tenant_id', $actor->tenantId)
            ->whereKey($driver)
            ->firstOrFail();

        $checker->authorize($actor, 'driver:update', DriverScope::contexto($modelo), $current->policy());

        $datos = $request->validate([
            'status' => ['required', Rule::in(Employment::POR_LA_PUERTA_DE_EMPLEO)],
            'note' => ['required', 'string', 'max:2000'],
            'rehire_eligible' => ['nullable', 'boolean'],
        ]);

        $nota = trim((string) $datos['note']);

        if (mb_strlen($nota) < self::MINIMO) {
            throw ValidationException::withMessages(['note' => __('drivers.employment.noteRequired')]);
        }

        $esBaja = Employment::esBaja($datos['status']);

        // Con la baja hay que ELEGIR. Sin esto, `nullable` dejaría pasar la
        // petición sin la decisión, y la ficha diría «no consta» — que es lo
        // que este campo existe para que no pase.
        if ($esBaja && $request->input('rehire_eligible') === null) {
            throw ValidationException::withMessages([
                'rehire_eligible' => __('drivers.employment.rehireRequired'),
            ]);
        }

        $antes = $modelo->status?->value;

        $retiradas = DB::transaction(function () use ($modelo, $datos, $nota, $esBaja, $actor): int {
            $modelo->status = $datos['status'];
            $modelo->status_note = $nota;
            $modelo->status_changed_at = now();
            $modelo->status_changed_by_user_id = $actor->userId;
            // Solo significa algo con la baja puesta. Volver a activar lo
            // borra: un «no volver a contratar» colgando de alguien que está
            // trabajando aquí es una contradicción que alguien leerá como dato.
            $modelo->rehire_eligible = $esBaja ? (bool) $datos['rehire_eligible'] : null;
            $modelo->save();

            if ($esBaja) {
                StandingAssignment::terminarVigentes((string) $modelo->tenant_id, (string) $modelo->id);
            }

            if (! Employment::bloquea($datos['status'])) {
                return 0;
            }

            return DB::table('load_assignments')
                ->where('driver_id', $modelo->id)
                ->whereNull('unassigned_at')
                ->whereNull('deleted_at')
                ->whereIn('load_id', function ($q): void {
                    $q->select('id')->from('loads')
                        ->whereNotIn('status', ['delivered', 'pod_received', 'invoiced', 'paid', 'cancelled'])
                        ->whereNull('deleted_at');
                })
                ->update([
                    'unassigned_at' => now(),
                    'unassigned_reason' => __('drivers.employment.releasedBecause', ['reason' => $nota]),
                    'updated_at' => now(),
                ]);
        });

        Audit::record(
            $actor,
            AuditAction::DriverEmploymentChanged,
            'driver',
            (string) $modelo->id,
            entityLabel: trim((string) $modelo->first_name.' '.(string) $modelo->last_name),
            before: ['status' => $antes],
            after: [
                'status' => $datos['status'],
                'rehire_eligible' => $esBaja ? (bool) $datos['rehire_eligible'] : null,
                'note' => $nota,
            ],
        );

        $nombre = trim((string) $modelo->first_name.' '.(string) $modelo->last_name);

        return back()->with('success', $retiradas > 0
            ? __('drivers.employment.doneAndReleased', ['name' => $nombre, 'count' => (string) $retiradas])
            : __('drivers.employment.done', ['name' => $nombre]));
    }
}
