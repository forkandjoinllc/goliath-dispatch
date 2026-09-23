<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Models\Driver;
use App\Models\Load;
use App\Services\Map\MapProvider;
use App\Support\Board\Positions;
use App\Support\Board\Tabs;
use App\Support\Drivers\DriverScope;
use App\Support\EnumValue;
use App\Support\Fleet\StandingAssignment;
use App\Support\InertiaPage;
use App\Support\Loads\LoadClock;
use App\Support\Loads\LoadScope;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

/**
 * El tablero de despacho: las cargas, el mapa y los conductores.
 *
 * Es lo que se abre por la mañana y lo que se queda abierto todo el día, y por
 * eso está en la raíz. El panel de siempre —lo pendiente y lo que el rol
 * alcanza— se fue a Análisis, que es donde se mira de vez en cuando.
 *
 * ## Tres columnas y una sola pregunta
 *
 * Las tres contestan «¿qué está pasando ahora mismo?» por tres caminos: la
 * lista de cargas, el mapa, y quién está libre. Están juntas porque la
 * respuesta a una lleva a la siguiente: se ve una carga sin asignar, se mira
 * quién está disponible, y se mira dónde está.
 *
 * ## Lo que el tablero NO inventa
 *
 * **Las posiciones.** Salen de `tracking_events`, que entran por carga. Un
 * conductor sin carga en curso no tiene posición, y el tablero lo dice —no lo
 * coloca en el último sitio donde estuvo ni en el domicilio de su
 * transportista—. Ver `Support\Board\Positions`.
 *
 * **Las teselas.** Sin clave de Google el mapa se dibuja sobre fondo liso, con
 * cada punto en su sitio y con su zoom, y la pantalla dice que no hay mapa
 * debajo. Ver `Services\Map\MapProvider`.
 *
 * **El avatar.** Es la inicial del nombre y del apellido sobre un color
 * estable. No hay fotos de conductor en el producto —`equipment_media` guarda
 * fotos de UNIDADES, no de personas—, y una foto de relleno sacada de un banco
 * de imágenes sería una persona que no existe puesta donde va un compañero de
 * trabajo.
 *
 * ## Se refresca solo, cada minuto
 *
 * Con una recarga parcial de Inertia: vuelven las cargas, el mapa y los
 * conductores, y no vuelve el armazón. Un minuto es el periodo que pidió quien
 * lo va a mirar; también es el orden de magnitud al que llegan las posiciones
 * de un proveedor de rastreo, así que pedir más a menudo sería pedir lo mismo.
 */
final class BoardController
{
    use InertiaPage;

    /** Tope por columna. Un tablero no es un listado: para eso está /loads. */
    private const TOPE = 40;

    public function __invoke(
        Request $request,
        CurrentActor $current,
        PermissionChecker $checker,
        MapProvider $mapa,
    ): Response {
        $actor = $current->require();
        $policy = $current->policy();

        $this->usesDictionary($request, ['board', 'loads', 'drivers', 'equipment', 'nav']);

        $pestana = (string) $request->query('tab', Tabs::SIN_ASIGNAR);

        if (! Tabs::valida($pestana)) {
            $pestana = Tabs::SIN_ASIGNAR;
        }

        $ahora = CarbonImmutable::now();

        // Quien no puede leer cargas ve el tablero sin la columna de cargas ni
        // el mapa, y no un 403: un conductor tiene tablero, solo que el suyo.
        $puedeCargas = $checker->can($actor, 'load:read', null, $policy)->allowed;
        $puedeConductores = $checker->can($actor, 'driver:read', null, $policy)->allowed;

        $cargas = $puedeCargas ? $this->cargas($checker, $actor, $policy, $pestana) : collect();
        $cuentas = $puedeCargas ? $this->cuentas($checker, $actor, $policy) : [];

        return Inertia::render('App/Board', [
            'tab' => $pestana,
            'tabs' => Tabs::TODAS,
            'counts' => $cuentas,
            'can' => ['loads' => $puedeCargas, 'drivers' => $puedeConductores],
            'loads' => $this->tarjetasDeCarga($actor, $cargas),
            'drivers' => $puedeConductores ? $this->conductores($checker, $actor, $policy, $ahora) : [],
            'map' => $this->mapaDe($actor, $mapa, $checker, $policy, $ahora),
            // La hora del servidor, para que la pantalla pueda decir «hace un
            // minuto» sin creerse el reloj del navegador.
            'refreshedAt' => $ahora->toIso8601String(),
        ]);
    }

