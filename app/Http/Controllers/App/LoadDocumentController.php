<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Models\Load;
use App\Support\Documents\DocumentTypes;
use App\Support\Documents\LoadFile;
use App\Support\EnumValue;
use App\Support\InertiaPage;
use App\Support\Loads\Guards;
use App\Support\Loads\LoadScope;
use App\Support\Storage\DocumentStore;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Los papeles de una carga: albarán, comprobante de entrega, tiques, recibos.
 *
 * Aparte del formulario genérico de documentos, y a propósito. Aquel elige el
 * dueño de una LISTA —que sirve para cuatro camiones y para treinta
 * transportistas, pero no para las decenas de miles de cargas que acumula una
 * empresa en un año—. Aquí el dueño ya está decidido por la URL, y a cambio se
 * puede ofrecer lo que allí no cabía: DE QUÉ PARADA es cada papel.
 *
 * El `stop_id` no es un adorno. Una carga con tres entregas tiene tres
 * comprobantes, y «el comprobante de la carga» no distingue si falta el de la
 * segunda. La columna estaba en el esquema desde el principio y ninguna
 * pantalla la ofrecía.
 *
 * Y esta pantalla es donde se ve si la puerta de `pod_received` abre o no —la
 * que estuvo cerrada para siempre porque buscaba un tipo de documento que el
 * CHECK del esquema no admite—. Se calcula con `Guards::blocking()`, la misma
 * llamada que hace el cambio de estado, y no con una consulta propia: dos
 * implementaciones de la misma pregunta acaban contestando distinto, y entonces
 * la pantalla dice «listo» y el botón dice «bloqueado».
 */
final class LoadDocumentController
{
    use InertiaPage;

    /**
     * 25 MB. Un comprobante de entrega es una foto hecha con el móvil desde la
     * cabina, y las de un móvil moderno pasan de 10 MB sin esforzarse. Cortar
     * más abajo obligaría al conductor a buscar cómo reducirla, que es lo que
     * hace que el papel no llegue nunca.
     */
    private const MAX_KB = 25600;

    public function index(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'load:read', null, $policy);

        $this->usesDictionary($request, ['loads', 'documents', 'nav', 'common', 'validation']);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        return Inertia::render('App/Loads/Documents', [
            'load' => [
                'id' => (string) $carga->id,
                'number' => (string) $carga->load_number,
                'status' => EnumValue::of($carga->status),
                'podReceivedAt' => $carga->pod_received_at === null
                    ? null
                    : substr((string) $carga->pod_received_at, 0, 16),
            ],
            'documents' => LoadFile::forLoad((string) $carga->id),
            'stops' => $this->stops((string) $carga->id),
            'types' => DocumentTypes::forOwner('load'),
            // Lo que le falta a esta carga para poder marcar «comprobante
            // recibido». Vacío = ya se puede.
            'podBlocking' => Guards::blocking($carga, 'pod_received'),
            'maxKb' => self::MAX_KB,
            'can' => [
                'upload' => $checker->can($actor, 'load:document:upload', null, $policy)->allowed,
                'download' => $checker->can($actor, 'document:download', null, $policy)->allowed,
            ],
        ]);
    }

    public function store(Request $request, string $load, CurrentActor $current, PermissionChecker $checker, DocumentStore $store): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'load:document:upload', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        $datos = $request->validate([
            'file' => [
                'required',
                'file',
                'max:'.self::MAX_KB,
                // Por MIME real, no por la extensión del nombre: `mimetypes:`
                // mira el contenido con finfo, no la cadena que mandó el
                // navegador. Un `.pdf` que por dentro es otra cosa no pasa.
                'mimetypes:application/pdf,image/jpeg,image/png,image/webp,image/heic,image/tiff',
            ],
            // Solo los tipos de carga. Colgar aquí un `certificate_of_insurance`
            // lo dejaría fuera de la lista de documentos del transportista, que
            // es donde vence y donde alguien lo vigila.
            'document_type' => ['required', Rule::in(DocumentTypes::forOwner('load'))],
            'stop_id' => ['nullable', 'string', 'size:36'],
            'title' => ['nullable', 'string', 'max:200'],
        ]);

        $stopId = $datos['stop_id'] ?? null;

        // La parada tiene que ser DE ESTA CARGA. Sin esto, un id de parada de
        // otra carga —o de otra empresa— entraría en `load_documents` y el
        // comprobante saldría colgado de un sitio al que no pertenece.
        if ($stopId !== null && ! $this->stopBelongsToLoad((string) $carga->id, $stopId)) {
            throw ValidationException::withMessages([
                'stop_id' => __('loads.documents.stopNotOnLoad'),
            ]);
        }

        LoadFile::attach(
            actor: $actor,
            loadId: (string) $carga->id,
            documentType: $datos['document_type'],
            file: $request->file('file'),
            store: $store,
            stopId: $stopId,
            title: $datos['title'] ?? null,
        );

        return back()->with('success', __('loads.documents.uploaded'));
    }

    public function destroy(Request $request, string $load, string $link, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'load:document:upload', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        $datos = $request->validate([
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        if (! LoadFile::detach($actor, (string) $carga->id, $link, $datos['reason'] ?? null)) {
            throw new NotFoundHttpException;
        }

        return back()->with('success', __('loads.documents.detached'));
    }

    /**
     * Las paradas de la carga, para el desplegable.
     *
     * @return list<array<string, mixed>>
     */
    private function stops(string $loadId): array
    {
        // El JOIN con `customer_locations` NO es opcional.
        //
        // Una parada puede apuntar a una ubicación del cliente —`customer_location_id`—
        // o llevar su propia dirección escrita a mano en `facility_name`/`city`/`state`.
        // Las cargas normales usan lo primero, y entonces las columnas propias de
        // la parada están TODAS a NULL. Leyendo solo la fila de `load_stops` el
        // desplegable salía «Parada 1: recogida» y «Parada 2: entrega»: dos
        // etiquetas que no dicen dónde, que es lo único que se necesita saber
        // para elegir de qué parada es un comprobante.
        //
        // Se vio abriendo la pantalla. No lo habría visto ninguna prueba de las
        // que había: las pruebas montan paradas escribiéndoles la dirección a
        // mano, que es justo el caso que sí funcionaba.
        return DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.load_id', $loadId)
            ->whereNull('s.deleted_at')
            ->orderBy('s.sequence')
            ->get([
                's.id', 's.stop_type', 's.sequence', 's.facility_name', 's.city', 's.state',
                'cl.name as location_name', 'cl.city as location_city', 'cl.state as location_state',
            ])
            ->map(static fn ($s): array => [
                'id' => (string) $s->id,
                'type' => (string) $s->stop_type,
                'sequence' => (int) $s->sequence,
                // Se prefiere la del cliente cuando existe: es la que alguien
                // mantiene al día.
                'name' => ($s->location_name ?? $s->facility_name) === null
                    ? null
                    : (string) ($s->location_name ?? $s->facility_name),
                'city' => ($s->location_city ?? $s->city) === null
                    ? null
                    : (string) ($s->location_city ?? $s->city),
                'state' => ($s->location_state ?? $s->state) === null
                    ? null
                    : (string) ($s->location_state ?? $s->state),
            ])
            ->all();
    }

    private function stopBelongsToLoad(string $loadId, string $stopId): bool
    {
        return DB::table('load_stops')
            ->where('id', $stopId)
            ->where('load_id', $loadId)
            ->whereNull('deleted_at')
            ->exists();
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
