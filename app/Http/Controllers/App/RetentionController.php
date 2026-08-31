<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Support\InertiaPage;
use App\Support\Platform\ScheduledRuns;
use App\Support\Retention\Holds;
use App\Support\Retention\Policy;
use App\Support\Retention\Sweeper;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Retención y bloqueo legal.
 *
 * La pantalla de configuración lleva desde el primer día diciendo que los
 * registros se archivan a los N meses y se purgan a los M años. Era falso: las
 * tres cifras se guardaban, se pintaban, y ninguna línea las leía. Treinta
 * tablas llevan `legal_hold` y treinta y cuatro `purge_eligible_at`, y nadie
 * escribía ninguna.
 *
 * Esta pantalla hace dos cosas y conviene no confundirlas:
 *
 *  - **Los bloqueos**, que es lo que se usa un martes cualquiera. Llega una
 *    reclamación por una carga y hay que decir «esto no se toca» antes de que
 *    la política haga su trabajo y borre la prueba.
 *  - **El barrido**, que es lo que pasa solo. Aquí solo se mira: qué se
 *    archivaría y qué se purgaría hoy, en seco, y qué hizo la última vez.
 *
 * NO HAY BOTÓN DE PURGAR. A propósito. Purgar es un DELETE que no se deshace, y
 * un botón así en una pantalla web es un botón que alguien pulsa por curiosidad
 * un viernes. La purga la ejecuta el planificador, y solo si alguien encendió
 * `RETENTION_PURGE_ENABLED` en el servidor — una decisión que se toma con las
 * dos manos, no con el ratón.
 */
