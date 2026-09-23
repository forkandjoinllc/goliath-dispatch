<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Models\Driver;
use App\Support\Drivers\DriverScope;
use App\Support\Fleet\StandingAssignment;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
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

        $modelo = Driver::query()
            ->where('tenant_id', $actor->tenantId)
            ->whereKey($driver)
            ->firstOrFail();

        $checker->authorize(
            $actor,
            'driver:update',
            DriverScope::contexto($modelo),
            $current->policy(),
        );

        $datos = $request->validate([
            'truck_id' => ['required', 'string', 'size:36'],
            'trailer_id' => ['nullable', 'string', 'size:36'],
            'starts_on' => ['required', 'date'],
            'ends_on' => ['nullable', 'date', 'after_or_equal:starts_on'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

        $inicio = CarbonImmutable::parse((string) $datos['starts_on'])->toDateString();
        $fin = ($datos['ends_on'] ?? null) === null
            ? null
            : CarbonImmutable::parse((string) $datos['ends_on'])->toDateString();

        // El camión y el remolque tienen que ser de esta empresa. Que el
        // desplegable solo ofrezca los suyos no basta: una petición a mano
        // llevaría cualquier identificador.
        $this->exigeDeLaEmpresa('trucks', (string) $actor->tenantId, (string) $datos['truck_id'], 'truck_id');

        if (($datos['trailer_id'] ?? null) !== null) {
            $this->exigeDeLaEmpresa('trailers', (string) $actor->tenantId, (string) $datos['trailer_id'], 'trailer_id');
        }

        $choques = StandingAssignment::choques(
            (string) $actor->tenantId,
            (string) $modelo->id,
            (string) $datos['truck_id'],
            $inicio,
            $fin,
        );

        if ($choques !== []) {
            throw ValidationException::withMessages([
                // El primero que toque: el mensaje nombra el conflicto que hay
                // que resolver, y resolverlo destapa el siguiente si lo hay.
                'truck_id' => __('drivers.standing.'.$choques[0]),
            ]);
        }

        DB::table('driver_equipment_assignments')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => (string) $actor->tenantId,
            'driver_id' => (string) $modelo->id,
            'truck_id' => (string) $datos['truck_id'],
            'trailer_id' => $datos['trailer_id'] ?? null,
            'starts_on' => $inicio,
            'ends_on' => $fin,
            'assigned_by_user_id' => $actor->userId,
            'notes' => $datos['notes'] ?? null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return back()->with('success', __('drivers.standing.saved'));
    }

    /**
     * Terminar la asignación vigente, hoy.
     *
     * Terminar y no borrar: una carga de marzo se mira con el camión que se
     * llevó en marzo, y borrar la fila dejaría esa carga sin explicación.
     */
    public function end(Request $request, string $driver, string $assignment, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();

        $modelo = Driver::query()
            ->where('tenant_id', $actor->tenantId)
            ->whereKey($driver)
            ->firstOrFail();

        $checker->authorize(
            $actor,
            'driver:update',
            DriverScope::contexto($modelo),
            $current->policy(),
        );

        $fila = DB::table('driver_equipment_assignments')
            ->where('tenant_id', $actor->tenantId)
            ->where('driver_id', $modelo->id)
            ->where('id', $assignment)
            ->whereNull('deleted_at')
            ->first(['id', 'starts_on']);

        abort_if($fila === null, 404);

        // Una asignación que empieza mañana no se puede terminar ayer: la
        // restricción de la base lo rechaza, y decirlo aquí es más útil que un
        // error de SQL.
        $hoy = CarbonImmutable::now()->toDateString();
        $inicio = substr((string) $fila->starts_on, 0, 10);

        DB::table('driver_equipment_assignments')
            ->where('id', $fila->id)
            ->update([
                'ends_on' => max($hoy, $inicio),
                'updated_at' => now(),
            ]);

        return back()->with('success', __('drivers.standing.ended'));
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
