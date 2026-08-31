<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Support\InertiaPage;
use App\Support\Signatures\Ceremony;
use App\Support\Signatures\Mailer;
use App\Support\Signatures\SigningLinks;
use App\Support\Signatures\TemplateBody;
use App\Support\Signatures\Templates;
use App\Support\Signatures\Verifier;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Las firmas electrónicas: plantillas, solicitudes y la comprobación de que
 * siguen siendo las que se hicieron.
 *
 * Las cinco tablas de firma llevaban desde el principio en el esquema sin que
 * nada las tocara, y el diccionario portado `signature.json` —161 claves en dos
 * idiomas— ya describía la pantalla entera: la cronología de la ceremonia, la
 * sección de «requiere nueva firma», los seis motivos por los que un enlace
 * deja de servir y hasta el aviso de que esto no garantiza validez legal por sí
 * solo. Este lote construye lo que ese diccionario ya decía.
 *
 * LA VERIFICACIÓN NO ES UNA COLUMNA. El detalle de una solicitud recalcula el
 * sello, el hash del fichero guardado y la cadena de la bitácora cada vez que
 * alguien lo abre. Guardar «verificado = sí» sería inútil: el mismo `update`
 * que rompiera la firma podría poner esa columna en verde.
 *
 * LO QUE ESTE MÓDULO NO AFIRMA. En ninguna pantalla, ni en ningún PDF, se dice
 * que una firma capturada aquí sea legalmente vinculante. Lo que se afirma es
 * exactamente lo que se hace: se registra quién firmó, cuándo, desde qué IP y
 * navegador, y con qué huellas — y se dice, en los dos idiomas, que eso por sí
 * solo no garantiza la validez del acuerdo en ninguna jurisdicción. El texto
 * estaba ya en el diccionario portado; se ha respetado palabra por palabra.
 */
final class SignatureController
{
    use InertiaPage;

    /** @var list<string> */
    private const ESTADOS = ['pending', 'viewed', 'signed', 'declined', 'expired', 'voided', 'superseded'];

