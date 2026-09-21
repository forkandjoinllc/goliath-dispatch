<?php

declare(strict_types=1);

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
