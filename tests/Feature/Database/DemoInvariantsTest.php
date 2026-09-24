<?php

declare(strict_types=1);

use App\Enums\EquipmentOwnership;
use App\Support\Drivers\Employment;
use App\Support\Equipment\AxleSpacings;
use App\Support\Equipment\ComboSpacing;
use App\Support\Equipment\Vin;
use App\Support\Fleet\StandingAssignment;
use App\Support\Oversize\NeedsPapers;
use App\Support\Screens\Reachable;
use App\Support\TenantContext;
use Database\Seeders\DemoDataSeeder;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Support\Source;

uses(DatabaseTransactions::class);

beforeEach(fn () => app(TenantContext::class)->forget());
afterEach(fn () => app(TenantContext::class)->forget());

/**
 * La demostración no puede enseñar estados que la aplicación prohíbe.
 *
 * ## El defecto
 *
 * `DemoDataSeeder` no es un fixture de pruebas: es lo que corre en la
 * instalación de demostración y lo que ve cualquiera que recorra el producto.
 * Escribe filas con `DB::table(...)->insert()`, saltándose los controladores —y
 * por eso puede escribir combinaciones que ninguna ruta puede producir.
 *
 * Lo que había, medido sobre la base sembrada:
 *
 *  - Un gasto **aprobado** con recibo exigido y sin recibo. `ExpenseController`
 *    rechaza esa transición con `expenses.errors.receiptRequired`, y
 *    `ExpenseTransitions` no tiene camino de vuelta a `submitted`: no hay forma
 *    de llegar ahí ni de repararlo. Eran 3.400 $ sin justificante, pintados
 *    igual que los demás.
 *  - Los **once** gastos en `approved`, así que la cola de revisión —los
 *    botones de aprobar y rechazar— no se ve nunca en la demostración.
 *  - Un documento con `review_status = 'expired'`, valor que **no escribe
 *    nadie** en toda la aplicación, mientras el filtro de la pantalla lo
 *    ofrece: la demostración era la única razón de que esa opción devolviera
 *    una fila y no cero.
 *  - Trece documentos decididos y **cero** filas en `document_reviews`.
 *  - Una carga facturada sin ninguna fila de camión y con un conductor que no
 *    trabaja para su transportista. `Guards::forDispatch()` devuelve `noTruck`
 *    para lo primero y `checkResource()` rechaza lo segundo.
 *
 * ## Por qué es peor que un fixture malo
 *
 * Un fixture malo rompe una prueba. Una demostración mala **enseña un producto
 * que no existe**: quien la recorre concluye que el permiso de sobredimensión
 * es una casilla que alguien marca, que la suspensión de un transportista es
 * un aviso, que el recibo obligatorio se cumple solo. Y quien programa contra
 * ella nunca ejecuta la rama donde vive el defecto de verdad.
 */
function sembrarDemostracion(): string
{
    test()->seed(DemoDataSeeder::class);

    $tenantId = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('tenants')->where('slug', 'demo-dispatch')->value('id'),
    );

    expect($tenantId)->not->toBeNull('La demostración ya no siembra la empresa `demo-dispatch`.');

    return (string) $tenantId;
}

/**
 * Cada invariante: qué se cuenta, dónde lo exige la aplicación, y qué texto
 * de esa exigencia tiene que seguir estando.
 *
 * La tercera columna es lo que impide que un invariante sobreviva a su regla.
 * Sin ella, el día que alguien quite la comprobación del recibo, esta prueba
 * seguiría verde exigiendo algo que ya no exige nadie — y eso es peor que no
 * tenerla, porque parece cobertura.
 *
 * @return array<string, array{0: Closure, 1: string, 2: string}>
 */
