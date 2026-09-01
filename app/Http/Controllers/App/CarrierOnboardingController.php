<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\AuditAction;
use App\Enums\OnboardingStatus;
use App\Enums\VerificationStatus;
use App\Models\Carrier;
use App\Services\Fmcsa\FmcsaVerifier;
use App\Support\Audit;
use App\Support\Fmcsa\Revalidation;
use App\Support\Onboarding\Transitions;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * El alta del transportista: mover el estado y verificar contra FMCSA.
 *
 * Cada transición pasa por tres puertas y las tres tienen que abrirse:
 *
 *  1. ¿Existe esa transición desde el estado actual? (Transitions)
 *  2. ¿Tiene el actor el permiso que esa transición exige, sobre ESTE
 *     transportista? (PermissionChecker con el registro en el contexto)
 *  3. ¿Trae el motivo escrito, si la transición lo exige?
 *
 * Y todas ellas en el servidor. La pantalla pinta solo los botones que
 * corresponden, pero eso es cortesía: quien mande la petición a mano se
 * encuentra con lo mismo.
 */
final class CarrierOnboardingController
{
    public function transition(
        Request $request,
        string $carrier,
        string $action,
        CurrentActor $current,
        PermissionChecker $checker,
    ): RedirectResponse {
        $actor = $current->require();
        $model = Carrier::query()->findOrFail($carrier);
        $context = new ResourceContext(tenantId: $model->tenant_id, carrierId: $model->id);

        $permission = Transitions::permission($action);

        if ($permission === null) {
            abort(404);
        }

        $checker->authorize($actor, $permission, $context, $current->policy());

        $onboarding = DB::table('carrier_onboardings')
            ->where('carrier_id', $model->id)
            ->whereNull('deleted_at')
            ->first();

        abort_if($onboarding === null, 404);

        $from = OnboardingStatus::from((string) $onboarding->status);

        if (! Transitions::allowedFrom($action, $from)) {
            // 422 y no 403: el permiso está bien, lo que no encaja es el estado.
            // Distinguirlos importa — con un 403 alguien iría a revisar permisos
            // durante una hora cuando el problema es que otra persona ya movió
            // el alta desde otra pestaña.
            throw ValidationException::withMessages([
                'action' => __('carriers.onboarding.invalidTransition', [
                    'from' => __("nav.status.onboarding.{$this->camel($from->value)}"),
                ]),
            ]);
        }

        $reason = trim((string) $request->input('reason', ''));

        if (Transitions::requiresReason($action) && $reason === '') {
            throw ValidationException::withMessages([
                'reason' => __('carriers.onboarding.reasonRequired'),
            ]);
        }

        $to = Transitions::target($action);
        $now = now();

        DB::transaction(function () use ($model, $onboarding, $from, $to, $action, $reason, $actor, $now): void {
            $update = ['status' => $to->value, 'updated_at' => $now];

            match ($action) {
                'submitted' => $update['submitted_at'] = $now,
                'under_review' => $update['review_started_at'] = $now,
                'corrections_required' => [
                    $update['corrections_requested_at'] = $now,
                    $update['correction_notes'] = $reason,
                ],
                'approved', 'rejected' => [
                    $update['decided_at'] = $now,
                    $update['decided_by_user_id'] = $actor->userId,
                    $update['rejection_reason'] = $action === 'rejected' ? $reason : null,
                ],
                default => null,
            };

            DB::table('carrier_onboardings')->where('id', $onboarding->id)->update($update);

            // El estado del transportista y el de su alta se mantienen a la par
            // porque los listados y los filtros leen el del transportista, y una
            // consulta que tuviera que unir las dos tablas para saber si puede
            // darle una carga sería a la vez lenta y fácil de olvidar.
            $carrierUpdate = [
                'onboarding_status' => $action === 'reinstate'
                    ? OnboardingStatus::UnderReview->value
                    : $to->value,
                'updated_at' => $now,
                'last_activity_at' => $now,
            ];

            if ($action === 'approved') {
                $carrierUpdate['approved_at'] = $now;
                $carrierUpdate['approved_by_user_id'] = $actor->userId;
                $carrierUpdate['suspended_at'] = null;
                $carrierUpdate['suspension_reason'] = null;
            }

            if ($action === 'suspended') {
                $carrierUpdate['suspended_at'] = $now;
                $carrierUpdate['suspension_reason'] = $reason;
            }

            if ($action === 'reinstate') {
                $carrierUpdate['suspended_at'] = null;
                $carrierUpdate['suspension_reason'] = null;
            }

            DB::table('carriers')->where('id', $model->id)->update($carrierUpdate);

            // El historial del alta es de solo-añadir por diseño: es lo que
            // responde «¿quién aprobó a este transportista y cuándo?» dos años
            // después, cuando la fila del alta ya lleva otro estado encima.
            DB::table('carrier_onboarding_events')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $model->tenant_id,
                'onboarding_id' => $onboarding->id,
                'from_status' => $from->value,
                'to_status' => $to->value,
                'actor_user_id' => $actor->auditUserId(),
                'reason' => $reason === '' ? null : $reason,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            Audit::record(
                $actor,
                AuditAction::OnboardingStatusChanged,
                entityType: 'carrier',
                entityId: $model->id,
                entityLabel: $model->legal_name,
                before: ['onboarding_status' => $from->value],
                after: ['onboarding_status' => $to->value],
                reason: $reason === '' ? null : $reason,
            );
        });

        return back()->with('success', __('carriers.onboarding.moved', [
            'status' => __("nav.status.onboarding.{$this->camel($to->value)}"),
        ]));
    }

