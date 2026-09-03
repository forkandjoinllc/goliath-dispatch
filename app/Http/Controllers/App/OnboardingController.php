<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Support\InertiaPage;
use App\Support\Onboarding\Readiness;
use App\Support\Onboarding\Transitions;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

/**
 * La cola de incorporación: a quién le falta qué para poder llevar carga.
 *
 * Las transiciones existían desde hace lotes —enviar, revisar, aprobar, pedir
 * correcciones, suspender, reinstaurar— y `carriers.onboarding_status` se
 * escribía. Lo que no había era la COLA: el sitio donde quien lleva
 * cumplimiento ve su trabajo del día sin abrir siete fichas.
 *
 * ESTA PANTALLA NO INVENTA NINGUNA REGLA. Lo que bloquea a un transportista lo
 * decide `Guards::carrierBlocking()`, que es exactamente la misma función que
 * consulta la puerta de despacho. Si aquí dijera «listo» y el despacho dijera
 * «bloqueado», el problema no sería la discrepancia: sería que alguien confía
 * en la que se equivoque.
 *
 * DOS COSAS DISTINTAS, SEPARADAS: lo que BLOQUEA (falta un documento, la
 * incorporación no está aprobada) y lo que AVISA (la verificación de FMCSA está
 * fuera de plazo). Mezclarlas haría que un aviso pareciera una puerta cerrada,
 * o —peor— que una puerta cerrada pareciera un aviso.
 *
 * Y UNA SECCIÓN QUE NO EXISTÍA EN NINGÚN SITIO: los **aprobados con algo
 * vencido**. Un transportista al que se le aprobó la incorporación en marzo y
 * se le venció el seguro en julio sigue en `approved`, así que ninguna lista
 * por estado lo enseña — y sin embargo su camión no puede salir. Es el caso que
 * esta cola existe para encontrar.
 */