function invariantesDeLaDemostracion(string $tenantId): array
{
    $enLaEmpresa = static fn (string $tabla) => DB::table($tabla)->where('tenant_id', $tenantId);

    return [
        'un gasto aprobado con recibo exigido lleva recibo' => [
            fn (): int => (clone $enLaEmpresa('expenses'))
                ->where('status', 'approved')
                ->where('requires_receipt_snapshot', 1)
                ->whereNull('receipt_document_id')
                ->count(),
            'app/Http/Controllers/App/ExpenseController.php',
            "if (\$nuevo === 'approved' && \$model->requires_receipt_snapshot && \$model->receipt_document_id === null) {",
        ],

        'un documento decidido a mano deja su fila de revisión' => [
            function () use ($tenantId): int {
                $decididos = DB::table('documents')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('review_status', ['in_review', 'rejected'])
                    ->pluck('id');

                return $decididos
                    ->reject(fn ($id): bool => DB::table('document_reviews')->where('document_id', $id)->exists())
                    ->count();
            },
            'app/Http/Controllers/App/DocumentController.php',
            "DB::table('document_reviews')->insert([",
        ],

        'los VIN sembrados son VIN' => [
            // Inventados, pero BIEN FORMADOS: diecisiete caracteres, sin I, O
            // ni Q, y con el dígito de control cuadrado. Cuando no lo eran, la
            // demostración escondía la pantalla entera que decodifica el VIN —
            // ninguno pasaba la comprobación, así que el formulario no
            // rellenaba nunca marca ni año.
            function () use ($tenantId): int {
                $malos = 0;

                foreach (['trucks', 'trailers'] as $tabla) {
                    $vins = DB::table($tabla)
                        ->where('tenant_id', $tenantId)
                        ->whereNotNull('vin')
                        ->pluck('vin');

                    foreach ($vins as $vin) {
                        if (! Vin::sumaBien((string) $vin)) {
                            $malos++;
                        }
                    }
                }

                return $malos;
            },
            'app/Support/Equipment/Vin.php',
            'public static function sumaBien(string $vin): bool',
        ],

        'las distancias entre ejes cuadran con el número de ejes' => [
            // Con cinco ejes hay cuatro huecos. Ni tres ni seis: la fórmula
            // federal del puente se calcula sobre esas distancias, y un
            // conjunto a medias no sirve para calcular nada mientras parece un
            // dato. `EquipmentController::validated()` rechaza guardarlo, así
            // que sembrarlo sería sembrar lo que la aplicación no deja hacer.
            function () use ($tenantId): int {
                $malas = 0;

                foreach ([['trucks', AxleSpacings::CAMION], ['trailers', AxleSpacings::REMOLQUE]] as [$tabla, $tipo]) {
                    $unidades = DB::table($tabla)
                        ->where('tenant_id', $tenantId)
                        ->get(['id', 'axle_count']);

                    $todas = AxleSpacings::deVarias($tipo, $unidades->pluck('id')->map(fn ($v): string => (string) $v)->all());

                    foreach ($unidades as $u) {
                        $huecos = $todas[(string) $u->id] ?? [];

                        if ($huecos !== [] && ! AxleSpacings::cuadran(
                            $u->axle_count === null ? null : (int) $u->axle_count,
                            $huecos,
                        )) {
                            $malas++;
                        }
                    }
                }

                return $malas;
            },
            'app/Support/Equipment/AxleSpacings.php',
            'public static function cuadran(?int $ejes, array $pulgadas): bool',
        ],

        'ningún conjunto cabe peor que su propia cadena de ejes' => [
            // El parachoques delantero y el trasero no pueden estar más cerca
            // que el primer eje y el último: los dos voladizos van por fuera
            // de los ejes.
            //
            // La primera versión de este sembrado tomó las cifras de una hoja
            // real y las pegó a otro conjunto: 68'5" de parachoques a
            // parachoques en una combinación cuya cadena mide 69'5". La
            // pantalla lo enseñó sin quejarse, y un permiso pedido con ese par
            // se cae en la ventanilla.
            function () use ($tenantId): int {
                $malas = 0;

                $filas = DB::table('equipment_combo_spacings')
                    ->where('tenant_id', $tenantId)
                    ->whereNull('deleted_at')
                    ->whereNotNull('bumper_to_bumper_inches')
                    ->get();

                foreach ($filas as $fila) {
                    $total = ComboSpacing::total(ComboSpacing::cadena(
                        (int) DB::table('trucks')->where('id', $fila->truck_id)->value('axle_count'),
                        AxleSpacings::de(AxleSpacings::CAMION, (string) $fila->truck_id),
                        (int) $fila->drive_to_trailer_inches,
                        (int) DB::table('trailers')->where('id', $fila->trailer_id)->value('axle_count'),
                        AxleSpacings::de(AxleSpacings::REMOLQUE, (string) $fila->trailer_id),
                    ));

                    if ($total !== null && (int) $fila->bumper_to_bumper_inches < $total) {
                        $malas++;
                    }
                }

                return $malas;
            },
            'app/Http/Controllers/App/ComboSpacingController.php',
            'private function exigeQueQuepaEnSiMismo(',
        ],

        'un camión lleva un tipo de camión' => [
            // El formulario ya solo ofrece los de su categoría. Sembrar un
            // tractor con tipo «Lowboy» dejaría en la demostración la ficha
            // exacta que el alta impide crear.
            function () use ($tenantId): int {
                $malas = 0;

                foreach ([['trucks', 'truck'], ['trailers', 'trailer']] as [$tabla, $categoria]) {
                    $malas += DB::table($tabla.' as u')
                        ->join('equipment_types as t', 't.id', '=', 'u.equipment_type_id')
                        ->where('u.tenant_id', $tenantId)
                        ->where('t.category', '!=', $categoria)
                        ->count();
                }

                return $malas;
            },
            'app/Http/Controllers/App/EquipmentController.php',
            "->where('category', \$type === 'trucks' ? 'truck' : 'trailer')",
        ],

        'la demostración enseña las tres propiedades' => [
            // Propia, arrendada y en arrendamiento con opción a compra. Si
            // todo fuera propio, el arrendador y la fecha de vencimiento no se
            // verían en ninguna ficha, y la primera vez que alguien los mirara
            // sería en producción.
            function () use ($tenantId): int {
                $vistas = collect(['trucks', 'trailers'])
                    ->flatMap(fn (string $t): array => DB::table($t)
                        ->where('tenant_id', $tenantId)
                        ->pluck('ownership')
                        ->all())
                    ->unique();

                return collect(EquipmentOwnership::values())
                    ->reject(fn (string $v): bool => $vistas->contains($v))
                    ->count();
            },
            'app/Enums/EquipmentOwnership.php',
            'case LeaseToOwn',
        ],

        'nadie parado ni de baja lleva una carga en curso' => [
            // Ni en espera ni de baja se conduce. Sembrarlo dejaría una carga
            // que dice que tiene conductor mientras el conductor no puede
            // salir, y `Guards::forDispatch()` la bloquea: es un estado que
            // ninguna ruta puede producir.
            function () use ($tenantId): int {
                return DB::table('load_assignments as a')
                    ->join('drivers as d', 'd.id', '=', 'a.driver_id')
                    ->join('loads as l', 'l.id', '=', 'a.load_id')
                    ->where('a.tenant_id', $tenantId)
                    ->whereNull('a.unassigned_at')
                    ->whereNull('a.deleted_at')
                    ->whereIn('d.status', Employment::bloqueantes())
                    ->whereNotIn('l.status', ['delivered', 'pod_received', 'invoiced', 'paid', 'cancelled'])
                    ->count();
            },
            'app/Support/Drivers/Employment.php',
            'public static function bloqueantes(): array',
        ],

        'un conductor de baja no retiene su camión' => [
            // Un camión atado a alguien que ya no trabaja aquí no se le puede
            // dar a nadie —la regla de «un camión, un conductor» lo impide— y
            // la flota se queda con un camión fantasma.
            function () use ($tenantId): int {
                $deBaja = DB::table('drivers')
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'terminated')
                    ->pluck('id')
                    ->map(fn ($v): string => (string) $v)
                    ->all();

                if ($deBaja === []) {
                    return 0;
                }

                return count(StandingAssignment::deConductores($tenantId, $deBaja));
            },
            'app/Support/Fleet/StandingAssignment.php',
            'public static function terminarVigentes(',
        ],

        'todo estado de empleo trae su motivo escrito' => [
            // La nota es obligatoria al cambiarlo. Sembrarlo vacío enseñaría el
            // estado que la aplicación no deja crear.
            function () use ($tenantId): int {
                return DB::table('drivers')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('status', ['on_hold', 'terminated'])
                    ->where(fn ($q) => $q->whereNull('status_note')->orWhere('status_note', ''))
                    ->count();
            },
            'app/Http/Controllers/App/DriverEmploymentController.php',
            "__('drivers.employment.noteRequired')",
        ],

        'el equipo habitual no se solapa' => [
            // Un conductor con dos equipos a la vez deja «¿cuál es su camión?»
            // con dos respuestas; un camión con dos conductores es un estado
            // que no existe en la calle. La regla no la puede sostener MySQL
            // —no hay restricción de exclusión— así que se comprueba sobre la
            // base sembrada.
            function () use ($tenantId): int {
                $filas = DB::table('driver_equipment_assignments')
                    ->where('tenant_id', $tenantId)
                    ->whereNull('deleted_at')
                    ->get(['driver_id', 'truck_id', 'starts_on', 'ends_on']);

                $malas = 0;

                foreach ($filas as $a) {
                    foreach ($filas as $b) {
                        if ($a === $b) {
                            continue;
                        }

                        $mismo = $a->driver_id === $b->driver_id || $a->truck_id === $b->truck_id;

                        if (! $mismo) {
                            continue;
                        }

                        $solapan = ($a->ends_on === null || $a->ends_on >= $b->starts_on)
                            && ($b->ends_on === null || $b->ends_on >= $a->starts_on);

                        if ($solapan) {
                            $malas++;
                        }
                    }
                }

                return $malas;
            },
            'app/Support/Fleet/StandingAssignment.php',
            'public static function choques(',
        ],

        'las paradas sembradas se pueden poner en el mapa' => [
            // Sin coordenadas el mapa del tablero no tiene un solo PIN que
            // pintar, y la columna del medio de la pantalla que se mira todo el
            // día es un rectángulo gris.
            function () use ($tenantId): int {
                return DB::table('load_stops as s')
                    ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
                    ->where('s.tenant_id', $tenantId)
                    ->whereNull('s.deleted_at')
                    ->whereNull('s.latitude')
                    ->whereNull('cl.latitude')
                    ->count();
            },
            'app/Http/Controllers/App/BoardController.php',
            'private function paradasEnElMapa(',
        ],

        'una carga que ya rodó tiene camión' => [
            function () use ($tenantId): int {
                return DB::table('loads')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('status', ['dispatched', 'in_transit', 'delivered', 'pod_received', 'invoiced', 'paid'])
                    ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                        ->from('load_assignments')
                        ->whereColumn('load_assignments.load_id', 'loads.id')
                        ->whereNotNull('load_assignments.truck_id'))
                    ->count();
            },
            'app/Support/Loads/Guards.php',
            'noTruck',
        ],

        'una carga lista de permisos tiene su evaluación' => [
            fn (): int => DB::table('loads')
                ->where('tenant_id', $tenantId)
                ->whereNotNull('oversize_validated_at')
                ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                    ->from('oversize_evaluations')
                    ->whereColumn('oversize_evaluations.load_id', 'loads.id'))
                ->count(),
            'app/Http/Controllers/App/PermitController.php',
            'if ($evaluacion === null) {',
        ],

        'una carga que rodó y necesita papeles los tiene aprobados' => [
            // Quién necesita papeles lo decide `NeedsPapers` y no un `if`
            // escrito aquí: preguntar solo por `is_oversize` era el defecto de
            // su propio lote, y repetirlo en el guardián lo devolvería.
            fn (): int => DB::table('loads')
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['dispatched', 'in_transit', 'delivered', 'pod_received', 'invoiced', 'paid'])
                ->tap(static fn ($q) => NeedsPapers::enConsulta($q))
                ->whereNull('permit_ready_approved_at')
                ->count(),
            'app/Support/Loads/Guards.php',
            'permitNotApproved',
        ],

        'una carga que ya rodó tiene conductor' => [
            fn (): int => DB::table('loads')
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['dispatched', 'in_transit', 'delivered', 'pod_received', 'invoiced', 'paid'])
                ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                    ->from('load_assignments')
                    ->whereColumn('load_assignments.load_id', 'loads.id')
                    ->whereNotNull('load_assignments.driver_id')
                    ->whereNull('load_assignments.unassigned_at'))
                ->count(),
            'app/Support/Loads/Guards.php',
            'noDriver',
        ],

        'un conductor asignado trabaja para el transportista de la carga' => [
            function () use ($tenantId): int {
                $malas = 0;

                $asignaciones = DB::table('load_assignments as a')
                    ->join('loads as l', 'l.id', '=', 'a.load_id')
                    ->where('a.tenant_id', $tenantId)
                    ->whereNotNull('a.driver_id')
                    ->whereNull('a.unassigned_at')
                    ->whereNull('a.deleted_at')
                    ->whereNotNull('l.carrier_id')
                    ->get(['a.driver_id', 'l.carrier_id']);

                foreach ($asignaciones as $fila) {
                    $trabaja = DB::table('driver_carrier_relationships')
                        ->where('driver_id', $fila->driver_id)
                        ->where('carrier_id', $fila->carrier_id)
                        ->whereNull('deleted_at')
                        ->exists();

                    if (! $trabaja) {
                        $malas++;
                    }
                }

                return $malas;
            },
            'app/Http/Controllers/App/LoadAssignmentController.php',
            'driverWrongCarrier',
        ],
    ];
}

