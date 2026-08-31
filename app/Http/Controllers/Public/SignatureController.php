<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Support\InertiaPage;
use App\Support\Signatures\Ceremony;
use App\Support\Signatures\Mailer;
use App\Support\Signatures\Signing;
use App\Support\Signatures\SigningLinks;
use App\Support\Signatures\TemplateBody;
use App\Support\Storage\DocumentStore;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use RuntimeException;

/**
 * La ceremonia de firma. Sin sesión, sin cuenta, sin menú.
 *
 * El token es la autorización y de él sale la empresa. Igual que en el rastreo
 * público — pero con una diferencia que cambia el trato:
 *
 * AQUÍ SÍ SE DICE QUÉ PASÓ. El rastreo público contesta 404 con el mismo código
 * a los cuatro motivos de rechazo, porque ahí quien prueba enlaces es un
 * desconocido y distinguirlos le diría cuáles existieron. Aquí el enlace se le
 * mandó por correo a una persona concreta que tiene que hacer algo con él, y
 * saber si su documento fue ANULADO, si VENCIÓ o si la casa lo REEMPLAZÓ es
 * justo lo que necesita para saber a quién llamar. Un «no válido» para todo la
 * dejaría llamando a preguntar qué pasó.
 *
 * Eso no filtra nada porque los seis motivos solo se distinguen cuando el token
 * es correcto. Uno inventado da siempre `not_found`.
 *
 * LO QUE NO SE AFIRMA. La página lleva, en los dos idiomas, el aviso de que
 * esto registra quién firmó, cuándo, desde dónde y con qué huellas — y que por
 * sí solo no garantiza la validez legal del acuerdo en ninguna jurisdicción. El
 * texto venía en el diccionario portado y se ha dejado tal cual.
 */
final class SignatureController
{
    use InertiaPage;

    /** Enseña el documento. */
    public function show(Request $request, string $token): Response
    {
        $this->usesDictionary($request, ['signature', 'common']);

        $resuelto = SigningLinks::resolve($token);

        if ($resuelto['state'] !== 'open') {
            return $this->rechazo($resuelto['state']);
        }

        /** @var object $solicitud */
        $solicitud = $resuelto['request'];

        $plantilla = $this->plantilla($solicitud);

        if ($plantilla === null) {
            return $this->rechazo('not_found');
        }

        // Primera visita: se anota la hora y el estado pasa a `viewed`. Se hace
        // aquí y no en el cliente porque «lo abrió» es evidencia, y la evidencia
        // no puede depender de que un navegador haya ejecutado un script.
        if ($solicitud->first_viewed_at === null) {
            DB::table('signature_requests')->where('id', $solicitud->id)->update([
                'first_viewed_at' => CarbonImmutable::now(),
                'status' => 'viewed',
                'updated_at' => CarbonImmutable::now(),
            ]);

            Ceremony::record(
                tenantId: (string) $solicitud->tenant_id,
                requestId: (string) $solicitud->id,
                eventType: Ceremony::OPENED,
                actorEmail: (string) $solicitud->signer_email,
                request: $request,
            );
        }

        Ceremony::record(
            tenantId: (string) $solicitud->tenant_id,
            requestId: (string) $solicitud->id,
            eventType: Ceremony::VIEWED,
            actorEmail: (string) $solicitud->signer_email,
            request: $request,
        );

        $locale = (string) $solicitud->locale;

        /** @var array<string, mixed> $valores */
        $valores = json_decode((string) $solicitud->token_values, true) ?: [];

        return Inertia::render('Public/Signature', [
            'state' => 'open',
            'token' => $token,
            'document' => [
                'title' => $locale === 'es' ? (string) $plantilla->title_es : (string) $plantilla->title_en,
                // Ya con los datos dentro: lo que se firma es lo que se lee, no
                // una plantilla con huecos que el servidor rellena después.
                'body' => TemplateBody::render(
                    $locale === 'es' ? (string) $plantilla->body_es : (string) $plantilla->body_en,
                    $valores,
                ),
                'consent' => $locale === 'es'
                    ? (string) $plantilla->consent_copy_es
                    : (string) $plantilla->consent_copy_en,
                'version' => (int) $solicitud->template_version,
            ],
            'signer' => [
                'email' => (string) $solicitud->signer_email,
                'legalName' => $solicitud->signer_legal_name,
            ],
            'senderName' => $this->tenantName((string) $solicitud->tenant_id),
        ]);
    }

