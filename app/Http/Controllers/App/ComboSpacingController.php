<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Support\Equipment\AxleSpacings;
use App\Support\Equipment\ComboSpacing;
use App\Support\Equipment\Measure;
use App\Support\InertiaPage;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Los conjuntos: qué mide un camión CON un remolque.
 *
 * ## Por qué esta pantalla existe aparte de las fichas
 *
 * Porque la medida que pide una oficina de permisos no está en ninguna de las
 * dos fichas. La ficha del camión sabe sus huecos y la del remolque los suyos;
 * el tramo de en medio —de la última tracción al primer eje del remolque— es
 * de la pareja, y cambia al cambiar cualquiera de las dos unidades. Ver
 * `Support\Equipment\ComboSpacing`.
 *
 * ## De dónde salen las parejas
 *
 * De dos sitios, y se juntan: las que ya tienen medida tomada, y las que
 * alguien conduce de verdad —`driver_equipment_assignments`, la asignación
 * habitual—. Las segundas salen aunque nadie las haya medido, marcadas como
 * lo que son: pendientes. Una lista que solo enseñara lo medido no diría nunca
 * lo que falta, y lo que falta es justo lo que se descubre en la báscula.
 *
 * ## El permiso
 *
 * `equipment:read` para mirar y `equipment:update` para escribir: los mismos
 * que la ficha de la unidad, porque esto es una medida de la unidad tomada con
 * otra al lado. No se inventa un permiso nuevo para una pregunta que el
 * catálogo ya contesta.
 */
