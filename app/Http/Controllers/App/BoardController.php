<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\Scope;
use App\Models\Driver;
use App\Models\Load;
use App\Services\Map\MapProvider;
use App\Support\Board\Positions;
use App\Support\Board\Tabs;
use App\Support\Drivers\DriverScope;
use App\Support\Drivers\DriverTimeline;
use App\Support\EnumValue;
use App\Support\Fleet\StandingAssignment;
use App\Support\InertiaPage;
use App\Support\Loads\History;
use App\Support\Loads\LoadClock;
use App\Support\Loads\LoadScope;
use App\Support\Loads\Transitions;
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

    /**
     * El nombre de la acción de cancelar, escrito UNA vez.
     *
     * Es a la vez el último segmento de la URL —`/loads/{id}/status/cancelled`—
     * y la clave que mira {@see Transitions::allowedFrom}. Estuvo escrito
     * «cancel» aquí y «cancelled» en la ruta el tiempo suficiente para que el
     * menú del tablero no enseñara nunca la opción: `allowedFrom` no encuentra
     * ninguna arista con ese nombre y contesta que no, sin equivocarse.
     * `BoardPanelsTest` comprueba que la pantalla publique en esta misma
     * palabra.
     */
    public const CANCELAR = 'cancelled';

    /**
     * Tope de las listas de las ventanas de alta rápida.
     *
     * No es el tope de columnas: son dos cosas distintas que casualmente valen
     * lo mismo hoy. Una empresa con doscientos clientes no puede mandarlos
     * todos en cada carga del tablero, que se refresca cada minuto; el
     * desplegable se busca escribiendo y el formulario completo de `/loads` los
     * tiene todos.
     */
    private const TOPE_DE_LISTA = 200;

    public function __invoke(
        Request $request,
        CurrentActor $current,
        PermissionChecker $checker,
        MapProvider $mapa,
    ): Response {
        $actor = $current->require();
        $policy = $current->policy();

        // `documents` por los nombres de los papeles en la cronología
        // (`documents.types.*`). Sin él, «Se subió pod» decía la clave cruda.
        $this->usesDictionary($request, ['board', 'loads', 'drivers', 'equipment', 'nav', 'documents']);

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
            // Las acciones rápidas. Los permisos se deciden AQUÍ y no en la
            // pantalla: un botón que se enseña y luego devuelve 403 al pulsar
            // es peor que no enseñarlo.
            'quickAdd' => fn (): array => $this->accionesRapidas($checker, $actor, $policy),
            /*
             * Lo que se abrió al pulsar. Viaja en la URL —`?load=` o
             * `?driver=`— y no en el estado de la pantalla: así el enlace se
             * puede pegar en un mensaje, el botón de atrás funciona, y un
             * refresco no pierde lo que se estaba mirando.
             *
             * En cierre, como las listas de la ventana de alta, para que el
             * refresco de cada minuto no los calcule: ese refresco pide cuatro
             * propiedades por su nombre y ninguna es esta, e Inertia solo
             * evalúa los cierres de lo que se pide. Escritos como valor, el
             * servidor juntaba las cinco tablas de la cronología una vez por
             * minuto para tirar el resultado a la basura.
             */
            'selectedLoad' => fn (): ?array => $puedeCargas
                ? $this->cargaElegida($request, $checker, $actor, $policy)
                : null,
            'selectedDriver' => fn (): ?array => $puedeConductores
                ? $this->conductorElegido($request, $checker, $actor, $policy, $ahora)
                : null,
            // La hora del servidor, para que la pantalla pueda decir «hace un
            // minuto» sin creerse el reloj del navegador.
            'refreshedAt' => $ahora->toIso8601String(),
        ]);
    }

    /**
     * Lo que hace falta para dar de alta desde el tablero sin salir de él.
     *
     * ## Por qué solo lo esencial
     *
     * La ventana pide lo MÍNIMO para que la carga o el conductor existan —lo
     * mismo que exige el servidor, ni un campo más— y al terminar lleva a la
     * ficha para lo demás. Una ventana con los treinta campos del formulario
     * completo no es una acción rápida: es el formulario completo dentro de una
     * caja más pequeña, y se abandona a la mitad.
     *
     * Las dos puertas son las de siempre: `POST /loads` y `POST /drivers`. No
     * hay un segundo camino de creación, porque un segundo camino es un segundo
     * sitio donde olvidarse de una regla.
     *
     * Las listas viajan solo si la persona puede crear: quien no puede dar de
     * alta un conductor tampoco necesita la lista de transportistas en la carga
     * de la página.
     *
     * @param  array<string, mixed>|null  $policy
     * @return array<string, mixed>
     */
    private function accionesRapidas(PermissionChecker $checker, Actor $actor, ?array $policy): array
    {
        $puedeCarga = $checker->can($actor, 'load:create', null, $policy)->allowed;
        $puedeConductor = $checker->can($actor, 'driver:create', null, $policy)->allowed;

        return [
            'canLoad' => $puedeCarga,
            'canDriver' => $puedeConductor,
            'customers' => $puedeCarga ? $this->clientesParaElegir($actor) : [],
            'carriers' => $puedeConductor ? $this->transportistasParaElegir($actor) : [],
        ];
    }

    /**
     * Los clientes a los que se les puede abrir una carga.
     *
     * Activos y solo activos: es la misma lista que ofrece `/loads/create`, y
     * ofrecer aquí uno archivado dejaría la ventana enseñando un cliente que el
     * formulario de siempre no enseña.
     *
     * @return list<array{id: string, name: string}>
     */
    private function clientesParaElegir(Actor $actor): array
    {
        return DB::table('customers')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->where('status', 'active')
            ->orderBy('company_name')
            ->limit(self::TOPE_DE_LISTA)
            ->get(['id', 'company_name as name'])
            ->map(fn ($r): array => ['id' => (string) $r->id, 'name' => (string) $r->name])
            ->all();
    }

    /**
     * Los transportistas a los que se puede atar un conductor nuevo.
     *
     * Un usuario transportista solo ve el suyo, igual que en `/drivers/create`.
     *
     * @return list<array{id: string, name: string}>
     */
    private function transportistasParaElegir(Actor $actor): array
    {
        return DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->when($actor->carrierId !== null, fn ($q) => $q->where('id', $actor->carrierId))
            ->orderBy('legal_name')
            ->limit(self::TOPE_DE_LISTA)
            ->get(['id', 'legal_name as name'])
            ->map(fn ($r): array => ['id' => (string) $r->id, 'name' => (string) $r->name])
            ->all();
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

    /* ── Lo que se abre al pulsar ───────────────────────────────────────── */

    /**
     * La carga que se está mirando, con sus tres pestañas.
     *
     * Es un resumen y no la ficha entera: la ficha vive en `/loads/{id}` y el
     * panel lleva a ella. Lo que hay aquí es lo que se mira sin soltar el
     * tablero —de qué va, quién es el cliente, y qué ha pasado— y las tres
     * acciones que se toman desde ahí.
     *
     * @param  array<string, mixed>|null  $policy
     * @return array<string, mixed>|null
     */
    private function cargaElegida(Request $request, PermissionChecker $checker, Actor $actor, ?array $policy): ?array
    {
        $id = (string) $request->query('load', '');

        if ($id === '') {
            return null;
        }

        $scope = $checker->authorize($actor, 'load:read', null, $policy);

        /** @var Load|null $carga */
        $carga = $this->scoped($checker, $actor, $scope)->whereKey($id)->first();

        // Fuera de alcance es lo mismo que no existe: decir «no puede verla»
        // ya diría que existe.
        if ($carga === null) {
            return null;
        }

        $tenantId = (string) $actor->tenantId;
        $equipo = $this->tripulacionDe($tenantId, [$id])[$id] ?? null;
        $contexto = new ResourceContext(
            tenantId: $tenantId,
            carrierId: $carga->carrier_id === null ? null : (string) $carga->carrier_id,
        );

        $puedeEditar = $checker->can($actor, 'load:update', $contexto, $policy)->allowed;
        $puedeDinero = $checker->can($actor, 'load:financials:update', $contexto, $policy)->allowed;

        return [
            'id' => $id,
            'loadNumber' => (string) $carga->load_number,
            'status' => EnumValue::of($carga->status),
            'commodity' => $carga->commodity,
            'reference' => $carga->customer_reference,
            'weightPounds' => $carga->weight_pounds === null ? null : (int) $carga->weight_pounds,
            'driver' => $equipo['driver'] ?? null,
            'truck' => $equipo['truck'] ?? null,
            'trailer' => $equipo['trailer'] ?? null,
            'stops' => $this->paradasDe($tenantId, $id),
            'customer' => $this->clienteDe($tenantId, $carga),
            // El formulario de la ventana de edición, COMPLETO. Ver `edicionDe`.
            'edit' => $puedeEditar
                ? $this->edicionDe($tenantId, $carga, $puedeDinero)
                : null,
            'history' => History::de($tenantId, $id),
            'can' => [
                // Las tres acciones del menú, decididas en el SERVIDOR. Un menú
                // que ofrece lo que el servidor va a rechazar con un 403 es
                // peor que un menú corto.
                'update' => $puedeEditar,
                'assign' => $checker->can($actor, 'load:assign_resources', $contexto, $policy)->allowed,
                // `cancelled` y no `cancel`: es el nombre de la ACCIÓN en la
                // URL —`/loads/{id}/status/cancelled`— y el mismo que mira
                // `Transitions`. Con «cancel» la comprobación devolvía siempre
                // falso, porque no hay ninguna arista con ese nombre, y el
                // menú se quedaba sin la opción para todo el mundo.
                'cancel' => $checker->can($actor, 'load:cancel', $contexto, $policy)->allowed
                    && Transitions::allowedFrom(self::CANCELAR, $carga->status),
            ],
        ];
    }

    /**
     * El formulario de la ventana de edición, ENTERO.
     *
     * ## Por qué viaja todo y no solo lo que se edita
     *
     * `PATCH /loads/{id}` no es un parche: `LoadController::loadColumns` escribe
     * cada columna con `$data[...] ?? null` y `syncStops` REEMPLAZA las paradas
     * por las que le llegan. Una ventana que mandara solo la mercancía y dos
     * ciudades dejaría la carga sin número de PO, sin peso, sin millas, sin
     * instrucciones, con la tarifa a cero y con las paradas reducidas a dos, sin
     * contactos, sin código postal y sin el sitio del cliente al que apuntaban.
     * Nada de eso daría un error: la pantalla diría «guardado».
     *
     * Así que la ventana lleva el estado completo y devuelve intacto lo que no
     * enseña. Es la única forma de tener una edición rápida por la MISMA puerta
     * que el formulario largo; la alternativa —una segunda ruta que solo toque
     * tres columnas— es un segundo sitio donde olvidarse de un permiso, de una
     * auditoría de dinero o de una regla.
     *
     * Las dos cifras de dinero solo viajan si quien mira puede tocarlas. Quien
     * no puede no las manda, y `loadColumns` ni las mira: van fuera del `if` de
     * `$canMoney` y no se pisan.
     *
     * `requirements` NO viaja a propósito: `syncRequirements(null)` deja lo que
     * hubiera, que es justo lo que queremos de una ventana que no los enseña.
     *
     * @return array<string, mixed>
     */
    private function edicionDe(string $tenantId, Load $carga, bool $conDinero): array
    {
        $formulario = [
            'customer_id' => (string) $carga->customer_id,
            'customer_reference' => $carga->customer_reference,
            'po_number' => $carga->po_number,
            'commodity' => $carga->commodity,
            'weight_pounds' => $carga->weight_pounds === null ? null : (int) $carga->weight_pounds,
            'piece_count' => $carga->piece_count === null ? null : (int) $carga->piece_count,
            'length_inches' => $carga->length_inches === null ? null : (int) $carga->length_inches,
            'width_inches' => $carga->width_inches === null ? null : (int) $carga->width_inches,
            'height_inches' => $carga->height_inches === null ? null : (int) $carga->height_inches,
            'required_equipment_type_id' => $carga->required_equipment_type_id,
            'is_oversize' => (bool) $carga->is_oversize,
            'is_overweight' => (bool) $carga->is_overweight,
            'miles' => $carga->miles === null ? null : (int) $carga->miles,
            'deadhead_miles' => $carga->deadhead_miles === null ? null : (int) $carga->deadhead_miles,
            'special_instructions' => $carga->special_instructions,
            'internal_notes' => $carga->internal_notes,
            'stops' => $this->paradasParaEditar($tenantId, (string) $carga->id),
        ];

        /*
         * Los porcentajes del reparto, y SOLO si quien mira puede tocar dinero.
         *
         * Los dos importes en céntimos no hacen falta: `loadColumns` ya no los
         * pisa cuando no vienen. Los porcentajes sí, porque los suyos no son
         * `?? null` sino `?? política de la empresa`, y ese valor por omisión
         * existe para las cargas NUEVAS: aplicado a una que ya existe,
         * devolvería al 25 % una comisión que alguien pactó al 18 %.
         *
         * Quien no puede tocar dinero no manda ninguno de los cuatro, y el
         * bloque entero de `loadColumns` ni se ejecuta.
         */
        if ($conDinero) {
            $formulario['carrier_dispatch_fee_bps'] = (int) $carga->carrier_dispatch_fee_bps;
            $formulario['dispatcher_commission_bps'] = (int) $carga->dispatcher_commission_bps;
        }

        return $formulario;
    }

    /**
     * Las paradas con TODAS las columnas que `syncStops` escribe.
     *
     * Una por una y con su `id`: sin el identificador, guardar borraría las
     * paradas de verdad y crearía copias nuevas, y con ellas se irían las horas
     * de llegada reales, las detenciones y todo lo que cuelga de la parada.
     *
     * @return list<array<string, mixed>>
     */
    private function paradasParaEditar(string $tenantId, string $loadId): array
    {
        return DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.tenant_id', $tenantId)
            ->where('s.load_id', $loadId)
            ->whereNull('s.deleted_at')
            ->orderBy('s.sequence')
            ->get([
                's.id', 's.stop_type', 's.facility_name', 's.customer_location_id', 's.line1',
                's.city', 's.state', 's.country', 's.postal_code', 's.timezone',
                's.appointment_type', 's.window_start', 's.window_end', 's.contact_name',
                's.contact_phone', 's.contact_email', 's.instructions', 's.confirmation_number',
                // Solo para ENSEÑAR. No vuelve al servidor: ver `locationName`.
                'cl.name as loc_name', 'cl.city as loc_city', 'cl.state as loc_state',
            ])
            ->map(static fn (object $s): array => [
                'id' => (string) $s->id,
                'stop_type' => (string) $s->stop_type,
                'facility_name' => $s->facility_name,
                'customer_location_id' => $s->customer_location_id,
                'line1' => $s->line1,
                'city' => $s->city,
                'state' => $s->state,
                'country' => $s->country,
                'postal_code' => $s->postal_code,
                'timezone' => $s->timezone,
                'appointment_type' => $s->appointment_type,
                // En el formato que espera un campo de fecha y hora del
                // navegador —«2026-09-24T08:00»— y no el de la base.
                'window_start' => self::paraElNavegador($s->window_start),
                'window_end' => self::paraElNavegador($s->window_end),
                'contact_name' => $s->contact_name,
                'contact_phone' => $s->contact_phone,
                'contact_email' => $s->contact_email,
                'instructions' => $s->instructions,
                'confirmation_number' => $s->confirmation_number,
                /*
                 * El sitio del cliente al que apunta la parada, si apunta a
                 * uno. Va SOLO para enseñarlo, y el formulario lo quita antes
                 * de mandar —`loads.*` no tiene regla para él y `syncStops` no
                 * lo escribe—.
                 *
                 * Sin esto, la ventana enseñaba «Ciudad» y «Estado» en blanco
                 * para una parada que, en el panel de detrás y en la misma
                 * pantalla, decía «Bodega Laredo · Laredo, TX»: la dirección
                 * estaba en `customer_locations` y las casillas de la parada
                 * estaban vacías de verdad. Dos casillas en blanco que no
                 * mandan en lo que se ve son peores que ninguna casilla.
                 */
                'locationName' => $s->customer_location_id === null ? null : trim(implode(' · ', array_filter([
                    $s->loc_name,
                    $s->loc_city === null
                        ? null
                        : $s->loc_city.($s->loc_state === null ? '' : ', '.$s->loc_state),
                ]))),
            ])
            ->all();
    }

    /** «2026-09-24 08:00:00» pasa a «2026-09-24T08:00». Nulo sigue siendo nulo. */
    private static function paraElNavegador(mixed $valor): ?string
    {
        if ($valor === null || $valor === '') {
            return null;
        }

        return str_replace(' ', 'T', mb_substr((string) $valor, 0, 16));
    }

    /**
     * Las paradas de la carga, en orden y con la hora del muelle.
     *
     * @return list<array<string, mixed>>
     */
    private function paradasDe(string $tenantId, string $loadId): array
    {
        return DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.tenant_id', $tenantId)
            ->where('s.load_id', $loadId)
            ->whereNull('s.deleted_at')
            ->orderBy('s.sequence')
            ->get([
                's.id', 's.stop_type', 's.sequence', 's.window_start', 's.timezone',
                's.actual_arrival_at', 's.city', 's.state', 's.facility_name',
                'cl.name as loc_name', 'cl.city as loc_city', 'cl.state as loc_state',
                'cl.line1 as loc_line1', 'cl.timezone as loc_tz',
            ])
            ->map(function ($s): array {
                $huso = $s->timezone ?? $s->loc_tz;

                return [
                    'id' => (string) $s->id,
                    'type' => (string) $s->stop_type,
                    'sequence' => (int) $s->sequence,
                    'name' => $s->facility_name ?? $s->loc_name,
                    'line1' => $s->loc_line1,
                    'city' => $s->city ?? $s->loc_city,
                    'state' => $s->state ?? $s->loc_state,
                    ...LoadClock::previsto($s->window_start, $huso),
                    // Y si ya se llegó, cuándo. Es lo que distingue «va a las
                    // ocho» de «llegó a las ocho y diez».
                    'arrived' => $s->actual_arrival_at === null
                        ? null
                        : LoadClock::real($s->actual_arrival_at, $huso)['at'],
                ];
            })
            ->all();
    }

    /**
     * El cliente de la carga: con quién se habla y en qué condiciones.
     *
     * @return array<string, mixed>|null
     */
    private function clienteDe(string $tenantId, Load $carga): ?array
    {
        if ($carga->customer_id === null) {
            return null;
        }

        $cliente = DB::table('customers')
            ->where('tenant_id', $tenantId)
            ->where('id', $carga->customer_id)
            ->first(['id', 'company_name', 'email', 'phone', 'payment_terms_days', 'status']);

        if ($cliente === null) {
            return null;
        }

        return [
            'id' => (string) $cliente->id,
            'name' => (string) $cliente->company_name,
            'email' => $cliente->email,
            'phone' => $cliente->phone,
            'termsDays' => $cliente->payment_terms_days === null ? null : (int) $cliente->payment_terms_days,
            'status' => EnumValue::of($cliente->status),
            // El contacto de ESTA carga, no el primero de la ficha del cliente:
            // una empresa con seis contactos tiene uno por carga, y llamar al
            // que no es cuesta una llamada y media.
            'contact' => $carga->customer_contact_id === null ? null : $this->contacto($tenantId, (string) $carga->customer_contact_id),
        ];
    }

    /**
     * El nombre del contacto de la carga.
     *
     * Va por su tenant además de por su id: un id de contacto llega desde la
     * carga, pero el filtro de tenant no se deja de escribir porque la fuente
     * parezca de dentro.
     */
    private function contacto(string $tenantId, string $id): ?string
    {
        $fila = DB::table('customer_contacts')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->whereNull('deleted_at')
            ->first(['first_name', 'last_name']);

        if ($fila === null) {
            return null;
        }

        $nombre = trim((string) $fila->first_name.' '.(string) $fila->last_name);

        return $nombre === '' ? null : $nombre;
    }

    /**
     * El conductor que se está mirando, con su cronología.
     *
     * @param  array<string, mixed>|null  $policy
     * @return array<string, mixed>|null
     */
    private function conductorElegido(
        Request $request,
        PermissionChecker $checker,
        Actor $actor,
        ?array $policy,
        CarbonImmutable $ahora,
    ): ?array {
        $id = (string) $request->query('driver', '');

        if ($id === '') {
            return null;
        }

        $scope = $checker->authorize($actor, 'driver:read', null, $policy);

        /** @var Driver|null $conductor */
        $conductor = DriverScope::apply(Driver::query(), $checker, $actor, $scope)
            ->whereNull('drivers.deleted_at')
            ->whereKey($id)
            ->first();

        if ($conductor === null) {
            return null;
        }

        $tenantId = (string) $actor->tenantId;
        $fija = StandingAssignment::deConductor($tenantId, $id, $ahora);
        $unidades = $fija === null ? ['trucks' => [], 'trailers' => []] : $this->unidadesPorId($tenantId, [$id => $fija]);

        return [
            'id' => $id,
            'firstName' => (string) $conductor->first_name,
            'lastName' => (string) $conductor->last_name,
            'phone' => $conductor->phone,
            'email' => $conductor->email,
            'status' => EnumValue::of($conductor->status),
            'statusNote' => $conductor->status_note,
            'cdlClass' => $conductor->cdl_class,
            'licenseState' => $conductor->license_state,
            'truck' => $fija === null ? null : ($unidades['trucks'][$fija['truckId']] ?? null),
            'trailer' => $fija === null || $fija['trailerId'] === null
                ? null
                : ($unidades['trailers'][$fija['trailerId']] ?? null),
            // La carga que lleva AHORA, si lleva alguna. Es la primera pregunta
            // que se hace mirando a un conductor en un tablero.
            'currentLoad' => $this->cargaEnCursoDe($tenantId, $id),
            'timeline' => DriverTimeline::de($tenantId, $id),
        ];
    }

    /**
     * La carga viva que lleva este conductor, si lleva alguna.
     *
     * @return array<string, mixed>|null
     */
    private function cargaEnCursoDe(string $tenantId, string $driverId): ?array
    {
        $fila = DB::table('load_assignments as a')
            ->join('loads as l', 'l.id', '=', 'a.load_id')
            ->where('a.tenant_id', $tenantId)
            ->where('a.driver_id', $driverId)
            ->whereNull('a.unassigned_at')
            ->whereNull('a.deleted_at')
            ->whereNotIn('l.status', Tabs::terminados())
            ->whereNotIn('l.status', Tabs::fuera())
            ->orderByDesc('a.created_at')
            ->first(['l.id', 'l.load_number', 'l.status', 'l.commodity']);

        return $fila === null ? null : [
            'id' => (string) $fila->id,
            'loadNumber' => (string) $fila->load_number,
            'status' => (string) $fila->status,
            'commodity' => $fila->commodity,
        ];
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