/**
 * Lo que la demostración rompe A PROPÓSITO, con su motivo.
 *
 * Mismo patrón que `ACOTAN_SIN_DECIRLO` y `Reachable::NO_SE_PRODUCEN`: la
 * deuda que queda está contada, con su razón, y el guardián falla si aparece
 * una nueva sin declarar o si una declarada deja de ser cierta.
 *
 * @var array<string, string>
 */
const ROTAS_A_PROPOSITO = [
    'una carga que rodó y necesita papeles los tiene aprobados' => 'La misma cadena que falta, por el otro extremo: GD-24011 es de SOBREPESO —no sobredimensión— y el sembrador solo firma las marcadas `is_oversize`, que es el hueco exacto que `NeedsPapers` vino a cerrar. `Guards::forDispatch()` devuelve `permitNotApproved` para ella, así que facturada no pudo llegar. Firmarla sin evaluación sería cambiar una incoherencia por otra: se arregla cuando se siembre la cadena de permisos entera.',
    'una carga lista de permisos tiene su evaluación' => 'Las tres cargas sobredimensionadas salen firmadas —`oversize_validated_at` y `permit_ready_approved_at`— y la base tiene cero evaluaciones, cero permisos, cero escoltas y cero reglas estatales. `PermitController::validate()` exige una evaluación previa y `approveReady()` exige además que `Papers::faltan()` no encuentre nada: el estado no lo escribe ninguna ruta. Sembrar la cadena entera —reglas por estado, evaluación con sus entradas, validación, permisos con su documento y escoltas— es un lote por sí solo, y hasta entonces quitar la firma dejaría tres cargas despachadas y pagadas que no pudieron despacharse. Queda contado aquí para que no se olvide.',
];