    /**
     * Lanza la verificación FMCSA.
     *
     * Sin credenciales del proveedor esto NO llama a FMCSA: usa el adaptador
     * simulado, que se identifica como tal en la fila que escribe. Lo que no
     * hace, y es lo importante, es fingir que verificó.
     */
    public function verify(
        string $carrier,
        CurrentActor $current,
        PermissionChecker $checker,
        FmcsaVerifier $verifier,
    ): RedirectResponse {
        $actor = $current->require();
        $model = Carrier::query()->findOrFail($carrier);
        $context = new ResourceContext(tenantId: $model->tenant_id, carrierId: $model->id);

        $checker->authorize($actor, 'carrier:verification:run', $context, $current->policy());

        // La escritura de la comprobación vive en App\Support\Fmcsa\Revalidation,
        // que es también quien revalida cada N días desde el barrido. Estaba
        // copiada en tres sitios, y una copia es donde acaban difiriendo el
        // número de intento o el plazo de la siguiente — que fue justo lo que
        // pasó: aquí se programaba «dentro de un año» mientras el barrido daba
        // por caducado a los siete días.
        $result = Revalidation::runFor($model, $verifier);

        DB::table('carriers')->where('id', $model->id)->update([
            'last_activity_at' => now(),
            'updated_at' => now(),
        ]);

        return back()->with(
            $result->status === VerificationStatus::Verified ? 'success' : 'error',
            __('carriers.verification.finished', [
                'status' => __("nav.status.verification.{$this->camel($result->status->value)}"),
                'provider' => $verifier->name(),
            ]),
        );
    }

    /**
     * Anula manualmente el resultado de la verificación.
     *
     * Existe porque los datos de FMCSA a veces no coinciden con la realidad —un
     * cambio de razón social tarda semanas en propagarse— y bloquear a un
     * transportista legítimo por eso no es defendible. Lo que NO es negociable
     * es el rastro: motivo obligatorio, quién y cuándo, y una fila de auditoría
     * que nadie puede editar después.
     */
    public function override(
        Request $request,
        string $carrier,
        CurrentActor $current,
        PermissionChecker $checker,
    ): RedirectResponse {
        $actor = $current->require();
        $model = Carrier::query()->findOrFail($carrier);
        $context = new ResourceContext(tenantId: $model->tenant_id, carrierId: $model->id);

        $checker->authorize($actor, 'carrier:verification:override', $context, $current->policy());

        $validated = $request->validate([
            'reason' => ['required', 'string', 'min:10', 'max:2000'],
        ]);

        $now = now();
        $before = $this->enumValue($model->fmcsa_status);

        DB::transaction(function () use ($model, $validated, $actor, $now): void {
            DB::table('fmcsa_verifications')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $model->tenant_id,
                'carrier_id' => $model->id,
                'provider' => 'manual',
                'dot_number' => $model->dot_number,
                'mc_number' => $model->mc_number,
                'status' => VerificationStatus::ManuallyOverridden->value,
                'normalized' => json_encode([
                    'source' => 'manual override by an authorised user — not an FMCSA response',
                ]),
                'attempt' => 1 + (int) DB::table('fmcsa_verifications')
                    ->where('carrier_id', $model->id)->max('attempt'),
                'overridden_by_user_id' => $actor->auditUserId(),
                'override_reason' => $validated['reason'],
                'overridden_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            DB::table('carriers')->where('id', $model->id)->update([
                'fmcsa_status' => VerificationStatus::ManuallyOverridden->value,
                'last_activity_at' => $now,
                'updated_at' => $now,
            ]);
        });

        Audit::record(
            $actor,
            AuditAction::VerificationOverride,
            entityType: 'carrier',
            entityId: $model->id,
            entityLabel: $model->legal_name,
            before: ['fmcsa_status' => $before],
            after: ['fmcsa_status' => VerificationStatus::ManuallyOverridden->value],
            reason: $validated['reason'],
        );

        return back()->with('success', __('carriers.verification.overridden'));
    }

    /** `corrections_required` → `correctionsRequired`, que es como está en el diccionario. */
    private function camel(string $value): string
    {
        return Str::camel($value);
    }

    private function enumValue(mixed $value): ?string
    {
        return $value instanceof \BackedEnum ? (string) $value->value : ($value === null ? null : (string) $value);
    }
}