    /** Firma. */
    public function sign(Request $request, string $token, DocumentStore $store): RedirectResponse
    {
        $resuelto = SigningLinks::resolve($token);

        if ($resuelto['state'] !== 'open') {
            return back()->with('error', __('signature.errors.linkInvalid'));
        }

        /** @var object $solicitud */
        $solicitud = $resuelto['request'];

        $datos = $request->validate([
            'consent' => ['accepted'],
            'legal_name' => ['required', 'string', 'max:200'],
            'title' => ['nullable', 'string', 'max:120'],
            'method' => ['required', Rule::in(['drawn', 'typed'])],
            // El dibujo llega como data URL de PNG. Se limita el tamaño porque
            // es un campo que llega de fuera sin sesión: un lienzo de firma
            // razonable no pasa de unos cientos de kilobytes.
            'drawn' => ['required_if:method,drawn', 'nullable', 'string', 'max:2000000', 'starts_with:data:image/png;base64,'],
            'typed' => ['required_if:method,typed', 'nullable', 'string', 'max:200'],
        ]);

        $plantilla = $this->plantilla($solicitud);

        if ($plantilla === null) {
            return back()->with('error', __('signature.errors.templateNotFound'));
        }

        Ceremony::record(
            tenantId: (string) $solicitud->tenant_id,
            requestId: (string) $solicitud->id,
            eventType: Ceremony::CONSENT_ACCEPTED,
            actorEmail: (string) $solicitud->signer_email,
            request: $request,
            detail: ['consentHash' => hash('sha256', (string) (
                $solicitud->locale === 'es' ? $plantilla->consent_copy_es : $plantilla->consent_copy_en
            ))],
        );

        try {
            DB::transaction(fn () => Signing::sign(
                solicitud: $solicitud,
                plantilla: $plantilla,
                signerLegalName: trim($datos['legal_name']),
                signerTitle: $datos['title'] ?? null,
                method: $datos['method'],
                drawnDataUrl: $datos['drawn'] ?? null,
                typedName: $datos['typed'] ?? null,
                request: $request,
                store: $store,
            ));
        } catch (RuntimeException $e) {
            if (str_starts_with($e->getMessage(), 'missing_token:')) {
                return back()->with('error', __('signature.errors.missingRequiredToken', [
                    'token' => substr($e->getMessage(), strlen('missing_token:')),
                ]));
            }

            return back()->with('error', __('signature.errors.signatureRequired'));
        }

        // El aviso de que la copia está lista. Igual que el otro: si no sale,
        // la firma ya está sellada y no se deshace nada por eso.
        if (Mailer::sendSignedCopy($solicitud, (string) ($this->tenantName((string) $solicitud->tenant_id) ?? ''))) {
            Ceremony::record(
                tenantId: (string) $solicitud->tenant_id,
                requestId: (string) $solicitud->id,
                eventType: Ceremony::EMAILED_COPY,
                actorEmail: (string) $solicitud->signer_email,
                request: $request,
            );
        }

        return back()->with('success', __('signature.ceremony.successTitle'));
    }

    /** Rechaza la firma. */
    public function decline(Request $request, string $token): RedirectResponse
    {
        $resuelto = SigningLinks::resolve($token);

        if ($resuelto['state'] !== 'open') {
            return back()->with('error', __('signature.errors.linkInvalid'));
        }

        /** @var object $solicitud */
        $solicitud = $resuelto['request'];

        $datos = $request->validate(['reason' => ['required', 'string', 'max:2000']]);

        $ahora = CarbonImmutable::now();

        DB::table('signature_requests')->where('id', $solicitud->id)->update([
            'status' => 'declined',
            'declined_at' => $ahora,
            'decline_reason' => $datos['reason'],
            // El token sobrevive: lo que cierra la puerta es el ESTADO. Quien
            // rechazó no puede cambiar de idea por su cuenta —hace falta una
            // solicitud nueva, que deja constancia de que la casa la volvió a
            // mandar— pero sí puede volver a su enlace y ver que consta.
            'updated_at' => $ahora,
        ]);

        Ceremony::record(
            tenantId: (string) $solicitud->tenant_id,
            requestId: (string) $solicitud->id,
            eventType: Ceremony::DECLINED,
            actorEmail: (string) $solicitud->signer_email,
            request: $request,
            detail: ['reason' => $datos['reason']],
        );

        return back()->with('success', __('signature.ceremony.declinedTitle'));
    }

    private function plantilla(object $solicitud): ?object
    {
        // La plantilla se busca por su ID, no por «la vigente de esta clave».
        // Se firma la versión que se mandó: si la casa publicó otra mientras
        // tanto, la solicitud ya pasó a `superseded` y no llega hasta aquí.
        return app(TenantContext::class)->withoutTenant(fn () => DB::table('signature_templates')
            ->where('id', $solicitud->template_id)
            ->first());
    }

    private function tenantName(string $tenantId): ?string
    {
        $nombre = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
            ->where('id', $tenantId)
            ->value('display_name'));

        return $nombre === null ? null : (string) $nombre;
    }

    /**
     * Una página que dice por qué no se puede firmar.
     *
     * 200 y no 404: a diferencia del rastreo público, aquí el estado ES el
     * contenido. El firmante llegó desde un correo que le mandaron y esta
     * página le está contestando, no negándole la existencia de algo.
     */
    private function rechazo(string $estado): Response
    {
        return Inertia::render('Public/Signature', [
            'state' => $estado,
            'token' => null,
            'document' => null,
            'signer' => null,
            'senderName' => null,
        ]);
    }
}