final class ComboSpacingController
{
    use InertiaPage;

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'equipment:read', null, $policy);

        $this->usesDictionary($request, ['equipment', 'nav', 'common', 'validation']);

        $puedeEditar = $checker->can($actor, 'equipment:update', null, $policy)->allowed;

        $camiones = $this->camionesAlcanzables($checker, $actor, $scope);

        return Inertia::render('App/Equipment/Combos', [
            'combos' => $this->conjuntos($actor, $camiones),
            // El alcance, para que el panel de vacío diga que la lista está
            // ACOTADA en vez de decir que la empresa no tiene ninguno.
            'scope' => $scope->value,
            // La flota solo viaja si quien mira puede cambiar algo: una lista
            // entera de camiones y remolques en una pantalla de solo lectura
            // es un dato que nadie pidió.
            'choices' => $puedeEditar ? $this->paraElegir($actor, $camiones) : null,
            'can' => ['update' => $puedeEditar],
        ]);
    }

    public function store(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'equipment:update', null, $policy);

        $datos = $request->validate([
            'truck_id' => ['required', 'string', 'size:36'],
            'trailer_id' => ['required', 'string', 'size:36'],
            'drive_to_trailer' => ['required', 'array'],
            'drive_to_trailer.feet' => ['nullable', 'integer', 'min:0', 'max:200'],
            'drive_to_trailer.inches' => ['nullable', 'integer', 'min:0', 'max:11'],
            'bumper_to_bumper' => ['nullable', 'array'],
            'bumper_to_bumper.feet' => ['nullable', 'integer', 'min:0', 'max:200'],
            'bumper_to_bumper.inches' => ['nullable', 'integer', 'min:0', 'max:11'],
            'kingpin_to_rear' => ['nullable', 'array'],
            'kingpin_to_rear.feet' => ['nullable', 'integer', 'min:0', 'max:200'],
            'kingpin_to_rear.inches' => ['nullable', 'integer', 'min:0', 'max:11'],
            'kingpin_to_trailer_axles' => ['nullable', 'array'],
            'kingpin_to_trailer_axles.feet' => ['nullable', 'integer', 'min:0', 'max:200'],
            'kingpin_to_trailer_axles.inches' => ['nullable', 'integer', 'min:0', 'max:11'],
            'measured_on' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

        // Las dos unidades tienen que ser de esta empresa Y estar al alcance
        // de quien escribe. Que el desplegable solo ofrezca las suyas no
        // basta: una petición a mano llevaría cualquier identificador.
        $camiones = $this->camionesAlcanzables($checker, $actor, $scope);

        if (! in_array((string) $datos['truck_id'], $camiones, true)) {
            throw ValidationException::withMessages([
                'truck_id' => __('equipment.combos.truckNotYours'),
            ]);
        }

        $this->exigeRemolqueDeLaEmpresa($actor, (string) $datos['trailer_id']);

        $enganche = $this->medida($datos, 'drive_to_trailer');

        // La razón de ser de la fila. Sin ella no hay conjunto que medir, y
        // una fila con las tres del margen y sin esta guardaría tres datos de
        // permiso colgando de nada.
        if ($enganche === null || $enganche < 1) {
            throw ValidationException::withMessages([
                'drive_to_trailer.inches' => __('equipment.combos.hitchRequired'),
            ]);
        }

        foreach (['bumper_to_bumper', 'kingpin_to_rear', 'kingpin_to_trailer_axles'] as $campo) {
            $valor = $this->medida($datos, $campo);

            // Cero no es «en blanco». Se escribe cuando alguien pone un cero
            // en las dos casillas creyendo que así la deja vacía, y la
            // restricción de la base lo rechazaría con un error de servidor.
            if ($valor !== null && $valor < 1) {
                throw ValidationException::withMessages([
                    $campo.'.inches' => __('equipment.combos.zero'),
                ]);
            }
        }

        $this->exigeQueQuepaEnSiMismo(
            (string) $actor->tenantId,
            (string) $datos['truck_id'],
            (string) $datos['trailer_id'],
            $enganche,
            $this->medida($datos, 'bumper_to_bumper'),
            $this->medida($datos, 'kingpin_to_rear'),
            $this->medida($datos, 'kingpin_to_trailer_axles'),
        );

        ComboSpacing::guardar(
            (string) $actor->tenantId,
            (string) $datos['truck_id'],
            (string) $datos['trailer_id'],
            $enganche,
            $this->medida($datos, 'bumper_to_bumper'),
            $this->medida($datos, 'kingpin_to_rear'),
            $this->medida($datos, 'kingpin_to_trailer_axles'),
            $datos['measured_on'] ?? null,
            $actor->userId,
            $datos['notes'] ?? null,
        );

        return back()->with('success', __('equipment.combos.saved'));
    }

    public function destroy(Request $request, string $truck, string $trailer, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $scope = $checker->authorize($actor, 'equipment:update', null, $current->policy());

        // 404 y no 403: decir «no puedes» sobre una pareja que no está a su
        // alcance confirma que existe.
        abort_unless(in_array($truck, $this->camionesAlcanzables($checker, $actor, $scope), true), 404);

        abort_unless(ComboSpacing::olvidar((string) $actor->tenantId, $truck, $trailer), 404);

        return back()->with('success', __('equipment.combos.forgotten'));
    }

    /**
     * Las parejas que hay que enseñar, con la cadena de ejes de cada una.
     *
     * @param  list<string>  $camionesAlcanzables
     * @return list<array<string, mixed>>
     */
    private function conjuntos(Actor $actor, array $camionesAlcanzables): array
    {
        if ($camionesAlcanzables === []) {
            return [];
        }

        $parejas = $this->parejas($actor, $camionesAlcanzables);

        if ($parejas === []) {
            return [];
        }

        $camiones = $this->unidades('trucks', array_values(array_unique(array_column($parejas, 0))));
        $remolques = $this->unidades('trailers', array_values(array_unique(array_column($parejas, 1))));

        $huecosCamion = AxleSpacings::deVarias(AxleSpacings::CAMION, array_keys($camiones));
        $huecosRemolque = AxleSpacings::deVarias(AxleSpacings::REMOLQUE, array_keys($remolques));
        $medidas = ComboSpacing::deParejas((string) $actor->tenantId, $parejas);
        $conductores = $this->conductores($actor, $parejas);

        $salida = [];

        foreach ($parejas as [$camionId, $remolqueId]) {
            $camion = $camiones[$camionId] ?? null;
            $remolque = $remolques[$remolqueId] ?? null;

            // Una unidad borrada deja una pareja que ya no se puede medir.
            if ($camion === null || $remolque === null) {
                continue;
            }

            $clave = ComboSpacing::clave($camionId, $remolqueId);
            $medida = $medidas[$clave] ?? null;
            $deCamion = $huecosCamion[$camionId] ?? [];
            $deRemolque = $huecosRemolque[$remolqueId] ?? [];

            $cadena = ComboSpacing::cadena(
                $camion['axleCount'],
                $deCamion,
                $medida['driveToTrailerInches'] ?? null,
                $remolque['axleCount'],
                $deRemolque,
            );

            $salida[] = [
                'key' => $clave,
                'truckId' => $camionId,
                'truck' => $camion['unit'],
                'truckLabel' => $camion['label'],
                'truckAxles' => $camion['axleCount'],
                'truckSpacings' => $deCamion,
                'trailerId' => $remolqueId,
                'trailer' => $remolque['unit'],
                'trailerLabel' => $remolque['label'],
                'trailerAxles' => $remolque['axleCount'],
                'trailerSpacings' => $deRemolque,
                'driveToTrailerInches' => $medida['driveToTrailerInches'] ?? null,
                'bumperToBumperInches' => $medida['bumperToBumperInches'] ?? null,
                'kingpinToRearInches' => $medida['kingpinToRearInches'] ?? null,
                'kingpinToTrailerAxlesInches' => $medida['kingpinToTrailerAxlesInches'] ?? null,
                'measuredOn' => $medida['measuredOn'] ?? null,
                'notes' => $medida['notes'] ?? null,
                'axles' => ComboSpacing::ejes($camion['axleCount'], $remolque['axleCount']),
                'chain' => $cadena,
                'overallInches' => ComboSpacing::total($cadena),
                'driver' => $conductores[$clave] ?? null,
            ];
        }

        // Las que llevan a alguien encima primero, y dentro de cada grupo por
        // número de unidad: lo que se conduce hoy es lo que hay que medir hoy.
        usort($salida, static function (array $a, array $b): int {
            $peso = ($b['driver'] === null ? 0 : 1) <=> ($a['driver'] === null ? 0 : 1);

            return $peso !== 0 ? $peso : strcmp((string) $a['truck'], (string) $b['truck']);
        });

        return $salida;
    }

    /**
     * Las parejas: las medidas y las que alguien conduce.
     *
     * @param  list<string>  $camionesAlcanzables
     * @return list<array{0: string, 1: string}>
     */
    private function parejas(Actor $actor, array $camionesAlcanzables): array
    {
        $medidas = DB::table('equipment_combo_spacings')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->whereIn('truck_id', $camionesAlcanzables)
            ->get(['truck_id', 'trailer_id']);

        $asignadas = DB::table('driver_equipment_assignments')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->whereNotNull('trailer_id')
            ->whereIn('truck_id', $camionesAlcanzables)
            ->get(['truck_id', 'trailer_id']);

        $vistas = [];
        $salida = [];

        foreach ([$medidas, $asignadas] as $grupo) {
            foreach ($grupo as $fila) {
                $camion = (string) $fila->truck_id;
                $remolque = (string) $fila->trailer_id;
                $clave = ComboSpacing::clave($camion, $remolque);

                if (isset($vistas[$clave])) {
                    continue;
                }

                $vistas[$clave] = true;
                $salida[] = [$camion, $remolque];
            }
        }

        return $salida;
    }

    /**
     * Quién conduce hoy cada pareja, si alguien.
     *
     * @param  list<array{0: string, 1: string}>  $parejas
     * @return array<string, string>
     */
    private function conductores(Actor $actor, array $parejas): array
    {
        $hoy = now()->toDateString();

        $filas = DB::table('driver_equipment_assignments as a')
            ->join('drivers as d', 'd.id', '=', 'a.driver_id')
            ->where('a.tenant_id', $actor->tenantId)
            ->whereNull('a.deleted_at')
            ->whereNotNull('a.trailer_id')
            ->whereDate('a.starts_on', '<=', $hoy)
            ->where(fn ($q) => $q->whereNull('a.ends_on')->orWhereDate('a.ends_on', '>=', $hoy))
            ->whereIn('a.truck_id', array_column($parejas, 0))
            ->get(['a.truck_id', 'a.trailer_id', 'd.first_name', 'd.last_name']);

        $salida = [];

        foreach ($filas as $fila) {
            $salida[ComboSpacing::clave((string) $fila->truck_id, (string) $fila->trailer_id)]
                = trim((string) $fila->first_name.' '.(string) $fila->last_name);
        }

        return $salida;
    }

    /**
     * Las unidades por identificador, con lo que la pantalla necesita nombrar.
     *
     * @param  list<string>  $ids
     * @return array<string, array{unit: string, label: string|null, axleCount: int|null}>
     */
    private function unidades(string $tabla, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $filas = DB::table($tabla)
            ->whereIn('id', $ids)
            ->whereNull('deleted_at')
            ->get(['id', 'unit_number', 'year', 'make', 'model', 'axle_count']);

        $salida = [];

        foreach ($filas as $fila) {
            $partes = array_values(array_filter([
                $fila->year === null ? null : (string) $fila->year,
                $fila->make === null ? null : (string) $fila->make,
                $fila->model === null ? null : (string) $fila->model,
            ], static fn (?string $v): bool => $v !== null && $v !== ''));

            $salida[(string) $fila->id] = [
                'unit' => (string) $fila->unit_number,
                'label' => $partes === [] ? null : implode(' ', $partes),
                'axleCount' => $fila->axle_count === null ? null : (int) $fila->axle_count,
            ];
        }

        return $salida;
    }

    /**
     * Los camiones y remolques para formar una pareja nueva.
     *
     * @param  list<string>  $camionesAlcanzables
     * @return array{trucks: list<array{id: string, name: string}>, trailers: list<array{id: string, name: string}>}
     */
    private function paraElegir(Actor $actor, array $camionesAlcanzables): array
    {
        $camiones = $camionesAlcanzables === [] ? collect() : DB::table('trucks')
            ->whereIn('id', $camionesAlcanzables)
            ->whereNull('deleted_at')
            ->orderBy('unit_number')
            ->get(['id', 'unit_number']);

        $remolques = DB::table('trailers')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->orderBy('unit_number')
            ->get(['id', 'unit_number']);

        return [
            'trucks' => $camiones->map(static fn ($u): array => [
                'id' => (string) $u->id, 'name' => (string) $u->unit_number,
            ])->values()->all(),
            'trailers' => $remolques->map(static fn ($u): array => [
                'id' => (string) $u->id, 'name' => (string) $u->unit_number,
            ])->values()->all(),
        ];
    }

    /**
     * Los camiones que esta persona alcanza.
     *
     * Un conductor alcanza los suyos: los que tiene o ha tenido asignados. No
     * hay columna que lo diga en `trucks`, así que se llega por la asignación
     * habitual — la misma idea que `EquipmentController::scoped()`, que llega
     * por las cargas. Devolver cero sería la forma segura de equivocarse, pero
     * el conductor tiene `equipment:read` en la matriz y una concesión que
     * enseña una lista vacía no significa nada.
     *
     * @return list<string>
     */
    private function camionesAlcanzables(PermissionChecker $checker, Actor $actor, Scope $scope): array
    {
        $consulta = DB::table('trucks')->whereNull('deleted_at');

        if ($scope === Scope::Own && $actor->driverId !== null) {
            $consulta
                ->where('tenant_id', $actor->tenantId)
                ->whereExists(function ($q) use ($actor): void {
                    $q->select(DB::raw(1))
                        ->from('driver_equipment_assignments as a')
                        ->whereColumn('a.truck_id', 'trucks.id')
                        ->where('a.driver_id', $actor->driverId)
                        ->whereNull('a.deleted_at');
                });

            return $consulta->pluck('id')->map(static fn ($v): string => (string) $v)->all();
        }

        // `applyToQuery` y no `apply`: esto es una consulta cruda, sin modelo
        // del que deducir la tabla. Y por eso el filtro por empresa lo pone
        // quien llama —aquí— y no el ámbito.
        return $checker->scopeFilter($actor, $scope)
            ->applyToQuery($consulta->where('tenant_id', $actor->tenantId), 'trucks', ['carrier' => 'carrier_id'])
            ->pluck('id')->map(static fn ($v): string => (string) $v)->all();
    }

    /**
     * Que el conjunto quepa dentro de sí mismo.
     *
     * ## Por qué esto no lo puede comprobar la casilla
     *
     * Cada medida por separado es plausible: sesenta y ocho pies es una
     * longitud razonable y treinta y cinco también. Lo que no es posible es
     * que el parachoques delantero y el trasero estén MÁS CERCA que el primer
     * eje y el último, porque los dos voladizos van por fuera de los ejes.
     *
     * Lo descubrió el sembrado de demostración: se tomaron las cifras de una
     * hoja real y se pegaron a otro conjunto, y la pantalla enseñó un camión
     * más corto que su propia distancia entre ejes sin quejarse. Un permiso
     * pedido con ese par de cifras lo rechaza la oficina, y quien lo teclea se
     * entera en la ventanilla.
     *
     * Solo se comprueba cuando se PUEDE: si a alguna de las dos fichas le
     * faltan sus huecos no hay cadena contra la que comparar, y entonces no se
     * exige nada. Negarse por no poder comprobar dejaría sin guardar la única
     * medida que alguien tiene.
     */
    private function exigeQueQuepaEnSiMismo(
        string $tenantId,
        string $truckId,
        string $trailerId,
        int $enganche,
        ?int $parachoques,
        ?int $kingpinAlFinal,
        ?int $kingpinAEjes,
    ): void {
        // El final de la cama va por detrás del grupo de ejes del remolque, o
        // como mucho encima. Al revés significa que una de las dos se tomó
        // desde el otro extremo.
        if ($kingpinAlFinal !== null && $kingpinAEjes !== null && $kingpinAEjes > $kingpinAlFinal) {
            throw ValidationException::withMessages([
                'kingpin_to_trailer_axles.inches' => __('equipment.combos.axlesBehindRear'),
            ]);
        }

        if ($parachoques === null) {
            return;
        }

        $camion = DB::table('trucks')->where('id', $truckId)->value('axle_count');
        $remolque = DB::table('trailers')->where('id', $trailerId)->value('axle_count');

        $cadena = ComboSpacing::cadena(
            $camion === null ? null : (int) $camion,
            AxleSpacings::de(AxleSpacings::CAMION, $truckId),
            $enganche,
            $remolque === null ? null : (int) $remolque,
            AxleSpacings::de(AxleSpacings::REMOLQUE, $trailerId),
        );

        $total = ComboSpacing::total($cadena);

        if ($total !== null && $parachoques < $total) {
            throw ValidationException::withMessages([
                'bumper_to_bumper.inches' => __('equipment.combos.bumperShorterThanChain'),
            ]);
        }
    }

    private function exigeRemolqueDeLaEmpresa(Actor $actor, string $id): void
    {
        $existe = DB::table('trailers')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $id)
            ->whereNull('deleted_at')
            ->exists();

        if (! $existe) {
            throw ValidationException::withMessages([
                'trailer_id' => __('equipment.combos.trailerNotYours'),
            ]);
        }
    }

    /**
     * Una medida del formulario, en pulgadas. Nula si no se escribió ninguna
     * de las dos casillas.
     *
     * @param  array<string, mixed>  $datos
     */
    private function medida(array $datos, string $campo): ?int
    {
        /** @var array<string, mixed> $par */
        $par = $datos[$campo] ?? [];

        $cifra = static fn (mixed $v): ?int => $v === null || $v === '' ? null : (int) $v;

        return Measure::aPulgadas($cifra($par['feet'] ?? null), $cifra($par['inches'] ?? null));
    }
}