    /* ── Las cargas ─────────────────────────────────────────────────────── */

    /**
     * @param  array<string, mixed>|null  $policy
     * @return Collection<int, Load>
     */
    private function cargas(PermissionChecker $checker, Actor $actor, ?array $policy, string $pestana): Collection
    {
        $scope = $checker->authorize($actor, 'load:read', null, $policy);

        return $this->conPestana($this->scoped($checker, $actor, $scope), $pestana)
            ->orderByRaw('coalesce(planned_pickup_at, created_at) asc')
            ->orderBy('id')
            ->limit(self::TOPE)
            ->get();
    }

    /**
     * @param  array<string, mixed>|null  $policy
     * @return array<string, int>
     */
    private function cuentas(PermissionChecker $checker, Actor $actor, ?array $policy): array
    {
        $scope = $checker->authorize($actor, 'load:read', null, $policy);
        $cuentas = [];

        foreach (Tabs::TODAS as $pestana) {
            $cuentas[$pestana] = $this->conPestana($this->scoped($checker, $actor, $scope), $pestana)->count();
        }

        return $cuentas;
    }

    /**
     * La partición: sin asignar, asignadas, completadas.
     *
     * «Sin asignar» es la AUSENCIA de conductor, no un estado de la carga: una
     * carga despachada a la que alguien le quitó el conductor sigue sin
     * asignar, y es justo la que hay que ver primero.
     *
     * @param  Builder<Load>  $query
     * @return Builder<Load>
     */
    private function conPestana(Builder $query, string $pestana): Builder
    {
        $conConductor = static fn ($q) => $q->select(DB::raw(1))
            ->from('load_assignments as la')
            ->whereColumn('la.load_id', 'loads.id')
            ->whereNotNull('la.driver_id')
            ->whereNull('la.unassigned_at')
            ->whereNull('la.deleted_at');

        $query->whereNotIn('status', Tabs::fuera());

        return match ($pestana) {
            Tabs::COMPLETADAS => $query->whereIn('status', Tabs::terminados()),
            Tabs::ASIGNADAS => $query
                ->whereNotIn('status', Tabs::terminados())
                ->whereExists($conConductor),
            default => $query
                ->whereNotIn('status', Tabs::terminados())
                ->whereNotExists($conConductor),
        };
    }

    /**
     * Cada carga como se lee en una tarjeta.
     *
     * @param  Collection<int, Load>  $cargas
     * @return list<array<string, mixed>>
     */
    private function tarjetasDeCarga(Actor $actor, Collection $cargas): array
    {
        if ($cargas->isEmpty()) {
            return [];
        }

        $ids = $cargas->map(fn (Load $l): string => (string) $l->id)->all();
        $tripulacion = $this->tripulacionDe((string) $actor->tenantId, $ids);
        $clientes = $this->nombresDeCliente($cargas);
        $siguientes = $this->siguientesParadas((string) $actor->tenantId, $ids);

        $salida = [];

        foreach ($cargas as $carga) {
            $id = (string) $carga->id;
            $equipo = $tripulacion[$id] ?? null;

            $salida[] = [
                'id' => $id,
                'loadNumber' => (string) $carga->load_number,
                'status' => (string) $carga->status?->value,
                'commodity' => $carga->commodity,
                'customerName' => $clientes[(string) $carga->customer_id] ?? null,
                'driver' => $equipo['driver'] ?? null,
                // La combinación, tal y como se dice en la radio: «101 con la
                // T-220». Nula entera cuando no hay conductor asignado.
                'truck' => $equipo['truck'] ?? null,
                'trailer' => $equipo['trailer'] ?? null,
                // Recogida o entrega, DICHO, y no una fecha suelta que quien
                // mira tiene que adivinar de qué es.
                'nextStop' => $siguientes[$id] ?? null,
            ];
        }

        return $salida;
    }

