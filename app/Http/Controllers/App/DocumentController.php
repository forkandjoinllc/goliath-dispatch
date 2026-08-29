<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\AuditAction;
use App\Enums\Scope;
use App\Models\Document;
use App\Support\Audit;
use App\Support\Documents\DocumentScope;
use App\Support\Documents\DocumentTypes;
use App\Support\EnumValue;
use App\Support\InertiaPage;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use App\Support\Storage\DocumentStore;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Los documentos: subirlos, versionarlos, revisarlos y vigilar sus
 * vencimientos.
 *
 * Es el dominio con más superficie de riesgo de todo el sistema, porque es el
 * único donde entra un fichero de fuera. Tres decisiones que no son opcionales:
 *
 *  - **El fichero no se sirve nunca desde una ruta adivinable.** Vive fuera de
 *    `public/` y solo se llega por una URL firmada que caduca en minutos. Un
 *    certificado de seguro lleva el número de póliza y la dirección de una
 *    empresa; un enlace permanente acabaría reenviado tres veces.
 *  - **El nombre original del fichero es un dato, no un nombre de fichero.**
 *    Llega del usuario. Se guarda en la fila y el fichero en disco tiene un
 *    nombre aleatorio con extensión de una lista blanca.
 *  - **Subir una versión nueva no pisa la anterior.** Cada subida es una fila
 *    de `document_versions` con su propio sha256. Si alguien discute qué decía
 *    el seguro en marzo, la respuesta está.
 *
 * Quien SUBE y quien REVISA son roles distintos: el transportista sube su
 * certificado, la oficina de despacho lo aprueba. `document:review` lo tienen
 * solo administración y contabilidad.
 */
final class DocumentController
{
    use InertiaPage;

    private const PER_PAGE = 25;

    /**
     * Con cuántos días de antelación se avisa de una caducidad.
     *
     * Sale de `tenant_settings.document_expiration_warning_days`. Era una
     * constante de 45 días que ignoraba esa columna — y la columna trae 30 por
     * defecto, así que la aplicación avisaba con quince días más de los que la
     * empresa había pedido. Los CUATRO sitios que lo usaban (el aviso al subir,
     * el filtro de «caducan pronto», su contador y la etiqueta de la ficha)
     * tienen que contestar lo mismo, o la lista y el contador se contradicen.
     */
    private function warnDays(): int
    {
        return TenantPolicy::for(app(TenantContext::class)->id())->documentWarningDays;
    }

