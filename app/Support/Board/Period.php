<?php

declare(strict_types=1);

namespace App\Support\Board;

use App\Models\Load;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * El periodo que se está mirando en el tablero.
 *
 * ## Qué significa «hoy» en un tablero de despacho
 *
 * No significa «las cargas cuya fecha es hoy». Una carga que recogió ayer en
 * Laredo y entrega mañana en Gary está rodando AHORA: es exactamente la que
 * hay que tener delante, y con el criterio literal desaparecería del tablero
 * justo los días en que está en la carretera.
 *
 * Así que una carga entra en el periodo cuando **su tramo se cruza con él**:
 * desde su primera cita hasta la última. Es lo que quien despacha llama «lo de
 * hoy», y es la única lectura con la que el tablero no se vacía de cargas que
 * sí están pasando.
 *
 * ## El reloj es el de quien mira
 *
 * «Hoy» empieza a medianoche, pero a la medianoche de quién. Todo se guarda en
 * UTC, así que resolver los límites en UTC daría un «hoy» que empieza a las
 * siete de la tarde del día anterior para alguien en Texas. Los límites se
 * calculan en el huso de quien mira —`Time\Viewer`— y se convierten a UTC para
 * preguntar. Ver `docs/mysql-port.md`.
 *
 * ## La semana empieza en domingo
 *
 * Es un producto de transporte de Estados Unidos, donde la semana de trabajo y
 * las hojas de horas empiezan en domingo. No es la preferencia de nadie: es la
 * misma partición que usa quien firma las nóminas.
 */
final class Period
{
    public const HOY = 'today';

    /**
     * Los periodos con nombre, en el orden en que se enseñan.
     *
     * `custom` va el último y es el único que lee fechas: los demás se calculan
     * y por eso no se pueden equivocar.
     */
    public const CLAVES = [
        self::HOY,
        'yesterday',
        'this_week',
        'last_week',
        'this_month',
        'last_month',
        'this_year',
        'last_year',
        self::A_MEDIDA,
    ];

    public const A_MEDIDA = 'custom';

    private function __construct(
        public readonly string $clave,
        /** Primer día del periodo, `Y-m-d`, en el huso de quien mira. */
        public readonly string $desde,
        /** Último día del periodo, INCLUIDO. */
        public readonly string $hasta,
        /** El mismo primer día como instante UTC, para preguntar a la base. */
        public readonly CarbonImmutable $desdeUtc,
        /** El final del último día, también UTC. Incluye ese día entero. */
        public readonly CarbonImmutable $hastaUtc,
    ) {}

    /**
     * Resuelve lo que llegó en la URL.
     *
     * Lo que no cuadra vuelve a «hoy» y lo DICE: la pantalla pinta el periodo
     * que de verdad se está usando, no el que se pidió. Un desplegable que
     * dice «marzo» sobre una lista de hoy es peor que uno que dice «hoy».
     */
    public static function de(?string $clave, ?string $desde, ?string $hasta, string $huso, ?CarbonImmutable $ahora = null): self
    {
        $ahora ??= CarbonImmutable::now();
        $hoy = $ahora->setTimezone($huso)->startOfDay();

        if ($clave === self::A_MEDIDA) {
            $uno = self::dia($desde, $huso);
            $dos = self::dia($hasta, $huso);

            // Dos fechas, coherentes, y nada de arreglarlas por dentro:
            // intercambiar en silencio un rango del revés enseñaría un periodo
            // que nadie pidió con el nombre del que sí se pidió.
            return $uno === null || $dos === null || $dos->lessThan($uno)
                ? self::armar(self::HOY, $hoy, $hoy)
                : self::armar(self::A_MEDIDA, $uno, $dos);
        }

        [$primero, $ultimo] = match ($clave) {
            'yesterday' => [$hoy->subDay(), $hoy->subDay()],
            'this_week' => [$hoy->startOfWeek(CarbonImmutable::SUNDAY), $hoy->startOfWeek(CarbonImmutable::SUNDAY)->addDays(6)],
            'last_week' => [
                $hoy->startOfWeek(CarbonImmutable::SUNDAY)->subWeek(),
                $hoy->startOfWeek(CarbonImmutable::SUNDAY)->subDay(),
            ],
            'this_month' => [$hoy->startOfMonth(), $hoy->endOfMonth()->startOfDay()],
            'last_month' => [$hoy->subMonthNoOverflow()->startOfMonth(), $hoy->startOfMonth()->subDay()],
            'this_year' => [$hoy->startOfYear(), $hoy->endOfYear()->startOfDay()],
            'last_year' => [$hoy->subYear()->startOfYear(), $hoy->startOfYear()->subDay()],
            default => [$hoy, $hoy],
        };

        return self::armar(
            in_array($clave, self::CLAVES, true) ? (string) $clave : self::HOY,
            $primero,
            $ultimo,
        );
    }

