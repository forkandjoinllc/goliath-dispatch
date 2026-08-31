<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Models\Load;
use App\Support\EnumValue;
use App\Support\InertiaPage;
use App\Support\Loads\LoadScope;
use App\Support\Loads\RateConfirmation;
use App\Support\Storage\DocumentStore;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * La confirmación de tarifa de una carga, y lo que el transportista contesta.
 *
 * Una sola pantalla para los dos lados, y no por ahorro: es LA MISMA pregunta
 * vista desde dos sillas. Despacho pregunta «¿aceptó?» y el transportista
 * pregunta «¿qué me están pidiendo y por cuánto?». Partirla en dos habría
 * obligado a mantener dos veces la misma tabla de decisiones.
 *
 * Lo que cambia según quién mire lo deciden los permisos, no la pantalla:
 * emitir necesita `load:financials:update` —quien pone la tarifa es quien puede
 * ponerla por escrito— y responder necesita `load:rateconf:respond`, que en la
 * matriz de roles solo tiene el transportista, con alcance de transportista.
 *
 * LO QUE NO VIAJA AL PDF: lo que la casa le cobra al cliente. Un papel para el
 * transportista lleva lo que se le paga a él; el margen de la casa no es asunto
 * suyo y meterlo ahí sería regalarlo en cada carga.
 */
final class RateConfirmationController
{
    use InertiaPage;

    public function show(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'load:read', null, $policy);

        $this->usesDictionary($request, ['loads', 'documents', 'nav', 'common', 'validation']);

        $carga = $this->findLoad($actor, $checker, $scope, $load);
        $confirmacion = RateConfirmation::current((string) $actor->tenantId, (string) $carga->id);

        $decisiones = DB::table('rate_confirmation_acceptances as a')
            ->leftJoin('users as u', 'u.id', '=', 'a.actor_user_id')
            ->where('a.tenant_id', $actor->tenantId)
            ->where('a.load_id', $carga->id)
            ->orderByDesc('a.decided_at')
            ->get([
                'a.id', 'a.decision', 'a.decision_reason', 'a.decided_at', 'a.document_sha256',
                'a.rated_amount_cents', 'a.ip_address', 'a.document_id',
                'u.first_name', 'u.last_name', 'u.email',
            ]);

        // ¿La decisión más reciente se tomó sobre el papel que hay ahora? Si
        // despacho reemitió con otra tarifa después de que el transportista
        // aceptara, lo aceptado ya no es lo vigente — y eso hay que decirlo, no
        // dejar una marca verde de «aceptado» sobre un papel que nadie vio.
        $ultima = $decisiones->first();
        $vigente = $ultima !== null
            && $confirmacion !== null
            && (string) $ultima->document_sha256 === (string) $confirmacion->sha256;

        return Inertia::render('App/Loads/RateConfirmation', [
            'load' => [
                'id' => (string) $carga->id,
                'number' => (string) $carga->load_number,
                'status' => EnumValue::of($carga->status),
                'carrierName' => $carga->carrier_id === null
                    ? null
                    : DB::table('carriers')->where('id', $carga->carrier_id)->value('legal_name'),
                'rateCents' => $carga->carrier_gross_rate_cents === null
                    ? null
                    : (int) $carga->carrier_gross_rate_cents,
            ],
            'confirmation' => $confirmacion === null ? null : [
                'documentId' => (string) $confirmacion->document_id,
                'sha256' => (string) $confirmacion->sha256,
                'issuedAt' => substr((string) $confirmacion->issued_at, 0, 16),
            ],
            'decisions' => $decisiones->map(fn (object $d): array => [
                'id' => (string) $d->id,
                'decision' => (string) $d->decision,
                'reason' => $d->decision_reason,
                'decidedAt' => substr((string) $d->decided_at, 0, 16),
                'actor' => trim((string) $d->first_name.' '.(string) $d->last_name) ?: (string) $d->email,
                'amountCents' => $d->rated_amount_cents === null ? null : (int) $d->rated_amount_cents,
                'ip' => $d->ip_address,
                // Sobre el papel de ahora o sobre uno anterior.
                'onCurrentDocument' => $confirmacion !== null
                    && (string) $d->document_sha256 === (string) $confirmacion->sha256,
            ])->all(),
            'currentDecisionStands' => $vigente,
            'can' => [
                'issue' => $checker->can($actor, 'load:financials:update', null, $policy)->allowed,
                'respond' => $checker->can($actor, 'load:rateconf:respond', null, $policy)->allowed,
                'download' => $checker->can($actor, 'document:download', null, $policy)->allowed,
            ],
        ]);
    }

    /** Emite (o reemite) la confirmación de tarifa. */
    public function issue(Request $request, string $load, CurrentActor $current, PermissionChecker $checker, DocumentStore $store): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'load:financials:update', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        if ($carga->carrier_id === null) {
            return back()->with('error', __('loads.rateConfirmation.needsCarrier'));
        }

        // `carrier_gross_rate_cents` es NOT NULL con default 0, así que «sin
        // tarifa» no es NULL: es cero. Emitir una confirmación de $0.00 es
        // mandarle al transportista un papel que dice que trabaja gratis.
        if ((int) $carga->carrier_gross_rate_cents <= 0) {
            return back()->with('error', __('loads.rateConfirmation.needsRate'));
        }

        RateConfirmation::issue($carga, $store, App::getLocale());

        return back()->with('success', __('loads.rateConfirmation.issued'));
    }

    /** El transportista acepta, rechaza o pide cambios. */
    public function decide(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'load:rateconf:respond', null, $policy);

        $datos = $request->validate([
            'decision' => ['required', Rule::in(RateConfirmation::DECISIONES)],
            // Aceptar no necesita explicación; rechazar y pedir cambios sí. Un
            // «no» sin motivo obliga a despacho a llamar para averiguar qué
            // pasa, que es justo la llamada que este papel existe para evitar.
            'reason' => ['nullable', 'string', 'max:2000', 'required_unless:decision,accepted'],
        ]);

        $carga = $this->findLoad($actor, $checker, $scope, $load);
        $confirmacion = RateConfirmation::current((string) $actor->tenantId, (string) $carga->id);

        if ($confirmacion === null) {
            return back()->with('error', __('loads.rateConfirmation.noneIssued'));
        }

        // El esquema exige `actor_user_id` NOT NULL, y con razón: aceptar una
        // tarifa compromete dinero y hace falta saber quién de esa empresa fue.
        $usuarioId = $actor->auditUserId();

        if ($usuarioId === null) {
            return back()->with('error', __('loads.rateConfirmation.needsUser'));
        }

        RateConfirmation::decide(
            carga: $carga,
            confirmacion: $confirmacion,
            decision: $datos['decision'],
            reason: $datos['reason'] ?? null,
            actorUserId: $usuarioId,
            ip: $request->ip(),
            userAgent: $request->userAgent(),
        );

        return back()->with('success', __('loads.rateConfirmation.decisions.'.$datos['decision'].'Saved'));
    }

    private function findLoad(Actor $actor, PermissionChecker $checker, Scope $scope, string $load): Load
    {
        $carga = LoadScope::apply(Load::query(), $checker, $actor, $scope)
            ->where('loads.id', $load)
            ->first();

        if ($carga === null) {
            // 404 y no 403: una carga de otra empresa no existe para quien
            // pregunta, y un 403 le confirmaría que sí existe.
            throw new NotFoundHttpException;
        }

        return $carga;
    }
}