    /** 25 MB. Un escaneo de un certificado no llega; un vídeo sí, y no va aquí. */
    private const MAX_KB = 25600;

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'document:read', null, $policy);

        $this->usesDictionary($request, ['documents', 'nav']);

        $filters = [
            'search' => trim((string) $request->query('search', '')),
            'owner' => (string) $request->query('owner', ''),
            'status' => (string) $request->query('status', ''),
            'expiring' => $request->query('expiring') === '1' ? '1' : '',
        ];

        $query = $this->scoped($checker, $actor, $scope);
        $this->applyFilters($query, $filters);

        $page = $query
            // Lo que vence antes, primero. Es el orden en que se atiende esto
            // de verdad: nadie abre esta pantalla a mirar, la abre porque algo
            // está por caducar.
            ->orderByRaw('expiration_date is null, expiration_date asc')
            ->orderBy('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        $rows = collect($page->items());

        return Inertia::render('App/Documents/Index', [
            'documents' => [
                'data' => $rows->map(fn (Document $d): array => $this->row($d))->all(),
                'meta' => [
                    'total' => $page->total(),
                    'perPage' => $page->perPage(),
                    'currentPage' => $page->currentPage(),
                    'lastPage' => $page->lastPage(),
                ],
            ],
            'owners' => $this->ownerNames($rows),
            'filters' => $filters,
            'scope' => $scope->value,
            'facets' => $this->facets($checker, $actor, $scope),
            'can' => [
                'upload' => $checker->can($actor, 'document:upload', null, $policy)->allowed,
                'review' => $checker->can($actor, 'document:review', null, $policy)->allowed,
                'download' => $checker->can($actor, 'document:download', null, $policy)->allowed,
            ],
        ]);
    }

    public function show(Request $request, string $document, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $model = $this->find($document, $checker, $actor, $policy);

        $this->usesDictionary($request, ['documents', 'nav']);

        return Inertia::render('App/Documents/Show', [
            'document' => $this->detail($model),
            'owner' => $this->owner($model),
            'versions' => $this->versions($model),
            'reviews' => $this->reviews($model),
            'can' => [
                'upload' => $checker->can($actor, 'document:upload', $this->context($model), $policy)->allowed,
                'review' => $checker->can($actor, 'document:review', $this->context($model), $policy)->allowed,
                'download' => $checker->can($actor, 'document:download', $this->context($model), $policy)->allowed,
            ],
        ]);
    }

    public function create(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'document:upload', null, $policy);

        $this->usesDictionary($request, ['documents', 'nav', 'validation']);

        return Inertia::render('App/Documents/Form', [
            'owners' => $this->uploadTargets($actor, $scope),
            'typesByOwner' => [
                'carrier' => DocumentTypes::forOwner('carrier'),
                'driver' => DocumentTypes::forOwner('driver'),
                'truck' => DocumentTypes::forOwner('truck'),
                'trailer' => DocumentTypes::forOwner('trailer'),
            ],
            'requiredTypes' => [
                'carrier' => DocumentTypes::requiredFor('carrier'),
                'driver' => DocumentTypes::requiredFor('driver'),
                'truck' => DocumentTypes::requiredFor('truck'),
                'trailer' => DocumentTypes::requiredFor('trailer'),
            ],
            // Los tipos que ESE dueño ya tiene. Llega por recarga parcial en
            // cuanto se elige el dueño: mandar el mapa de todos los dueños de
            // la empresa sería kilos de JSON para usar una fila.
            'usedTypes' => $this->usedTypes(
                $actor,
                $scope,
                (string) $request->query('owner_type', ''),
                (string) $request->query('owner_id', ''),
            ),
            'document' => null,
        ]);
    }

    /**
     * Los tipos de documento que este dueño YA tiene, con el documento donde
     * están.
     *
     * Sirve para apagarlos en el desplegable. Subir «certificado de seguro» dos
     * veces no crea dos documentos: crea uno bueno y uno que nadie sabe si mirar.
     * Lo que se quiere en ese caso es una VERSIÓN NUEVA del que ya está, y eso
     * se hace desde su ficha — por eso la opción apagada dice cuál es.
     *
     * Se comprueba el ámbito igual que en el resto: pedir por la URL el dueño de
     * otra empresa no devuelve nada.
     *
     * @return list<array{type: string, documentId: string}>
     */
    private function usedTypes(Actor $actor, Scope $scope, string $ownerType, string $ownerId): array
    {
        if ($ownerType === '' || $ownerId === '') {
            return [];
        }

        if (! in_array($ownerType, ['carrier', 'driver', 'truck', 'trailer'], true)) {
            return [];
        }

        if (! DocumentScope::ownsTarget($actor, $scope, $ownerType, $ownerId)) {
            return [];
        }

        return DB::table('documents')
            ->where('tenant_id', $actor->tenantId)
            ->where('owner_type', $ownerType)
            ->where('owner_id', $ownerId)
            ->whereNull('deleted_at')
            ->orderBy('created_at')
            ->get(['id', 'document_type'])
            ->map(fn ($d): array => [
                'type' => (string) $d->document_type,
                'documentId' => (string) $d->id,
            ])
            ->all();
    }

    /**
     * Subir un documento nuevo, o una versión nueva de uno que existe.
     */
    public function store(Request $request, CurrentActor $current, PermissionChecker $checker, DocumentStore $store): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'document:upload', null, $policy);

        $data = $request->validate([
            'file' => [
                'required',
                'file',
                'max:'.self::MAX_KB,
                // Por MIME real, no por extensión del nombre. `mimes:` de
                // Laravel comprueba el contenido con finfo, no la cadena que
                // mandó el navegador.
                'mimetypes:application/pdf,image/jpeg,image/png,image/webp,image/heic,image/tiff,'.
                'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ],
            'document_id' => ['nullable', 'string', 'size:36'],
            'owner_type' => ['required_without:document_id', 'in:carrier,driver,truck,trailer'],
            'owner_id' => ['required_without:document_id', 'string', 'size:36'],
            'document_type' => ['required_without:document_id', 'string', 'max:40'],
            'title' => ['nullable', 'string', 'max:200'],
            'issue_date' => ['nullable', 'date'],
            'expiration_date' => ['nullable', 'date'],
        ]);

        $existing = null;

        if (! empty($data['document_id'])) {
            $existing = $this->find($data['document_id'], $checker, $actor, $policy);
        } else {
            if (! DocumentTypes::isKnown($data['document_type'])) {
                throw ValidationException::withMessages([
                    'document_type' => __('documents.form.unknownType'),
                ]);
            }

            // Quien sube tiene que poder tocar a ESE dueño. Sin esto, cualquiera
            // con `document:upload` podría colgarle un documento al
            // transportista de otro.
            if (! DocumentScope::ownsTarget($actor, $scope, $data['owner_type'], $data['owner_id'])) {
                throw ValidationException::withMessages([
                    'owner_id' => __('documents.form.ownerNotAllowed'),
                ]);
            }

            if (! $this->ownerExists($actor, $data['owner_type'], $data['owner_id'])) {
                throw ValidationException::withMessages([
                    'owner_id' => __('documents.form.ownerNotFound'),
                ]);
            }
        }

        $file = $request->file('file');
        $storageKey = $store->put((string) $actor->tenantId, $file);

        $document = DB::transaction(function () use ($existing, $data, $file, $storageKey, $actor): Document {
            $document = $existing;

            if ($document === null) {
                $document = new Document;
                $document->document_type = $data['document_type'];
                $document->owner_type = $data['owner_type'];
                $document->owner_id = $data['owner_id'];
                $document->is_required = DocumentTypes::isRequired($data['document_type']);
                $document->uploaded_by_user_id = $actor->auditUserId();
            }

            $document->title = $data['title'] ?? $file->getClientOriginalName();
            $document->issue_date = $data['issue_date'] ?? $document->issue_date;
            $document->expiration_date = $data['expiration_date'] ?? $document->expiration_date;
            // Toda subida vuelve a poner el documento en cola de revisión,
            // también una versión nueva de uno ya aprobado. Lo contrario
            // dejaría que se aprobara un certificado y se sustituyera después
            // por otro sin que nadie lo mirase.
            $document->review_status = 'pending';
            $document->expires_soon_at = $document->expiration_date === null
                ? null
                : CarbonImmutable::parse($document->expiration_date)->subDays($this->warnDays());
            $document->save();

            $next = 1 + (int) DB::table('document_versions')
                ->where('document_id', $document->id)
                ->max('version_number');

            $versionId = (string) Str::uuid();

            DB::table('document_versions')->insert([
                'id' => $versionId,
                'tenant_id' => $document->tenant_id,
                'document_id' => $document->id,
                'version_number' => $next,
                'storage_key' => $storageKey,
                // El nombre original es un DATO, no un nombre de fichero.
                'original_filename' => mb_substr((string) $file->getClientOriginalName(), 0, 255),
                'content_type' => (string) $file->getMimeType(),
                'byte_size' => (int) $file->getSize(),
                // El hash del contenido. Es lo que responde «¿este PDF es el
                // mismo que firmaron?» sin depender del nombre ni de la fecha.
                'sha256' => hash_file('sha256', $file->getRealPath()),
                // Sin antivirus configurado no se miente diciendo que está
                // limpio: queda pendiente, y el trabajo que lo escanee lo
                // marcará cuando exista.
                'malware_scan_status' => 'pending',
                'uploaded_by_user_id' => $actor->auditUserId(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $document->current_version_id = $versionId;
            $document->save();

            Audit::record(
                actor: $actor,
                action: AuditAction::DocumentUploaded,
                entityType: 'document',
                entityId: $document->id,
                entityLabel: (string) $document->title,
                after: ['version' => $next, 'sha256_prefix' => mb_substr(hash_file('sha256', $file->getRealPath()), 0, 12)],
            );

            return $document;
        });

        return redirect()->route('documents.show', $document->id)
            ->with('success', __('documents.flash.uploaded'));
    }

    /**
     * Aprobar o rechazar un documento.
     *
     * Rechazar exige motivo: el transportista va a recibirlo y «rechazado» a
     * secas le obliga a adivinar qué corregir, lo que garantiza una segunda
     * subida igual de mala.
     */
    public function review(Request $request, string $document, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $model = $this->find($document, $checker, $actor, $policy);

        $checker->authorize($actor, 'document:review', $this->context($model), $policy);

        $data = $request->validate([
            'decision' => ['required', 'in:approved,rejected,in_review'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        if ($data['decision'] === 'rejected' && mb_strlen(trim((string) ($data['notes'] ?? ''))) < 10) {
            throw ValidationException::withMessages([
                'notes' => __('documents.review.notesRequired'),
            ]);
        }

        $before = EnumValue::of($model->review_status, 'pending');

        DB::transaction(function () use ($model, $data, $actor, $before): void {
            $model->review_status = $data['decision'];
            $model->save();

            DB::table('document_reviews')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $model->tenant_id,
                'document_id' => $model->id,
                // La versión CONCRETA que se revisó. Sin esto, una versión
                // nueva heredaría la aprobación de la anterior y la revisión
                // dejaría de significar nada.
                'document_version_id' => $model->current_version_id,
                'reviewer_user_id' => $actor->auditUserId(),
                'status' => $data['decision'],
                'notes' => $data['notes'] ?? null,
                'rejection_reason' => $data['decision'] === 'rejected' ? ($data['notes'] ?? null) : null,
                'reviewed_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            Audit::record(
                actor: $actor,
                action: $data['decision'] === 'approved'
                    ? AuditAction::DocumentApproved
                    : AuditAction::DocumentRejected,
                entityType: 'document',
                entityId: $model->id,
                entityLabel: (string) $model->title,
                before: ['review_status' => $before],
                after: ['review_status' => $data['decision']],
                reason: $data['notes'] ?? null,
            );
        });

        return back()->with('success', __('documents.review.done'));
    }

    /**
     * Genera la URL temporal de descarga y deja constancia de quién la pidió.
     *
     * El registro de acceso importa tanto como el control: `document_access_log`
     * es lo que responde «¿quién ha visto el número de póliza de este
     * transportista?».
     */
    public function download(Request $request, string $document, CurrentActor $current, PermissionChecker $checker, DocumentStore $store): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $model = $this->find($document, $checker, $actor, $policy);

        $checker->authorize($actor, 'document:download', $this->context($model), $policy);

        $version = DB::table('document_versions')
            ->where('id', $model->current_version_id)
            ->first(['id', 'storage_key']);

        if ($version === null || ! $store->exists($version->storage_key)) {
            throw ValidationException::withMessages([
                'file' => __('documents.download.missing'),
            ]);
        }

        DB::table('document_access_logs')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $model->tenant_id,
            'document_id' => $model->id,
            'document_version_id' => $version->id,
            'user_id' => $actor->auditUserId(),
            'action' => 'download',
            'watermarked' => false,
            'ip_address' => $request->ip(),
            'user_agent' => mb_substr((string) $request->userAgent(), 0, 255),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Audit::record(
            actor: $actor,
            action: AuditAction::DocumentDownloaded,
            entityType: 'document',
            entityId: $model->id,
            entityLabel: (string) $model->title,
        );

        return redirect()->away($store->temporaryUrl($version->storage_key));
    }

    // ------------------------------------------------------------------ interno

    /**
     * A quién se le puede colgar un documento, dentro del ámbito.
     *
     * Se calcula con las mismas reglas que DocumentScope::ownsTarget, que es
     * quien vuelve a comprobarlo al guardar. El selector es una comodidad; la
     * comprobación del servidor es la defensa.
     *
     * @return array<string, list<array{id: string, name: string}>>
     */
    private function uploadTargets(Actor $actor, Scope $scope): array
    {
        $carrierIds = match ($scope) {
            Scope::Carrier => array_filter([$actor->carrierId]),
            Scope::Assigned => $actor->assignments->carrierIds,
            default => null,
        };

        $limit = static fn ($q) => $carrierIds === null ? $q : $q->whereIn('carrier_id', $carrierIds);

        if ($scope === Scope::Own) {
            // Un conductor solo se sube documentos a sí mismo.
            return [
                'carrier' => [],
                'driver' => $actor->driverId === null ? [] : DB::table('drivers')
                    ->where('id', $actor->driverId)
                    ->get(['id', 'first_name', 'last_name'])
                    ->map(fn ($d): array => [
                        'id' => (string) $d->id,
                        'name' => trim("{$d->first_name} {$d->last_name}"),
                    ])->all(),
                'truck' => [],
                'trailer' => [],
            ];
        }

        $carriers = DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->when($carrierIds !== null, fn ($q) => $q->whereIn('id', $carrierIds ?: ['-']))
            ->orderBy('legal_name')
            ->get(['id', 'legal_name as name'])
            ->map(fn ($r): array => ['id' => (string) $r->id, 'name' => (string) $r->name])
            ->all();

        $drivers = DB::table('drivers')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->when($carrierIds !== null, fn ($q) => $q->whereIn('id', function ($sub) use ($carrierIds): void {
                $sub->select('driver_id')->from('driver_carrier_relationships')
                    ->whereIn('carrier_id', $carrierIds ?: ['-'])->whereNull('deleted_at');
            }))
            ->orderBy('last_name')
            ->get(['id', 'first_name', 'last_name'])
            ->map(fn ($d): array => [
                'id' => (string) $d->id,
                'name' => trim("{$d->first_name} {$d->last_name}"),
            ])->all();

        $units = fn (string $table): array => $limit(
            DB::table($table)->where('tenant_id', $actor->tenantId)->whereNull('deleted_at')
        )->orderBy('unit_number')->get(['id', 'unit_number as name'])
            ->map(fn ($r): array => ['id' => (string) $r->id, 'name' => (string) $r->name])
            ->all();

        return [
            'carrier' => $carriers,
            'driver' => $drivers,
            'truck' => $units('trucks'),
            'trailer' => $units('trailers'),
        ];
    }

    /**
     * @return Builder<Document>
     */
    private function scoped(PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        return DocumentScope::apply(Document::query(), $checker, $actor, $scope);
    }

    /**
     * Busca un documento DENTRO del ámbito del actor.
     *
     * Se resuelve con la consulta ya estrechada en lugar de buscarlo y
     * comprobar después: así un id de otro transportista da 404 y no 403, y un
     * 404 no confirma que ese documento exista.
     *
     * @param  array<string, mixed>|null  $policy
     */
    private function find(string $id, PermissionChecker $checker, Actor $actor, ?array $policy): Document
    {
        $scope = $checker->authorize($actor, 'document:read', null, $policy);

        return $this->scoped($checker, $actor, $scope)->whereKey($id)->firstOrFail();
    }

    private function context(Document $document): ResourceContext
    {
        return new ResourceContext(
            tenantId: $document->tenant_id,
            carrierId: $document->owner_type === 'carrier' ? $document->owner_id : null,
            driverId: $document->owner_type === 'driver' ? $document->owner_id : null,
        );
    }

    /**
     * @param  Builder<Document>  $query
     * @param  array<string, string>  $filters
     */
    private function applyFilters(Builder $query, array $filters): void
    {
        if ($filters['search'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['search']).'%';
            $query->where(fn (Builder $q) => $q->where('title', 'like', $term)
                ->orWhere('document_type', 'like', $term));
        }

        if (in_array($filters['owner'], ['carrier', 'driver', 'truck', 'trailer'], true)) {
            $query->where('owner_type', $filters['owner']);
        }

        if (in_array($filters['status'], ['pending', 'in_review', 'approved', 'rejected', 'expired', 'superseded'], true)) {
            $query->where('review_status', $filters['status']);
        }

        if ($filters['expiring'] === '1') {
            $query->whereNotNull('expiration_date')
                ->where('expiration_date', '<=', CarbonImmutable::now()->addDays($this->warnDays()));
        }
    }

    /**
     * @return array<string, int>
     */
    private function facets(PermissionChecker $checker, Actor $actor, Scope $scope): array
    {
        $counts = $this->scoped($checker, $actor, $scope)
            ->select('review_status', DB::raw('count(*) as total'))
            ->groupBy('review_status')->pluck('total', 'review_status')->all();

        return [
            'all' => array_sum($counts),
            'pending' => (int) ($counts['pending'] ?? 0),
            'in_review' => (int) ($counts['in_review'] ?? 0),
            'approved' => (int) ($counts['approved'] ?? 0),
            'rejected' => (int) ($counts['rejected'] ?? 0),
            'expired' => (int) ($counts['expired'] ?? 0),
            'expiring' => $this->scoped($checker, $actor, $scope)
                ->whereNotNull('expiration_date')
                ->where('expiration_date', '<=', CarbonImmutable::now()->addDays($this->warnDays()))
                ->count(),
        ];
    }

    private function ownerExists(Actor $actor, string $type, string $id): bool
    {
        $table = match ($type) {
            'carrier' => 'carriers',
            'driver' => 'drivers',
            'truck' => 'trucks',
            'trailer' => 'trailers',
            default => null,
        };

        return $table !== null && DB::table($table)
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $id)
            ->whereNull('deleted_at')
            ->exists();
    }

    /**
     * Los nombres de los dueños de esta página, en cuatro consultas y no una
     * por fila.
     *
     * @param  \Illuminate\Support\Collection<int, Document>  $rows
     * @return array<string, string>
     */
    private function ownerNames($rows): array
    {
        $names = [];

        foreach ([['carrier', 'carriers', 'legal_name'], ['truck', 'trucks', 'unit_number'], ['trailer', 'trailers', 'unit_number']] as [$type, $table, $column]) {
            $ids = $rows->where('owner_type', $type)->pluck('owner_id')->unique()->all();

            if ($ids === []) {
                continue;
            }

            foreach (DB::table($table)->whereIn('id', $ids)->pluck($column, 'id') as $id => $name) {
                $names["{$type}:{$id}"] = (string) $name;
            }
        }

        $driverIds = $rows->where('owner_type', 'driver')->pluck('owner_id')->unique()->all();

        if ($driverIds !== []) {
            foreach (DB::table('drivers')->whereIn('id', $driverIds)->get(['id', 'first_name', 'last_name']) as $d) {
                $names["driver:{$d->id}"] = trim("{$d->first_name} {$d->last_name}");
            }
        }

        return $names;
    }

    private function expiryFlag(Document $d): ?string
    {
        if ($d->expiration_date === null) {
            return null;
        }

        $days = CarbonImmutable::now()->startOfDay()
            ->diffInDays(CarbonImmutable::parse($d->expiration_date)->startOfDay(), false);

        return match (true) {
            $days < 0 => 'expired',
            $days <= $this->warnDays() => 'soon',
            default => null,
        };
    }

    /**
     * @return array<string, mixed>
     */
    private function row(Document $d): array
    {
        return [
            'id' => $d->id,
            'title' => (string) $d->title,
            'documentType' => EnumValue::of($d->document_type, 'other'),
            'ownerType' => (string) $d->owner_type,
            'ownerId' => (string) $d->owner_id,
            'ownerKey' => "{$d->owner_type}:{$d->owner_id}",
            'reviewStatus' => EnumValue::of($d->review_status, 'pending'),
            'isRequired' => (bool) $d->is_required,
            'issueDate' => $this->day($d->issue_date),
            'expirationDate' => $this->day($d->expiration_date),
            'expiryFlag' => $this->expiryFlag($d),
        ];
    }

    private function day(mixed $value): ?string
    {
        return $value === null ? null : mb_substr((string) $value, 0, 10);
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(Document $d): array
    {
        return [
            ...$this->row($d),
            'description' => $d->description,
            'createdAt' => $this->day($d->created_at),
        ];
    }

    /**
     * @return array{type: string, id: string, name: string, href: string|null}
     */
    private function owner(Document $d): array
    {
        $names = $this->ownerNames(collect([$d]));

        return [
            'type' => (string) $d->owner_type,
            'id' => (string) $d->owner_id,
            'name' => $names["{$d->owner_type}:{$d->owner_id}"] ?? '—',
            'href' => match ($d->owner_type) {
                'carrier' => "/carriers/{$d->owner_id}",
                'driver' => "/drivers/{$d->owner_id}",
                'truck' => "/equipment/trucks/{$d->owner_id}",
                'trailer' => "/equipment/trailers/{$d->owner_id}",
                default => null,
            },
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function versions(Document $d): array
    {
        return DB::table('document_versions as v')
            ->leftJoin('users as u', 'u.id', '=', 'v.uploaded_by_user_id')
            ->where('v.document_id', $d->id)
            ->whereNull('v.deleted_at')
            ->orderByDesc('v.version_number')
            ->get([
                'v.id', 'v.version_number', 'v.original_filename', 'v.byte_size',
                'v.sha256', 'v.content_type', 'v.malware_scan_status', 'v.created_at',
                'u.first_name', 'u.last_name',
            ])
            ->map(fn ($v): array => [
                'id' => (string) $v->id,
                'number' => (int) $v->version_number,
                'filename' => (string) $v->original_filename,
                'bytes' => (int) $v->byte_size,
                // Solo el principio del hash. Los 64 caracteres enteros no
                // caben en una línea y nadie los compara a ojo; para eso está
                // la descarga.
                'sha256Prefix' => mb_substr((string) $v->sha256, 0, 16),
                'contentType' => (string) $v->content_type,
                'scanStatus' => (string) $v->malware_scan_status,
                'uploadedAt' => (string) $v->created_at,
                'uploadedBy' => trim("{$v->first_name} {$v->last_name}") ?: null,
                'isCurrent' => $v->id === $d->current_version_id,
            ])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function reviews(Document $d): array
    {
        return DB::table('document_reviews as r')
            ->leftJoin('users as u', 'u.id', '=', 'r.reviewer_user_id')
            ->where('r.document_id', $d->id)
            ->orderByDesc('r.reviewed_at')
            ->get(['r.status', 'r.notes', 'r.reviewed_at', 'u.first_name', 'u.last_name'])
            ->map(fn ($r): array => [
                'decision' => (string) $r->status,
                'notes' => $r->notes,
                'at' => (string) $r->reviewed_at,
                'by' => trim("{$r->first_name} {$r->last_name}") ?: null,
            ])
            ->all();
    }
}