final class OnboardingController
{
    use InertiaPage;

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'carrier:onboarding:read', null, $policy);

        $this->usesDictionary($request, ['onboarding', 'carriers', 'documents', 'signature', 'nav', 'common', 'validation']);

        // El filtro ya NO es por estado. En un tablero las columnas SON los
        // estados, así que filtrar por estado es enseñar una sola columna: una
        // pregunta que el propio tablero ya contesta de un vistazo.
        //
        // Lo que no contesta —y es lo que se pregunta quien lleva cumplimiento—
        // es quién está atascado. `blocked` incluye el caso que esta pantalla
        // existe para encontrar: el aprobado con un documento vencido, que
        // ninguna lista por estado enseña porque sigue en `approved`.
        $preparacion = (string) $request->query('ready', '');
        $preparacion = in_array($preparacion, self::PREPARACION, true) ? $preparacion : '';

        $transportistas = $this->scoped($actor, $scope)
            ->leftJoin('carrier_onboardings as o', 'o.carrier_id', '=', 'c.id')
            ->orderByRaw(self::ORDEN)
            ->orderBy('c.legal_name')
            ->limit(300)
            ->get([
                'c.id', 'c.legal_name', 'c.dot_number', 'c.mc_number', 'c.onboarding_status',
                'c.created_at', 'c.approved_at', 'c.suspended_at', 'c.suspension_reason',
                'c.last_activity_at',
                'o.submitted_at', 'o.review_started_at', 'o.corrections_requested_at',
                'o.correction_notes', 'o.rejection_reason',
            ]);

        // Los tres permisos, UNA vez. Se comprueban sin contexto de
        // transportista igual que el bloque `can` de siempre, y por la misma
        // razón: en los ámbitos que ven más de un transportista la respuesta no
        // depende de cuál sea. Y da igual que se afine o no — esto solo decide
        // qué se PINTA. El servidor vuelve a comprobarlo todo en la transición.
        $permisos = [];

        foreach (Transitions::graph() as $regla) {
            $permisos[$regla['permission']] ??= $checker
                ->can($actor, $regla['permission'], null, $policy)->allowed;
        }

        $filas = $transportistas->map(function (object $c) use ($actor, $permisos): array {
            $estado = Readiness::forCarrier((string) $actor->tenantId, (string) $c->id);

            return [
                'id' => (string) $c->id,
                'name' => (string) $c->legal_name,
                'dot' => $c->dot_number,
                'mc' => $c->mc_number,
                'status' => (string) $c->onboarding_status,
                'submittedAt' => $this->minute($c->submitted_at),
                'reviewStartedAt' => $this->minute($c->review_started_at),
                'correctionsRequestedAt' => $this->minute($c->corrections_requested_at),
                'correctionNotes' => $c->correction_notes,
                'rejectionReason' => $c->rejection_reason,
                'approvedAt' => $this->minute($c->approved_at),
                'suspendedAt' => $this->minute($c->suspended_at),
                'suspensionReason' => $c->suspension_reason,
                // Desde cuándo espera. Se calcula de la marca que corresponde a
                // su estado: quien lleva la cola quiere saber cuánto lleva ESTE
                // transportista parado en ESTE punto, no cuándo se dio de alta.
                'waitingSince' => $this->esperandoDesde($c),
                'blocking' => $estado['blocking'],
                'warnings' => $estado['warnings'],
                'missingDocuments' => $estado['missingDocuments'],
                'requiredDocuments' => $estado['requiredDocuments'],
                'approvedDocuments' => $estado['approvedDocuments'],
                'signature' => $estado['signature'],
                'fmcsaCheckedAt' => $estado['fmcsaCheckedAt'],
                'canHaul' => $estado['blocking'] === [] && $estado['missingDocuments'] === [],
                'lastActivityAt' => $this->minute($c->last_activity_at),
                // A dónde puede ir ESTA tarjeta. Sale del grafo del servidor, no
                // de una copia en la pantalla: el tablero no puede ofrecer un
                // movimiento que la transición vaya a negar porque no sabe
                // ninguno que ella no le haya dicho.
                'moves' => $this->movimientos((string) $c->onboarding_status, $permisos),
            ];
        })->all();

        $visibles = $preparacion === ''
            ? $filas
            : array_values(array_filter(
                $filas,
                static fn (array $f): bool => $preparacion === 'ready' ? $f['canHaul'] : ! $f['canHaul'],
            ));

        return Inertia::render('App/Onboarding/Index', [
            'carriers' => $visibles,
            // Una columna por estado, en el orden del recorrido y no en el
            // alfabético: `draft` a la izquierda y los dos terminales al final.
            'columns' => self::COLUMNAS,
            // Aprobados que aun así no pueden llevar carga. Ninguna lista por
            // estado los enseña: siguen en `approved`, y sin embargo su camión
            // no sale. Es el caso que esta pantalla existe para encontrar.
            'blockedApproved' => array_values(array_filter(
                $filas,
                static fn (array $f): bool => $f['status'] === 'approved' && ! $f['canHaul'],
            )),
            'filters' => ['ready' => $preparacion],
            // Los recuentos salen de las filas YA calculadas y no de una
            // consulta aparte. Con una consulta `group by` el chip diría un
            // número y el tablero enseñaría otro en cuanto el filtro estuviera
            // puesto — dos respuestas a la misma pregunta en la misma pantalla.
            'counts' => [
                'all' => count($filas),
                'ready' => count(array_filter($filas, static fn (array $f): bool => $f['canHaul'])),
                'blocked' => count(array_filter($filas, static fn (array $f): bool => ! $f['canHaul'])),
            ],
            'can' => [
                'review' => $checker->can($actor, 'carrier:onboarding:review', null, $policy)->allowed,
                'approve' => $checker->can($actor, 'carrier:onboarding:approve', null, $policy)->allowed,
            ],
        ]);
    }

    /**
     * El orden de la cola: primero lo que espera a que alguien haga algo.
     *
     * `submitted` y `under_review` arriba porque son trabajo de la casa;
     * `corrections_required` después, que es trabajo del transportista;
     * `approved` y los terminales al final. Ordenar alfabéticamente pondría
     * `approved` primero y enterraría lo urgente.
     */
    private const ORDEN = "field(c.onboarding_status, 'submitted', 'under_review', 'corrections_required', 'draft', 'suspended', 'approved', 'rejected')";

    /** @var list<string> */
    private const PREPARACION = ['ready', 'blocked'];

    /**
     * El orden de las columnas del tablero.
     *
     * Es el recorrido del alta, de izquierda a derecha, con los dos terminales
     * al final. NO se deriva de `OnboardingStatus::cases()`: el orden de un enum
     * es el orden en que alguien escribió los casos, y que hoy coincida no es
     * una razón para que el tablero dependa de ello.
     *
     * @var list<string>
     */
    private const COLUMNAS = [
        'draft', 'submitted', 'under_review', 'corrections_required',
        'approved', 'suspended', 'rejected',
    ];

    /**
     * Los movimientos legales de una tarjeta, con el permiso ya resuelto.
     *
     * @param  array<string, bool>  $permisos
     * @return list<array{action: string, to: string, reason: bool}>
     */
    private function movimientos(string $estado, array $permisos): array
    {
        $salida = [];

        foreach (Transitions::graph() as $accion => $regla) {
            if (! in_array($estado, $regla['from'], true)) {
                continue;
            }

            if (($permisos[$regla['permission']] ?? false) !== true) {
                continue;
            }

            $salida[] = [
                'action' => $accion,
                'to' => $regla['to'],
                'reason' => $regla['reason'],
            ];
        }

        return $salida;
    }

    private function scoped(Actor $actor, Scope $scope): Builder
    {
        $consulta = DB::table('carriers as c')
            ->where('c.tenant_id', $actor->tenantId)
            ->whereNull('c.deleted_at');

        return match ($scope) {
            Scope::Platform, Scope::Tenant, Scope::Assigned => $consulta,
            Scope::Carrier => $actor->carrierId === null
                ? $consulta->whereRaw('1 = 0')
                : $consulta->where('c.id', $actor->carrierId),
            default => $consulta->whereRaw('1 = 0'),
        };
    }

    private function esperandoDesde(object $c): ?string
    {
        $marca = match ((string) $c->onboarding_status) {
            'submitted' => $c->submitted_at,
            'under_review' => $c->review_started_at ?? $c->submitted_at,
            'corrections_required' => $c->corrections_requested_at,
            'approved' => $c->approved_at,
            'suspended' => $c->suspended_at,
            default => $c->created_at,
        };

        return $this->minute($marca ?? $c->created_at);
    }

    private function minute(mixed $valor): ?string
    {
        return $valor === null ? null : substr((string) $valor, 0, 16);
    }
}
