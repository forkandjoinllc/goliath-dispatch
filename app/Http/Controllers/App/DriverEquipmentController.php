<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Models\Driver;
use App\Support\Drivers\DriverScope;
use App\Support\Fleet\StandingAssignment;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * El equipo habitual de un conductor: su camión y su remolque.
 *
 * ## Qué decide, y qué no
 *
 * Decide con qué anda normalmente. **No decide qué se despacha**: eso sigue en
 * `load_assignments`, y lo de aquí solo lo prerrellena. El camión de siempre
 * está en el taller y hoy va otro — la carga guarda el que fue.
 *
 * ## El permiso
 *
 * `driver:update`, el mismo que editar su ficha, porque esto es parte de su
 * ficha: con qué anda. No se inventa un permiso nuevo para una pregunta que el
 * catálogo ya contesta.
 */
final class DriverEquipmentController
{
    public function store(Request $request, string $driver, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();

        $modelo = $this->conductor($actor, $driver);

        $checker->authorize($actor, 'driver:update', DriverScope::contexto($modelo), $current->policy());

        [$datos, $inicio, $fin] = $this->comprobado($request, $actor);

        $choques = StandingAssignment::crear(
            (string) $actor->tenantId,
            (string) $modelo->id,
            (string) $datos['truck_id'],
            $datos['trailer_id'] ?? null,
            $inicio,
            $fin,
            $actor->userId,
            $datos['notes'] ?? null,
        );

        if ($choques !== []) {
            throw ValidationException::withMessages([
                // El primero que toque: el mensaje nombra el conflicto que hay
                // que resolver, y resolverlo destapa el siguiente si lo hay.
                'truck_id' => __('drivers.standing.'.$choques[0]),
            ]);
        }

        return back()->with('success', __('drivers.standing.saved'));
    }

    /**
     * Cambiar una asignación que ya existe.
     *
     * Corregir un dato no es un cambio de equipo: quien se equivocó de
     * remolque tenía que terminar la asignación y crear otra, y la ficha
     * quedaba con dos tramos donde solo hubo uno.
     */
    public function update(Request $request, string $driver, string $assignment, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $modelo = $this->conductor($actor, $driver);

        $checker->authorize($actor, 'driver:update', DriverScope::contexto($modelo), $current->policy());

        [$datos, $inicio, $fin] = $this->comprobado($request, $actor);

        $choques = StandingAssignment::actualizar(
            (string) $actor->tenantId,
            (string) $modelo->id,
            $assignment,
            (string) $datos['truck_id'],
            $datos['trailer_id'] ?? null,
            $inicio,
            $fin,
            $datos['notes'] ?? null,
        );

        // Nada: esa fila no es de este conductor de esta empresa. 404 y no
        // 403, igual que en proveedores: decir «no puedes» sobre algo que no
        // es tuyo confirma que existe.
        abort_if($choques === null, 404);

        if ($choques !== []) {
            throw ValidationException::withMessages([
                'truck_id' => __('drivers.standing.'.$choques[0]),
            ]);
        }

        return back()->with('success', __('drivers.standing.updated'));
    }

    /**
     * Terminar una asignación en vigor.
     *
     * Terminar y no borrar: una carga de marzo se mira con el camión que se
     * llevó en marzo, y borrar la fila dejaría esa carga sin explicación.
     *
     * El aviso no dice «terminada» a secas: casi siempre el camión queda
     * libre ya, pero una asignación que empezó hoy no puede terminar antes de
     * empezar y dura el día. Las dos cosas son ciertas y no son la misma, así
     * que la pantalla dice cuál de las dos ha pasado.
     *
     * Y lo dice con palabras, no con una fecha: esta capa no sabe escribir un
     * día en el idioma de quien mira —`formatDay` vive en la pantalla— y una
     * fecha en bruto dentro de una frase traducida se lee como un error.
     */
    public function end(Request $request, string $driver, string $assignment, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $modelo = $this->conductor($actor, $driver);

        $checker->authorize($actor, 'driver:update', DriverScope::contexto($modelo), $current->policy());

        $ultimo = StandingAssignment::terminar((string) $actor->tenantId, (string) $modelo->id, $assignment);

        abort_if($ultimo === null, 404);

        return back()->with('success', __(
            $ultimo < CarbonImmutable::now()->toDateString()
                ? 'drivers.standing.ended'
                : 'drivers.standing.endedToday',
        ));
    }

    /**
     * Cancelar una asignación que todavía no ha empezado.
     *
     * No hay nada que conservar: nadie condujo ese camión ese día porque ese
     * día no ha llegado.
     */
    public function cancel(Request $request, string $driver, string $assignment, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $modelo = $this->conductor($actor, $driver);

        $checker->authorize($actor, 'driver:update', DriverScope::contexto($modelo), $current->policy());

        abort_unless(
            StandingAssignment::cancelar((string) $actor->tenantId, (string) $modelo->id, $assignment),
            404,
        );

        return back()->with('success', __('drivers.standing.cancelled'));
    }

    private function conductor(Actor $actor, string $driver): Driver
    {
        return Driver::query()
            ->where('tenant_id', $actor->tenantId)
            ->whereKey($driver)
            ->firstOrFail();
    }

    /**
     * Lo que llega del formulario, comprobado, con las fechas ya en formato de día.
     *
     * Las unidades tienen que ser de esta empresa. Que el desplegable solo
     * ofrezca las suyas no basta: una petición a mano llevaría cualquier
     * identificador.
     *
     * @return array{0: array<string, mixed>, 1: string, 2: string|null}
     */
    private function comprobado(Request $request, Actor $actor): array
    {
        $datos = $request->validate([
            'truck_id' => ['required', 'string', 'size:36'],
            'trailer_id' => ['nullable', 'string', 'size:36'],
            'starts_on' => ['required', 'date'],
            'ends_on' => ['nullable', 'date', 'after_or_equal:starts_on'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

        $this->exigeDeLaEmpresa('trucks', (string) $actor->tenantId, (string) $datos['truck_id'], 'truck_id');

        if (($datos['trailer_id'] ?? null) !== null) {
            $this->exigeDeLaEmpresa('trailers', (string) $actor->tenantId, (string) $datos['trailer_id'], 'trailer_id');
        }

        return [
            $datos,
            CarbonImmutable::parse((string) $datos['starts_on'])->toDateString(),
            ($datos['ends_on'] ?? null) === null
                ? null
                : CarbonImmutable::parse((string) $datos['ends_on'])->toDateString(),
        ];
    }

    private function exigeDeLaEmpresa(string $tabla, string $tenantId, string $id, string $campo): void
    {
        $existe = DB::table($tabla)
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->whereNull('deleted_at')
            ->exists();

        if (! $existe) {
            throw ValidationException::withMessages([
                $campo => __('drivers.standing.notYours'),
            ]);
        }
    }
}