/* ── Lo que tiene que cumplirse ──────────────────────────────────────────── */

it('la demostración no siembra estados que la aplicación prohíbe', function (): void {
    $tenantId = sembrarDemostracion();

    $rotas = [];

    foreach (invariantesDeLaDemostracion($tenantId) as $nombre => [$contar]) {
        if (array_key_exists($nombre, ROTAS_A_PROPOSITO)) {
            continue;
        }

        $cuantas = $contar();

        if ($cuantas > 0) {
            $rotas[] = "{$nombre} — {$cuantas} fila(s) no cumplen";
        }
    }

    expect($rotas)->toBe(
        [],
        "La demostración enseña estados que ninguna ruta de la aplicación puede producir:\n  ".
        implode("\n  ", $rotas),
    );
});

it('cada invariante sigue siendo una regla de la aplicación', function (): void {
    // Un invariante que sobrevive a su regla es cobertura falsa: se ve verde y
    // no exige nada que nadie exija.
    foreach (invariantesDeLaDemostracion('sin-empresa') as $nombre => [, $fichero, $aguja]) {
        $fuente = Source::sinComentarios(base_path($fichero));

        test()->assertStringContainsString(
            $aguja,
            $fuente,
            "«{$nombre}» dice que la aplicación lo exige en {$fichero} y ahí ya no está.",
        );
    }
});