    /**
     * La siguiente parada de cada carga: la primera a la que no se ha llegado.
     *
     * Si ya se llegó a todas, la última — que es la entrega, y es lo que hay
     * que enseñar de una carga terminada. La hora viaja con el huso DEL MUELLE,
     * no con el del navegador: una recogida a las 02:00 en Laredo pintada con
     * el reloj de quien mira sale con la fecha del día anterior.
     *
     * @param  list<string>  $loadIds
     * @return array<string, array<string, mixed>>
     */
    private function siguientesParadas(string $tenantId, array $loadIds): array
    {
        $filas = DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.tenant_id', $tenantId)
            ->whereIn('s.load_id', $loadIds)
            ->whereNull('s.deleted_at')
            ->orderBy('s.load_id')
            ->orderBy('s.sequence')
            ->get([
                's.load_id', 's.stop_type', 's.sequence', 's.window_start', 's.planned_arrival_at',
                's.actual_arrival_at', 's.timezone', 's.city', 's.state', 's.facility_name',
                'cl.city as loc_city', 'cl.state as loc_state', 'cl.name as loc_name', 'cl.timezone as loc_tz',
            ]);

        $pendiente = [];
        $ultima = [];

        foreach ($filas as $fila) {
            $carga = (string) $fila->load_id;
            $ultima[$carga] = $fila;

            if ($fila->actual_arrival_at === null && ! isset($pendiente[$carga])) {
                $pendiente[$carga] = $fila;
            }
        }

        $salida = [];

        foreach ($ultima as $carga => $porOmision) {
            $fila = $pendiente[$carga] ?? $porOmision;
            $cuando = $fila->window_start ?? $fila->planned_arrival_at;

            // La hora del MUELLE, resuelta en el servidor. Una recogida a las
            // 02:00 en Laredo pintada con el reloj de quien mira sale con la
            // fecha del día anterior; `LoadClock` existe por eso y esta
            // pantalla no vuelve a resolverlo por su cuenta.
            $reloj = LoadClock::previsto($cuando, $fila->timezone ?? $fila->loc_tz);

            $salida[$carga] = [
                'type' => (string) $fila->stop_type,
                'at' => $reloj['at'],
                'zone' => $reloj['zone'],
                'city' => $fila->city ?? $fila->loc_city,
                'state' => $fila->state ?? $fila->loc_state,
                'name' => $fila->facility_name ?? $fila->loc_name,
            ];
        }

        return $salida;
    }