final class RetentionController
{
    use InertiaPage;

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'retention:manage', null, $policy);

        $this->usesDictionary($request, ['retention', 'nav', 'common', 'validation']);

        $tenantId = (string) $actor->tenantId;
        $politica = Policy::forTenant($tenantId);

        return Inertia::render('App/Retention/Index', [
            'policy' => [
                'operationalActiveMonths' => $politica->operationalActiveMonths,
                'operationalPurgeYears' => $politica->operationalPurgeYearsAfterArchive,
                'financialRetentionYears' => $politica->financialRetentionYears,
                // Si la purga permanente está encendida en ESTE servidor. La
                // pantalla lo dice porque cambia por completo lo que significa
                // la lista de abajo: con ella apagada es una previsión, con ella
                // encendida es lo que va a pasar el domingo.
                'purgeEnabled' => (bool) config('retention.purge_enabled'),
            ],
            'holds' => Holds::active($tenantId)->map(fn (object $h): array => [
                'id' => (string) $h->id,
                'name' => (string) $h->name,
                'reason' => (string) $h->reason,
                'scopeType' => (string) $h->scope_type,
                'entityType' => $h->entity_type === null ? null : (string) $h->entity_type,
                'entityId' => $h->entity_id === null ? null : (string) $h->entity_id,
                'matterReference' => $h->matter_reference === null ? null : (string) $h->matter_reference,
                'appliedAt' => substr((string) $h->applied_at, 0, 16),
                'appliedBy' => $this->nombre($h->applied_by_user_id),
            ])->values()->all(),
            // En seco. Nadie debería encender la purga sin haber leído esto.
            'wouldPurge' => collect(Sweeper::purgeDryRun($tenantId))
                ->map(fn (array $r, string $tabla): array => [
                    'entity' => $tabla,
                    'candidates' => $r['candidates'],
                    'skipped' => $r['skipped'],
                ])->values()->all(),
            'runs' => $this->lastRuns($tenantId),
            // Cuándo corrió el barrido POR ÚLTIMA VEZ, aunque no hiciera nada.
            //
            // Sin esto la pantalla mentía, y de la peor manera: un barrido que
            // corre y no encuentra nada que archivar no escribe ninguna fila en
            // `retention_jobs` —no hay nada que contar— así que la lista de
            // ejecuciones quedaba vacía y la pantalla decía «el barrido todavía
            // no ha corrido». Es falso: corrió, y no había trabajo. Para una
            // empresa nueva eso es el estado normal durante dos años, y durante
            // dos años la pantalla estaría diciéndole que su retención no
            // funciona.
            'lastSweep' => ScheduledRuns::summary(['retention:sweep'])[0] ?? null,
            'entities' => $this->entities(),
            'scopes' => Holds::SCOPES,
            'can' => [
                'hold' => $checker->can($actor, 'legalhold:manage', null, $policy)->allowed,
            ],
        ]);
    }

    public function storeHold(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'legalhold:manage', null, $policy);

        $datos = $request->validate([
            'name' => ['required', 'string', 'max:200'],
            // El motivo es OBLIGATORIO y largo. Un bloqueo sin motivo es un
            // bloqueo que dentro de tres años nadie sabe si puede levantar, y
            // entonces no se levanta nunca: la retención deja de funcionar por
            // acumulación de bloqueos que nadie se atreve a tocar.
            'reason' => ['required', 'string', 'min:10', 'max:4000'],
            'scope_type' => ['required', Rule::in(Holds::SCOPES)],
            'entity_type' => ['nullable', Rule::in(array_keys(Policy::ENTITIES))],
            'entity_id' => ['nullable', 'string', 'size:36'],
            'matter_reference' => ['nullable', 'string', 'max:120'],
        ]);

        if ($datos['scope_type'] !== 'tenant' && ($datos['entity_type'] ?? null) === null) {
            return back()->withErrors(['entity_type' => __('retention.errors.needsEntityType')]);
        }

        if ($datos['scope_type'] === 'record' && ($datos['entity_id'] ?? null) === null) {
            return back()->withErrors(['entity_id' => __('retention.errors.needsEntityId')]);
        }

        Holds::apply(
            actor: $actor,
            name: $datos['name'],
            reason: $datos['reason'],
            scopeType: $datos['scope_type'],
            entityType: $datos['entity_type'] ?? null,
            entityId: $datos['entity_id'] ?? null,
            matterReference: $datos['matter_reference'] ?? null,
        );

        return back()->with('success', __('retention.flash.held'));
    }

    public function releaseHold(Request $request, string $hold, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'legalhold:manage', null, $policy);

        $datos = $request->validate([
            // Levantar también exige explicación. Es el acto que vuelve a poner
            // en marcha el reloj de borrado sobre unas pruebas.
            'release_reason' => ['required', 'string', 'min:10', 'max:4000'],
        ]);

        if (! Holds::release($actor, $hold, $datos['release_reason'])) {
            return back()->withErrors(['release_reason' => __('retention.errors.holdNotFound')]);
        }

        return back()->with('success', __('retention.flash.released'));
    }

    /**
     * Las últimas ejecuciones, para saber si el barrido corre de verdad.
     *
     * @return list<array<string, mixed>>
     */
    private function lastRuns(string $tenantId): array
    {
        return DB::table('retention_jobs')
            ->where('tenant_id', $tenantId)
            ->orderByDesc('created_at')
            ->limit(25)
            ->get()
            ->map(static fn (object $j): array => [
                'id' => (string) $j->id,
                'action' => (string) $j->action,
                'entity' => (string) $j->entity_type,
                'status' => (string) $j->status,
                'candidates' => (int) $j->candidate_count,
                'processed' => (int) $j->processed_count,
                'skipped' => (int) $j->skipped_legal_hold_count,
                'at' => substr((string) $j->created_at, 0, 16),
            ])
            ->all();
    }

    /**
     * Los tipos que se pueden bloquear, con si además se pueden purgar.
     *
     * Lo segundo importa en pantalla: bloquear un `financial_snapshots` no
     * impide una purga que nunca iba a ocurrir, y decirlo evita que alguien crea
     * que hizo algo.
     *
     * @return list<array{key: string, class: string, purgeable: bool}>
     */
    private function entities(): array
    {
        $politica = new Policy(0, 0, 0);

        return collect(Policy::ENTITIES)
            ->map(fn (string $clase, string $tabla): array => [
                'key' => $tabla,
                'class' => $clase,
                'purgeable' => $politica->canPurge($tabla),
            ])
            ->values()
            ->all();
    }

    private function nombre(?string $userId): string
    {
        if ($userId === null) {
            return '—';
        }

        $u = DB::table('users')->where('id', $userId)->first(['first_name', 'last_name', 'email']);

        if ($u === null) {
            return '—';
        }

        return trim((string) $u->first_name.' '.(string) $u->last_name) ?: (string) $u->email;
    }
}
