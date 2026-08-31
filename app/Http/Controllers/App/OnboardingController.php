<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\OnboardingStatus;
use App\Enums\Scope;
use App\Support\InertiaPage;
use App\Support\Onboarding\Readiness;
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

        $estado = (string) $request->query('status', '');
        $estados = array_map(static fn (OnboardingStatus $s): string => $s->value, OnboardingStatus::cases());
        $estado = in_array($estado, $estados, true) ? $estado : '';

        $transportistas = $this->scoped($actor, $scope)
            ->leftJoin('carrier_onboardings as o', 'o.carrier_id', '=', 'c.id')
            ->when($estado !== '', fn (Builder $q) => $q->where('c.onboarding_status', $estado))
            ->orderByRaw(self::ORDEN)
            ->orderBy('c.legal_name')
            ->limit(300)
            ->get([
                'c.id', 'c.legal_name', 'c.dot_number', 'c.mc_number', 'c.onboarding_status',
                'c.created_at', 'c.approved_at', 'c.suspended_at', 'c.suspension_reason',
                'o.submitted_at', 'o.review_started_at', 'o.corrections_requested_at',
                'o.correction_notes', 'o.rejection_reason',
            ]);

        $filas = $transportistas->map(function (object $c) use ($actor): array {
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
            ];
        })->all();

        return Inertia::render('App/Onboarding/Index', [
            'carriers' => $filas,
            // Aprobados que aun así no pueden llevar carga. Ninguna lista por
            // estado los enseña: siguen en `approved`, y sin embargo su camión
            // no sale. Es el caso que esta pantalla existe para encontrar.
            'blockedApproved' => array_values(array_filter(
                $filas,
                static fn (array $f): bool => $f['status'] === 'approved' && ! $f['canHaul'],
            )),
            'filters' => ['status' => $estado],
            'statuses' => $estados,
            'counts' => $this->scoped($actor, $scope)
                ->selectRaw('c.onboarding_status as estado, count(*) as total')
                ->groupBy('c.onboarding_status')
                ->pluck('total', 'estado')
                ->all(),
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