    /**
     * Conductor, camión y remolque de cada carga, de `load_assignments`.
     *
     * De ahí y no de la asignación fija: `load_assignments` es lo que de verdad
     * se despachó. La asignación fija solo dice lo habitual, y el día que el
     * camión de siempre está en el taller el tablero tiene que enseñar el que
     * fue.
     *
     * @param  list<string>  $loadIds
     * @return array<string, array<string, mixed>>
     */
    private function tripulacionDe(string $tenantId, array $loadIds): array
    {
        $filas = DB::table('load_assignments as a')
            ->leftJoin('drivers as d', 'd.id', '=', 'a.driver_id')
            ->leftJoin('trucks as t', 't.id', '=', 'a.truck_id')
            ->leftJoin('trailers as r', 'r.id', '=', 'a.trailer_id')
            ->where('a.tenant_id', $tenantId)
            ->whereIn('a.load_id', $loadIds)
            ->whereNull('a.unassigned_at')
            ->whereNull('a.deleted_at')
            ->orderByDesc('a.is_primary')
            ->get([
                'a.load_id', 'a.driver_id',
                'd.first_name', 'd.last_name', 'd.status as driver_status',
                't.unit_number as truck_unit', 'r.unit_number as trailer_unit',
                'r.equipment_type_id as trailer_type_id',
            ]);

        $salida = [];

        // Una fila POR RECURSO: el conductor viene en una, el camión en otra y
        // el remolque en una tercera. Quedarse con la primera de cada carga
        // dejaba la tarjeta diciendo «sin conductor» en la pestaña de las
        // ASIGNADAS —que por definición tienen uno—, porque la primera que
        // llegaba era la del camión. Se juntan las tres.
        foreach ($filas as $fila) {
            $carga = (string) $fila->load_id;

            $salida[$carga] ??= [
                'driver' => null,
                'truck' => null,
                'trailer' => null,
                'trailerTypeId' => null,
            ];

            if ($fila->driver_id !== null && $salida[$carga]['driver'] === null) {
                $salida[$carga]['driver'] = [
                    'id' => (string) $fila->driver_id,
                    'firstName' => (string) $fila->first_name,
                    'lastName' => (string) $fila->last_name,
                    'status' => $fila->driver_status === null ? null : (string) $fila->driver_status,
                ];
            }

            if ($fila->truck_unit !== null && $salida[$carga]['truck'] === null) {
                $salida[$carga]['truck'] = (string) $fila->truck_unit;
            }

            if ($fila->trailer_unit !== null && $salida[$carga]['trailer'] === null) {
                $salida[$carga]['trailer'] = (string) $fila->trailer_unit;
                $salida[$carga]['trailerTypeId'] = $fila->trailer_type_id === null
                    ? null
                    : (string) $fila->trailer_type_id;
            }
        }

        return $salida;
    }

    /**
     * @param  Collection<int, Load>  $cargas
     * @return array<string, string>
     */
    private function nombresDeCliente(Collection $cargas): array
    {
        $ids = $cargas->pluck('customer_id')->filter()->unique()->values()->all();

        if ($ids === []) {
            return [];
        }

        return DB::table('customers')
            ->whereIn('id', $ids)
            ->pluck('company_name', 'id')
            ->map(fn ($v): string => (string) $v)
            ->all();
    }

    /* ── Los conductores ────────────────────────────────────────────────── */

    /**
     * La columna de la derecha: quién hay y con qué anda.
     *
     * El camión y el remolque salen de la asignación FIJA —el equipo habitual—
     * y no de ninguna carga: la pregunta de esta columna es «¿con qué anda
     * este conductor?», que se contesta igual esté o no llevando algo hoy.
     * Mientras no existió esa tabla, un conductor sin carga no tenía equipo que
     * enseñar.
     *
     * @param  array<string, mixed>|null  $policy
     * @return list<array<string, mixed>>
     */
    private function conductores(PermissionChecker $checker, Actor $actor, ?array $policy, CarbonImmutable $ahora): array
    {
        $scope = $checker->authorize($actor, 'driver:read', null, $policy);

        $filas = DriverScope::apply(Driver::query(), $checker, $actor, $scope)
            ->whereNull('drivers.deleted_at')
            ->orderBy('drivers.first_name')
            ->orderBy('drivers.last_name')
            ->limit(self::TOPE)
            ->get(['id', 'first_name', 'last_name', 'phone', 'status']);

        if ($filas->isEmpty()) {
            return [];
        }

        $ids = $filas->map(fn (Driver $d): string => (string) $d->id)->all();
        $fijas = StandingAssignment::deConductores((string) $actor->tenantId, $ids, $ahora);
        $unidades = $this->unidadesPorId((string) $actor->tenantId, $fijas);

        $salida = [];

        foreach ($filas as $conductor) {
            $id = (string) $conductor->id;
            $fija = $fijas[$id] ?? null;
            $camion = $fija === null ? null : ($unidades['trucks'][$fija['truckId']] ?? null);
            $remolque = $fija === null || $fija['trailerId'] === null
                ? null
                : ($unidades['trailers'][$fija['trailerId']] ?? null);

            $salida[] = [
                'id' => $id,
                'firstName' => (string) $conductor->first_name,
                'lastName' => (string) $conductor->last_name,
                // El teléfono tal cual está guardado. Quien mira el tablero lo
                // marca desde el móvil, así que va como enlace `tel:`.
                'phone' => $conductor->phone === null ? null : (string) $conductor->phone,
                'status' => EnumValue::of($conductor->status),
                'truck' => $camion,
                'trailer' => $remolque,
            ];
        }

        return $salida;
    }