it('lo roto a propósito sigue roto, y está entre los invariantes', function (): void {
    // Las dos direcciones. Si alguien siembra la cadena de permisos, esta
    // entrada sobra y hay que quitarla; y si alguien inventa un nombre que no
    // corresponde a ningún invariante, la declaración no protege nada.
    $nombres = array_keys(invariantesDeLaDemostracion('sin-empresa'));

    foreach (array_keys(ROTAS_A_PROPOSITO) as $declarada) {
        test()->assertContains(
            $declarada,
            $nombres,
            "«{$declarada}» está declarada como rota y no es ninguno de los invariantes.",
        );
    }
});

it('cada rotura declarada dice por qué sigue así', function (): void {
    foreach (ROTAS_A_PROPOSITO as $nombre => $motivo) {
        expect(strlen($motivo))->toBeGreaterThan(
            120,
            "{$nombre}: el motivo tiene que decir qué falta y por qué no se arregla hoy.",
        );
    }
});

/* ── El sembrador también es un productor ────────────────────────────────── */

it('la demostración no siembra ningún valor declarado imposible', function (): void {
    // `Reachable` pregunta «¿puede la APLICACIÓN escribir este valor?» y lo
    // contesta leyendo el código de la aplicación. El sembrador también
    // escribe valores, y no estaba contado: sembraba
    // `documents.review_status = 'expired'`, que no escribe nadie, y con eso
    // la opción muerta del filtro devolvía una fila en vez de cero. Nadie llegó
    // a ver el resultado vacío que habría levantado la pregunta.
    $tenantId = sembrarDemostracion();

    $colados = [];

    foreach (Reachable::NO_SE_PRODUCEN as $lista => $imposibles) {
        [$tabla, $columna] = Reachable::TABLAS[$lista] ?? [null, null];

        if ($tabla === null) {
            continue;
        }

        foreach (array_keys($imposibles) as $valor) {
            $cuantas = DB::table($tabla)
                ->where('tenant_id', $tenantId)
                ->where($columna, $valor)
                ->count();

            if ($cuantas > 0) {
                $colados[] = "{$tabla}.{$columna} = '{$valor}' ({$cuantas} fila(s))";
            }
        }
    }

    expect($colados)->toBe(
        [],
        'La demostración siembra valores que el registro declara que nadie puede escribir, '.
        "así que un filtro muerto parece vivo:\n  ".implode("\n  ", $colados),
    );
});

/* ── Y lo que la demostración sí tiene que enseñar ───────────────────────── */

it('la cola de revisión de gastos existe en la demostración', function (): void {
    // Los once gastos estaban en `approved`: los botones de aprobar y rechazar
    // no se pintaban nunca, así que la pantalla donde vive la regla del recibo
    // no se veía en la demostración.
    $tenantId = sembrarDemostracion();

    expect(DB::table('expenses')->where('tenant_id', $tenantId)->where('status', 'submitted')->count())
        ->toBeGreaterThan(0, 'Sin un gasto pendiente, la demostración no enseña la cola de revisión.');
});

it('los documentos decididos tienen historial', function (): void {
    $tenantId = sembrarDemostracion();

    expect(DB::table('document_reviews')->where('tenant_id', $tenantId)->count())
        ->toBeGreaterThan(0, 'Documentos decididos y ninguna revisión: la ficha sale sin quién ni cuándo.');
});