    /** El índice de solicitudes. */
    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'signature:request:read', null, $policy);

        $this->usesDictionary($request, ['signature', 'carriers', 'nav', 'common', 'validation']);

        $estado = (string) $request->query('status', '');
        $estado = in_array($estado, self::ESTADOS, true) ? $estado : '';

        $filas = $this->scoped($actor, $scope)
            ->leftJoin('signature_templates as t', 't.id', '=', 'r.template_id')
            ->leftJoin('carriers as c', 'c.id', '=', 'r.carrier_id')
            ->when($estado !== '', fn (Builder $q) => $q->where('r.status', $estado))
            ->orderByDesc('r.requested_at')
            ->limit(200)
            ->get([
                'r.id', 'r.status', 'r.signer_email', 'r.signer_legal_name', 'r.locale',
                'r.subject_type', 'r.requested_at', 'r.first_viewed_at', 'r.completed_at',
                'r.expires_at', 'r.template_version', 'r.template_content_hash',
                't.title_en', 't.title_es', 't.template_key', 'c.legal_name as carrier_name',
            ]);

        // «Requiere nueva firma»: firmadas contra una huella de plantilla que ya
        // no es la vigente de su clave. Se compara por HUELLA y no por número
        // de versión porque la huella es lo que se selló — y porque una empresa
        // puede haber retirado la clave entera, en cuyo caso no hay versión
        // vigente contra la que comparar.
        $vigentes = DB::table('signature_templates')
            ->where('tenant_id', $actor->tenantId)
            ->where('active', 1)
            ->whereNull('deleted_at')
            ->pluck('content_hash', 'template_key')
            ->all();

        return Inertia::render('App/Signatures/Index', [
            'requests' => $filas->map(fn (object $r): array => $this->rowPayload($r))->all(),
            'needsResignature' => $filas
                ->filter(static function (object $r) use ($vigentes): bool {
                    if ((string) $r->status !== 'signed') {
                        return false;
                    }

                    $vigente = $vigentes[(string) $r->template_key] ?? null;

                    return $vigente !== null && (string) $r->template_content_hash !== $vigente;
                })
                ->map(fn (object $r): array => $this->rowPayload($r))
                ->values()
                ->all(),
            'filters' => ['status' => $estado],
            'statuses' => self::ESTADOS,
            // Como el enlace de rastreo: viaja una vez, en el flash de ESTA
            // respuesta, y como prop propia — la bolsa `flash` compartida solo
            // lleva `success` y `error`, a propósito.
            'newSigningUrl' => $request->session()->get('signingUrl'),
            'carriers' => DB::table('carriers')
                ->where('tenant_id', $actor->tenantId)
                ->whereNull('deleted_at')
                ->orderBy('legal_name')
                ->limit(500)
                ->get(['id', 'legal_name'])
                ->map(static fn (object $c): array => [
                    'id' => (string) $c->id,
                    'name' => (string) $c->legal_name,
                ])->all(),
            'templates' => DB::table('signature_templates')
                ->where('tenant_id', $actor->tenantId)
                ->where('active', 1)
                ->whereNull('deleted_at')
                ->orderBy('template_key')
                ->get(['template_key', 'title_en', 'title_es'])
                ->map(static fn (object $t): array => [
                    'key' => (string) $t->template_key,
                    'title' => App::getLocale() === 'es' ? (string) $t->title_es : (string) $t->title_en,
                ])->all(),
            'can' => [
                'create' => $checker->can($actor, 'signature:request:create', null, $policy)->allowed,
                'void' => $checker->can($actor, 'signature:void', null, $policy)->allowed,
                'templates' => $checker->can($actor, 'signature:template:read', null, $policy)->allowed,
            ],
        ]);
    }

    /** El detalle de una solicitud, con la verificación recalculada. */
    public function show(Request $request, string $signatureRequest, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'signature:request:read', null, $policy);

        $this->usesDictionary($request, ['signature', 'carriers', 'nav', 'common', 'validation']);

        $solicitud = $this->scoped($actor, $scope)
            ->leftJoin('signature_templates as t', 't.id', '=', 'r.template_id')
            ->leftJoin('carriers as c', 'c.id', '=', 'r.carrier_id')
            ->where('r.id', $signatureRequest)
            ->first([
                'r.id', 'r.status', 'r.signer_email', 'r.signer_legal_name', 'r.locale',
                'r.subject_type', 'r.subject_id', 'r.requested_at', 'r.first_viewed_at',
                'r.completed_at', 'r.declined_at', 'r.decline_reason', 'r.expires_at',
                'r.voided_at', 'r.void_reason', 'r.template_version', 'r.template_content_hash',
                'r.token_values',
                't.title_en', 't.title_es', 't.template_key', 'c.legal_name as carrier_name',
            ]);

        if ($solicitud === null) {
            throw new NotFoundHttpException;
        }

        $registro = DB::table('signature_records')
            ->where('tenant_id', $actor->tenantId)
            ->where('request_id', $solicitud->id)
            ->first();

        $eventos = DB::table('signature_audit_events')
            ->where('tenant_id', $actor->tenantId)
            ->where('request_id', $solicitud->id)
            ->orderBy('occurred_at')
            ->orderBy('id')
            ->get(['id', 'event_type', 'occurred_at', 'ip_address', 'actor_email']);

        return Inertia::render('App/Signatures/Show', [
            'request' => $this->rowPayload($solicitud) + [
                'declineReason' => $solicitud->decline_reason,
                'voidReason' => $solicitud->void_reason,
                'voidedAt' => $this->minute($solicitud->voided_at),
                'declinedAt' => $this->minute($solicitud->declined_at),
                'contentHash' => (string) $solicitud->template_content_hash,
            ],
            'record' => $registro === null ? null : [
                'id' => (string) $registro->id,
                'signerLegalName' => (string) $registro->signer_legal_name,
                'signerEmail' => (string) $registro->signer_email,
                'signerTitle' => $registro->signer_title,
                'method' => (string) $registro->method,
                'signedAt' => $this->minute($registro->signed_at),
                'ipAddress' => (string) $registro->ip_address,
                'userAgent' => (string) $registro->user_agent,
                'documentSha256' => (string) $registro->document_sha256,
                'signatureSha256' => (string) $registro->signature_sha256,
                'sealAlgorithm' => (string) $registro->seal_algorithm,
                'hasDocument' => $registro->signed_document_id !== null,
                'hasCertificate' => $registro->audit_certificate_document_id !== null,
                // Los dos PDF son documentos normales del transportista, así
                // que se descargan por la ruta de documentos de siempre — con
                // su permiso, su comprobación de ámbito y su registro de acceso.
                // Duplicar todo eso aquí habría sido una segunda puerta a los
                // mismos ficheros con sus propias comprobaciones que mantener.
                'signedDocumentId' => $registro->signed_document_id,
                'certificateDocumentId' => $registro->audit_certificate_document_id,
            ],
            'verification' => $registro === null ? null : Verifier::verify($registro),
            'events' => $eventos->map(fn (object $e): array => [
                'id' => (string) $e->id,
                'type' => (string) $e->event_type,
                'at' => $this->minute($e->occurred_at),
                'ip' => $e->ip_address,
                'actor' => $e->actor_email,
            ])->all(),
            'can' => [
                'void' => $checker->can($actor, 'signature:void', null, $policy)->allowed,
                'download' => $checker->can($actor, 'signature:certificate:download', null, $policy)->allowed,
            ],
        ]);
    }

    /** Las plantillas y su historial de versiones. */
    public function templates(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'signature:template:read', null, $policy);

        $this->usesDictionary($request, ['signature', 'nav', 'common', 'validation']);

        $filas = DB::table('signature_templates')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->orderBy('template_key')
            ->orderByDesc('version')
            ->get();

        return Inertia::render('App/Signatures/Templates', [
            'templates' => $filas->map(fn (object $t): array => [
                'id' => (string) $t->id,
                'key' => (string) $t->template_key,
                'version' => (int) $t->version,
                'titleEn' => (string) $t->title_en,
                'titleEs' => (string) $t->title_es,
                'bodyEn' => (string) $t->body_en,
                'bodyEs' => (string) $t->body_es,
                'consentEn' => (string) $t->consent_copy_en,
                'consentEs' => (string) $t->consent_copy_es,
                'contentHash' => (string) $t->content_hash,
                'requiredTokens' => json_decode((string) $t->required_tokens, true) ?: [],
                'active' => (bool) $t->active,
                'effectiveFrom' => $this->minute($t->effective_from),
                'retiredAt' => $this->minute($t->retired_at),
            ])->all(),
            'can' => [
                'manage' => $checker->can($actor, 'signature:template:manage', null, $policy)->allowed,
            ],
        ]);
    }

    /** Siembra las plantillas de partida. */
    public function installTemplates(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'signature:template:manage', null, $current->policy());

        $creadas = Templates::install((string) $actor->tenantId);

        return back()->with('success', __('signature.templates.installed', ['count' => $creadas]));
    }

    /** Publica la siguiente versión de una plantilla. */
    public function publishTemplate(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'signature:template:manage', null, $current->policy());

        $datos = $request->validate([
            'template_key' => ['required', 'string', 'max:60', 'regex:/^[a-z0-9_]+$/'],
            'title_en' => ['required', 'string', 'max:200'],
            'title_es' => ['required', 'string', 'max:200'],
            'body_en' => ['required', 'string', 'max:60000'],
            'body_es' => ['required', 'string', 'max:60000'],
            'consent_en' => ['required', 'string', 'max:8000'],
            'consent_es' => ['required', 'string', 'max:8000'],
        ]);

        $resultado = Templates::publish(
            tenantId: (string) $actor->tenantId,
            templateKey: $datos['template_key'],
            titleEn: $datos['title_en'],
            titleEs: $datos['title_es'],
            bodyEn: $datos['body_en'],
            bodyEs: $datos['body_es'],
            consentEn: $datos['consent_en'],
            consentEs: $datos['consent_es'],
        );

        return back()->with('success', __('signature.templates.versionCreated', [
            'version' => $resultado['version'],
        ]));
    }

    /** Retira la versión vigente de una clave. */
    public function retireTemplate(Request $request, string $templateKey, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'signature:template:manage', null, $current->policy());

        Templates::retire((string) $actor->tenantId, $templateKey);

        return back()->with('success', __('signature.templates.retireSuccess'));
    }

    /**
     * Crea una solicitud de firma sobre un transportista y devuelve el enlace
     * EN CLARO una sola vez.
     */
    public function store(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'signature:request:create', null, $policy);

        $datos = $request->validate([
            'carrier_id' => ['required', 'string', 'size:36'],
            'template_key' => ['required', 'string', 'max:60'],
            'signer_email' => ['required', 'email', 'max:255'],
            'signer_legal_name' => ['nullable', 'string', 'max:200'],
            'locale' => ['required', Rule::in(['en', 'es'])],
            'expiry_days' => ['nullable', 'integer', 'min:0', 'max:365'],
        ]);

        $transportista = DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $datos['carrier_id'])
            ->whereNull('deleted_at')
            ->first(['id', 'legal_name', 'dot_number']);

        if ($transportista === null) {
            throw new NotFoundHttpException;
        }

        $plantilla = DB::table('signature_templates')
            ->where('tenant_id', $actor->tenantId)
            ->where('template_key', $datos['template_key'])
            ->where('active', 1)
            ->whereNull('deleted_at')
            ->orderByDesc('version')
            ->first();

        if ($plantilla === null) {
            return back()->with('error', __('signature.errors.templateNotFound'));
        }

        $valores = $this->tokenValues($actor, $transportista);

        /** @var list<string> $requeridas */
        $requeridas = json_decode((string) $plantilla->required_tokens, true) ?: [];
        $faltan = TemplateBody::missingTokens($requeridas, $valores);

        if ($faltan !== []) {
            // Se corta AQUÍ y no al firmar. Descubrir que falta un dato cuando
            // el transportista ya abrió el enlace convierte un fallo de la casa
            // en un problema del firmante.
            return back()->with('error', __('signature.errors.missingRequiredToken', ['token' => $faltan[0]]));
        }

        $resultado = SigningLinks::issue(
            tenantId: (string) $actor->tenantId,
            plantilla: $plantilla,
            subjectType: 'carrier',
            subjectId: (string) $transportista->id,
            carrierId: (string) $transportista->id,
            signerEmail: $datos['signer_email'],
            signerLegalName: $datos['signer_legal_name'] ?? null,
            locale: $datos['locale'],
            tokenValues: $valores,
            expiryDays: $datos['expiry_days'] ?? null,
            requestedByUserId: $actor->auditUserId(),
        );

        Ceremony::record(
            tenantId: (string) $actor->tenantId,
            requestId: $resultado['requestId'],
            eventType: Ceremony::REQUESTED,
            actorUserId: $actor->auditUserId(),
            actorEmail: $datos['signer_email'],
            request: $request,
            detail: [
                'templateKey' => (string) $plantilla->template_key,
                'templateVersion' => (int) $plantilla->version,
            ],
        );

        $url = url('/'.$datos['locale'].'/s/'.$resultado['token']);

        $nombreEmpresa = (string) (DB::table('tenants')
            ->where('id', $actor->tenantId)
            ->value('display_name') ?? '');

        $titulo = $datos['locale'] === 'es'
            ? (string) $plantilla->title_es
            : (string) $plantilla->title_en;

        // El correo va DESPUÉS de que la solicitud esté escrita. Si el servidor
        // de correo está caído, la solicitud existe igual y el enlace se enseña
        // en pantalla para copiarlo a mano: un problema de entrega no puede
        // deshacer lo que ya se pidió.
        $destinatario = (object) [
            'locale' => $datos['locale'],
            'signer_email' => $datos['signer_email'],
        ];

        if (Mailer::sendRequest($destinatario, $url, $nombreEmpresa, $titulo)) {
            Ceremony::record(
                tenantId: (string) $actor->tenantId,
                requestId: $resultado['requestId'],
                eventType: Ceremony::EMAILED,
                actorUserId: $actor->auditUserId(),
                actorEmail: $datos['signer_email'],
                request: $request,
            );
        }

        return back()
            ->with('success', __('signature.sendDialog.success'))
            // Como el enlace de seguimiento: viaja una vez, en el flash de ESTA
            // respuesta, y con el prefijo del idioma en que se manda — no del
            // idioma de quien lo crea, porque quien lo abre es el firmante.
            ->with('signingUrl', $url);
    }

    /**
     * Anota que alguien se llevó el certificado de auditoría, y le manda a
     * descargarlo.
     *
     * Existe esta ruta en vez de enlazar directo al documento porque
     * `certificate_downloaded` es un evento de la ceremonia: forma parte de lo
     * que hay que poder contar después sobre esta firma. El fichero lo sirve
     * igualmente la ruta de documentos.
     */
    public function certificate(Request $request, string $signatureRequest, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'signature:certificate:download', null, $policy);

        $solicitud = $this->scoped($actor, $scope)
            ->where('r.id', $signatureRequest)
            ->first(['r.id']);

        if ($solicitud === null) {
            throw new NotFoundHttpException;
        }

        $registro = DB::table('signature_records')
            ->where('tenant_id', $actor->tenantId)
            ->where('request_id', $solicitud->id)
            ->first(['id', 'audit_certificate_document_id']);

        if ($registro === null || $registro->audit_certificate_document_id === null) {
            return back()->with('error', __('signature.errors.certificateNotReady'));
        }

        Ceremony::record(
            tenantId: (string) $actor->tenantId,
            requestId: (string) $solicitud->id,
            eventType: Ceremony::CERTIFICATE_DOWNLOADED,
            recordId: (string) $registro->id,
            actorUserId: $actor->auditUserId(),
            request: $request,
        );

        return redirect('/documents/'.$registro->audit_certificate_document_id.'/download');
    }

    /** Anula una solicitud. El enlace deja de servir de inmediato. */
    public function void(Request $request, string $signatureRequest, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'signature:void', null, $policy);

        $datos = $request->validate(['reason' => ['required', 'string', 'max:2000']]);

        $solicitud = $this->scoped($actor, $scope)
            ->where('r.id', $signatureRequest)
            ->first(['r.id', 'r.status']);

        if ($solicitud === null) {
            throw new NotFoundHttpException;
        }

        // Una firmada no se anula. El hecho ya ocurrió y marcarlo como anulado
        // sería reescribir lo que pasó, no deshacerlo.
        if ((string) $solicitud->status === 'signed') {
            return back()->with('error', __('signature.errors.cannotVoidSigned'));
        }

        DB::table('signature_requests')->where('id', $solicitud->id)->update([
            'status' => 'voided',
            'voided_at' => CarbonImmutable::now(),
            'void_reason' => $datos['reason'],
            // El token sobrevive para que el firmante, al volver a su enlace,
            // lea «el remitente ha anulado esta solicitud» en vez de «enlace no
            // encontrado». Firmar ya no puede: eso lo cierra el estado.
            'updated_at' => CarbonImmutable::now(),
        ]);

        Ceremony::record(
            tenantId: (string) $actor->tenantId,
            requestId: (string) $solicitud->id,
            eventType: Ceremony::VOIDED,
            actorUserId: $actor->auditUserId(),
            request: $request,
            detail: ['reason' => $datos['reason']],
        );

        return back()->with('success', __('signature.detail.voided'));
    }

    /**
     * Las solicitudes que este actor puede ver.
     *
     * Un transportista ve las suyas y nada más; el resto de roles con permiso
     * las ven todas dentro de su empresa. Sin columna de transportista no se
     * devuelve nada en vez de devolverlo todo, que es la misma regla que aplica
     * `ScopeFilter` en el resto de la aplicación.
     */
    private function scoped(Actor $actor, Scope $scope): Builder
    {
        $consulta = DB::table('signature_requests as r')
            ->where('r.tenant_id', $actor->tenantId)
            ->whereNull('r.deleted_at');

        return match ($scope) {
            Scope::Platform, Scope::Tenant, Scope::Assigned => $consulta,
            Scope::Carrier => $actor->carrierId === null
                ? $consulta->whereRaw('1 = 0')
                : $consulta->where('r.carrier_id', $actor->carrierId),
            default => $consulta->whereRaw('1 = 0'),
        };
    }

    /**
     * Los datos con los que se rellena el documento.
     *
     * Salen de la base de datos, nunca del formulario: quien manda la solicitud
     * elige a QUIÉN y con QUÉ plantilla, no qué dice el acuerdo sobre las
     * partes. Un campo de texto libre aquí dejaría mandar a firmar un acuerdo
     * con el nombre legal de otra empresa dentro.
     *
     * @return array<string, string>
     */
    private function tokenValues(Actor $actor, object $transportista): array
    {
        $empresa = DB::table('tenants')
            ->where('id', $actor->tenantId)
            ->first(['legal_name', 'display_name']);

        // La empresa de factoring del transportista, si tiene una asignada.
        // Solo la vigente: `effective_to` nulo o en el futuro. Una asignación
        // ya terminada metería en el aviso de cesión el nombre de quien ya no
        // cobra, que es exactamente el error que este documento causa.
        $factoring = DB::table('factoring_assignments as fa')
            ->join('factoring_companies as f', 'f.id', '=', 'fa.factoring_company_id')
            ->where('fa.tenant_id', $actor->tenantId)
            ->where('fa.carrier_id', $transportista->id)
            ->whereNull('fa.deleted_at')
            ->where(function ($q): void {
                $q->whereNull('fa.effective_to')->orWhere('fa.effective_to', '>=', CarbonImmutable::now());
            })
            ->orderByDesc('fa.effective_from')
            ->value('f.name');

        return array_filter([
            'effectiveDate' => CarbonImmutable::now()->format('Y-m-d'),
            'tenantLegalName' => (string) ($empresa->legal_name ?? $empresa->display_name ?? ''),
            'carrierLegalName' => (string) $transportista->legal_name,
            'carrierUsdot' => (string) ($transportista->dot_number ?? ''),
            'factoringCompanyName' => (string) ($factoring ?? ''),
            'newPayeeName' => (string) ($factoring ?? ''),
        ], static fn (string $v): bool => $v !== '');
    }

    /** @return array<string, mixed> */
    private function rowPayload(object $r): array
    {
        $locale = (string) $r->locale;

        return [
            'id' => (string) $r->id,
            'status' => (string) $r->status,
            'title' => $locale === 'es' ? (string) $r->title_es : (string) $r->title_en,
            'templateKey' => (string) $r->template_key,
            'templateVersion' => (int) $r->template_version,
            'signerEmail' => (string) $r->signer_email,
            'signerLegalName' => $r->signer_legal_name,
            'locale' => $locale,
            'subjectType' => (string) $r->subject_type,
            'carrierName' => $r->carrier_name,
            'requestedAt' => $this->minute($r->requested_at),
            'firstViewedAt' => $this->minute($r->first_viewed_at),
            'completedAt' => $this->minute($r->completed_at),
            'expiresAt' => $this->minute($r->expires_at),
        ];
    }

    private function minute(mixed $valor): ?string
    {
        return $valor === null ? null : substr((string) $valor, 0, 16);
    }
}