    /**
     * Los números de unidad de los camiones y remolques asignados.
     *
     * @param  array<string, array{truckId: string, trailerId: string|null}>  $fijas
     * @return array{trucks: array<string, array<string, mixed>>, trailers: array<string, array<string, mixed>>}
     */
    private function unidadesPorId(string $tenantId, array $fijas): array
    {
        $camiones = array_values(array_unique(array_column($fijas, 'truckId')));
        $remolques = array_values(array_filter(array_unique(array_column($fijas, 'trailerId'))));

        $leer = function (string $tabla, array $ids) use ($tenantId): array {
            if ($ids === []) {
                return [];
            }

            return DB::table($tabla)
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $ids)
                ->whereNull('deleted_at')
                ->get(['id', 'unit_number', 'equipment_type_id'])
                ->keyBy(fn ($r): string => (string) $r->id)
                ->map(fn ($r): array => [
                    'id' => (string) $r->id,
                    'unitNumber' => (string) $r->unit_number,
                    'equipmentTypeId' => $r->equipment_type_id === null ? null : (string) $r->equipment_type_id,
                ])
                ->all();
        };

        return [
            'trucks' => $leer('trucks', $camiones),
            'trailers' => $leer('trailers', $remolques),
        ];
    }

    /* ── El mapa ────────────────────────────────────────────────────────── */

    /**
     * Lo que se pinta: las paradas de las cargas vivas y dónde están los
     * camiones.
     *
     * Las paradas salen de la carga; la posición sale de `tracking_events`. Una
     * carga viva sin ninguna posición NO se inventa: se cuenta aparte y la
     * pantalla dice cuántas son y por qué —sin sesión de rastreo, o sin nada
     * recibido en las últimas horas—.
     *
     * @param  array<string, mixed>|null  $policy
     * @return array<string, mixed>
     */
    private function mapaDe(
        Actor $actor,
        MapProvider $mapa,
        PermissionChecker $checker,
        ?array $policy,
        CarbonImmutable $ahora,
    ): array {
        $base = [
            'provider' => $mapa->name(),
            'live' => $mapa->isLive(),
            'config' => $mapa->clientConfig(),
            'stops' => [],
            'units' => [],
            'withoutSignal' => 0,
        ];

        if (! $checker->can($actor, 'load:read', null, $policy)->allowed) {
            return $base;
        }

        $scope = $checker->authorize($actor, 'load:read', null, $policy);

        // «En vivo» es lo que está rodando: asignadas y no terminadas. Una
        // carga entregada la semana pasada en el mapa es ruido con forma de
        // dato.
        $vivas = $this->conPestana($this->scoped($checker, $actor, $scope), Tabs::ASIGNADAS)
            ->limit(self::TOPE)
            ->get(['id', 'load_number', 'customer_id']);

        if ($vivas->isEmpty()) {
            return $base;
        }

        $ids = $vivas->map(fn (Load $l): string => (string) $l->id)->all();
        $posiciones = Positions::ultimasDeCargas((string) $actor->tenantId, $ids, $ahora);
        $tripulacion = $this->tripulacionDe((string) $actor->tenantId, $ids);
        $tipos = $this->tiposDeRemolque((string) $actor->tenantId);

        $base['stops'] = $this->paradasEnElMapa((string) $actor->tenantId, $ids, $vivas);

        $unidades = [];
        $sinSenal = 0;

        foreach ($vivas as $carga) {
            $id = (string) $carga->id;
            $punto = $posiciones[$id] ?? null;

            if ($punto === null) {
                $sinSenal++;

                continue;
            }

            $equipo = $tripulacion[$id] ?? [];
            $conductor = $equipo['driver'] ?? null;
            $tipoId = $equipo['trailerTypeId'] ?? null;

            $unidades[] = [
                'loadId' => $id,
                'loadNumber' => (string) $carga->load_number,
                'lat' => $punto['lat'],
                'lng' => $punto['lng'],
                'at' => $punto['at'],
                // De dónde salió el punto. `manual` no es un GPS por mucho que
                // ocupe el mismo píxel, y quien mira tiene derecho a saberlo.
                'provider' => $punto['provider'],
                'label' => $punto['label'],
                'driverName' => $conductor === null
                    ? null
                    : trim($conductor['firstName'].' '.$conductor['lastName']),
                'truck' => $equipo['truck'] ?? null,
                'trailer' => $equipo['trailer'] ?? null,
                // El icono del punto sale del TIPO de remolque: una cama baja
                // no se dibuja igual que una caja seca, y en un mapa con
                // treinta puntos el dibujo es lo que se lee primero.
                'trailerType' => $tipoId === null ? null : ($tipos[$tipoId] ?? null),
            ];
        }

        $base['units'] = $unidades;
        $base['withoutSignal'] = $sinSenal;

        return $base;
    }

    /**
     * Cada recogida y cada entrega de las cargas vivas, con coordenadas.
     *
     * Sin coordenadas no hay punto. Un municipio no se coloca «más o menos»:
     * un PIN a doscientos kilómetros de donde está la fábrica es peor que un
     * PIN que falta, porque quien lo ve lo cree.
     *
     * @param  list<string>  $loadIds
     * @param  Collection<int, Load>  $vivas
     * @return list<array<string, mixed>>
     */
    private function paradasEnElMapa(string $tenantId, array $loadIds, Collection $vivas): array
    {
        $numeros = $vivas->keyBy(fn (Load $l): string => (string) $l->id)
            ->map(fn (Load $l): string => (string) $l->load_number)
            ->all();

        $filas = DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.tenant_id', $tenantId)
            ->whereIn('s.load_id', $loadIds)
            ->whereNull('s.deleted_at')
            ->orderBy('s.load_id')
            ->orderBy('s.sequence')
            ->get([
                's.id', 's.load_id', 's.stop_type', 's.window_start', 's.timezone',
                's.latitude', 's.longitude', 's.city', 's.state', 's.facility_name',
                'cl.latitude as loc_lat', 'cl.longitude as loc_lng',
                'cl.city as loc_city', 'cl.state as loc_state', 'cl.name as loc_name',
                'cl.timezone as loc_tz',
            ]);

        $salida = [];

        foreach ($filas as $fila) {
            $lat = Positions::numero($fila->latitude ?? $fila->loc_lat);
            $lng = Positions::numero($fila->longitude ?? $fila->loc_lng);

            if ($lat === null || $lng === null) {
                continue;
            }

            $salida[] = [
                'id' => (string) $fila->id,
                'loadId' => (string) $fila->load_id,
                'loadNumber' => $numeros[(string) $fila->load_id] ?? null,
                'type' => (string) $fila->stop_type,
                'lat' => $lat,
                'lng' => $lng,
                'name' => $fila->facility_name ?? $fila->loc_name,
                'city' => $fila->city ?? $fila->loc_city,
                'state' => $fila->state ?? $fila->loc_state,
                ...LoadClock::previsto($fila->window_start, $fila->timezone ?? $fila->loc_tz),
            ];
        }

        return $salida;
    }

    /**
     * Código de tipo de equipo por identificador, para elegir el icono.
     *
     * @return array<string, string>
     */
    private function tiposDeRemolque(string $tenantId): array
    {
        return DB::table('equipment_types')
            ->where('tenant_id', $tenantId)
            ->where('category', 'trailer')
            ->whereNull('deleted_at')
            ->pluck('code', 'id')
            ->map(fn ($v): string => (string) $v)
            ->all();
    }

    /** @return Builder<Load> */
    private function scoped(PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        return LoadScope::apply(Load::query(), $checker, $actor, $scope);
    }
}