    private static function armar(string $clave, CarbonImmutable $primero, CarbonImmutable $ultimo): self
    {
        return new self(
            clave: $clave,
            desde: $primero->format('Y-m-d'),
            hasta: $ultimo->format('Y-m-d'),
            desdeUtc: $primero->startOfDay()->setTimezone('UTC'),
            // El último día ENTERO. Con `startOfDay` una carga de las cinco de
            // la tarde del último día se quedaba fuera del rango que la nombra.
            hastaUtc: $ultimo->endOfDay()->setTimezone('UTC'),
        );
    }

    /** `2026-09-24` en el huso de quien mira, o nulo si no es una fecha. */
    private static function dia(?string $valor, string $huso): ?CarbonImmutable
    {
        if ($valor === null || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $valor)) {
            return null;
        }

        try {
            return CarbonImmutable::createFromFormat('Y-m-d', $valor, $huso)->startOfDay();
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Recorta la consulta de cargas a las que se cruzan con el periodo.
     *
     * El tramo de una carga va de su PRIMERA cita a la ÚLTIMA, y por eso la
     * subconsulta agrupa: mirar parada a parada no vería la carga que recogió
     * antes del rango y entrega después, que es justo la que está rodando.
     *
     * La segunda mitad es para las cargas sin citas —un alta a medio hacer, una
     * carga recién creada—. Sin ella desaparecerían del tablero el mismo día
     * que se crean, que es cuando más falta hace verlas.
     *
     * @param  Builder<Load>  $query
     * @return Builder<Load>
     */
    public function aplicar(Builder $query): Builder
    {
        $desde = $this->desdeUtc->format('Y-m-d H:i:s.v');
        $hasta = $this->hastaUtc->format('Y-m-d H:i:s.v');

        return $query->where(function ($q) use ($desde, $hasta): void {
            $q->whereExists(function ($s) use ($desde, $hasta): void {
                $s->select(DB::raw(1))
                    ->from('load_stops as ps')
                    ->whereColumn('ps.load_id', 'loads.id')
                    ->whereNull('ps.deleted_at')
                    ->whereNotNull(DB::raw('coalesce(ps.window_start, ps.window_end)'))
                    ->groupBy('ps.load_id')
                    ->havingRaw('min(coalesce(ps.window_start, ps.window_end)) <= ?', [$hasta])
                    ->havingRaw('max(coalesce(ps.window_end, ps.window_start)) >= ?', [$desde]);
            })->orWhere(function ($q2) use ($desde, $hasta): void {
                $q2->whereNotExists(function ($s): void {
                    $s->select(DB::raw(1))
                        ->from('load_stops as ps2')
                        ->whereColumn('ps2.load_id', 'loads.id')
                        ->whereNull('ps2.deleted_at')
                        ->whereNotNull(DB::raw('coalesce(ps2.window_start, ps2.window_end)'));
                })
                    ->whereRaw('coalesce(loads.planned_pickup_at, loads.created_at) <= ?', [$hasta])
                    ->whereRaw('coalesce(loads.planned_delivery_at, loads.planned_pickup_at, loads.created_at) >= ?', [$desde]);
            });
        });
    }

    /**
     * Los dos extremos como cadenas UTC, para quien pregunta a mano.
     *
     * @return array{0: string, 1: string}
     */
    public function limitesUtc(): array
    {
        return [$this->desdeUtc->format('Y-m-d H:i:s.v'), $this->hastaUtc->format('Y-m-d H:i:s.v')];
    }

    /**
     * Lo que viaja a la pantalla.
     *
     * @return array{key: string, from: string, to: string, options: list<string>}
     */
    public function paraLaPantalla(): array
    {
        return [
            'key' => $this->clave,
            'from' => $this->desde,
            'to' => $this->hasta,
            'options' => self::CLAVES,
        ];
    }
}
