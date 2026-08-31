<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Models\Conversation;
use App\Support\InertiaPage;
use App\Support\Loads\LoadScope;
use App\Support\Messaging\Inbox;
use App\Support\Messaging\MessageScope;
use App\Support\Messaging\Posting;
use App\Support\Messaging\Threads;
use App\Support\Storage\DocumentStore;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Mensajes: la bandeja, el hilo y lo que se escribe en él.
 *
 * Era la última entrada apagada de OPERACIONES. Las cuatro tablas
 * —`conversations`, `conversation_participants`, `messages`,
 * `message_attachments`— llevaban desde el primer día sin una sola consulta, y
 * la matriz de roles YA definía `message:read` y `message:send` en los cinco
 * roles con alcances distintos. Alguien lo diseñó entero y nunca se construyó.
 *
 * Lo que arregla no es una pantalla: es que hoy «¿le avisaste al transportista
 * de que la cita cambió?» se contesta por teléfono y no queda nada. Cuando
 * quince días después el cliente reclama una detención, la conversación que
 * decidía quién tiene razón está en el móvil de alguien.
 *
 * La decisión que gobierna todo lo demás está en MessageScope: **un hilo se ve
 * si estás dentro de él, también si eres administrador**. Merece leerse allí.
 */
final class MessageController
{
    use InertiaPage;

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'message:read', null, $policy);

        $this->usesDictionary($request, ['messages', 'loads', 'nav', 'common', 'validation']);

        $pagina = Inbox::page($checker, $actor, $scope, filtros: [
            'kind' => $request->query('kind'),
            'q' => $request->query('q'),
        ]);

        $ids = collect($pagina->items())->map(static fn ($c): string => (string) $c->id)->all();

        $noLeidos = Inbox::unreadCounts($ids, (string) $actor->userId);
        $ultimos = Inbox::lastMessages($ids);
        $nombres = $this->loadNumbers($pagina->items());

        return Inertia::render('App/Messages/Index', [
            'threads' => [
                'data' => collect($pagina->items())->map(fn (Conversation $c): array => [
                    'id' => (string) $c->id,
                    'subject' => $c->subject,
                    'kind' => (string) $c->kind,
                    'loadId' => $c->load_id === null ? null : (string) $c->load_id,
                    'loadNumber' => $c->load_id === null ? null : ($nombres[(string) $c->load_id] ?? null),
                    'lastMessageAt' => $c->last_message_at === null
                        ? null
                        : substr((string) $c->last_message_at, 0, 16),
                    'unread' => $noLeidos[(string) $c->id] ?? 0,
                    'preview' => $ultimos[(string) $c->id] ?? null,
                ])->all(),
                'meta' => [
                    'total' => $pagina->total(),
                    'perPage' => $pagina->perPage(),
                    'currentPage' => $pagina->currentPage(),
                    'lastPage' => $pagina->lastPage(),
                ],
            ],
            'filters' => [
                'kind' => $request->query('kind'),
                'q' => $request->query('q'),
            ],
            'kinds' => Threads::KINDS,
        ]);
    }

    public function show(Request $request, string $conversation, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'message:read', null, $policy);

        $this->usesDictionary($request, ['messages', 'loads', 'nav', 'common', 'validation']);

        $hilo = $this->find($checker, $actor, $scope, $conversation);

        // Abrir el hilo es leerlo. Se marca aquí y no con un botón: un «marcar
        // como leído» que hay que pulsar deja la bandeja mintiendo para todo el
        // que no lo pulse, que es todo el mundo.
        Posting::markRead((string) $hilo->id, (string) $actor->userId);

        return Inertia::render('App/Messages/Show', [
            'thread' => [
                'id' => (string) $hilo->id,
                'subject' => $hilo->subject,
                'kind' => (string) $hilo->kind,
                'isOperational' => (bool) $hilo->is_operational,
                'loadId' => $hilo->load_id === null ? null : (string) $hilo->load_id,
                'loadNumber' => $hilo->load_id === null
                    ? null
                    : DB::table('loads')->where('id', $hilo->load_id)->value('load_number'),
            ],
            'messages' => Inbox::messages((string) $hilo->id),
            'participants' => $this->participants((string) $hilo->id),
            // ¿Hay alguien del transportista aquí dentro?
            //
            // Un hilo de carga con un solo lado es EXACTAMENTE el fallo que este
            // módulo viene a arreglar, escrito en software: despacho escribe «la
            // cita se mueve a las 14:00», nadie lo lee nunca, y quince días
            // después la discusión sobre la detención no tiene dónde mirarse.
            //
            // Y pasa solo, sin que nada falle: el transportista está dado de alta
            // pero su gente todavía no tiene cuenta, que es el estado normal
            // durante las primeras semanas de una relación. `addCarrierUsers()`
            // no encuentra a nadie a quien meter y el hilo queda a medias, con la
            // única señal de que la lista de participantes es corta — que es
            // pedirle a alguien que note una ausencia.
            'carrierMissing' => $this->carrierMissing($hilo),
            'me' => (string) $actor->userId,
            'maxKb' => Posting::MAX_KB,
            'can' => [
                'send' => $checker->can($actor, 'message:send', null, $policy)->allowed,
            ],
        ]);
    }

    public function store(Request $request, string $conversation, CurrentActor $current, PermissionChecker $checker, DocumentStore $store): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'message:send', null, $policy);

        $hilo = $this->find($checker, $actor, $scope, $conversation);

        $datos = $request->validate([
            'body' => ['required', 'string', 'max:8000'],
            'file' => [
                'nullable',
                'file',
                'max:'.Posting::MAX_KB,
                // Por MIME real y no por la extensión del nombre: `mimetypes:`
                // mira el contenido con finfo.
                'mimetypes:application/pdf,image/jpeg,image/png,image/webp,image/heic,image/tiff',
            ],
        ]);

        $mensaje = Posting::say($actor, (string) $hilo->id, $datos['body']);

        if ($request->hasFile('file')) {
            Posting::attach($actor, $mensaje, $request->file('file'), $store);
        }

        // Quien escribe ha leído lo anterior por definición.
        Posting::markRead((string) $hilo->id, (string) $actor->userId);

        return back()->with('success', __('messages.flash.sent'));
    }

    /**
     * Abre (o encuentra) el hilo de una carga y lleva allí.
     *
     * Redirección y no una pantalla propia: el hilo de una carga es un hilo como
     * los demás, y tener dos pantallas para lo mismo obligaría a mantener dos
     * veces la vista de mensajes. Lo único propio de la carga es CÓMO se llega.
     */
    public function forLoad(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'message:send', null, $policy);

        // El alcance de la CARGA, no el de los mensajes: quien no puede ver la
        // carga no puede abrirle un hilo. Si se comprobara solo el de mensajes,
        // un despachador podría abrir el hilo de una carga que no lleva y
        // meterse dentro — y a partir de ahí la regla de pertenencia le daría
        // acceso legítimamente.
        $alcanceCarga = $checker->authorize($actor, 'load:read', null, $policy);

        $carga = LoadScope::apply(\App\Models\Load::query(), $checker, $actor, $alcanceCarga)
            ->where('loads.id', $load)
            ->first();

        if ($carga === null) {
            throw new NotFoundHttpException;
        }

        $hilo = Threads::forLoad($actor, (string) $carga->id);

        return redirect('/messages/'.$hilo->id);
    }

    /** Saca a alguien del hilo, o se sale uno mismo. */
    public function removeParticipant(Request $request, string $conversation, string $user, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'message:send', null, $policy);

        $hilo = $this->find($checker, $actor, $scope, $conversation);

        if (! Threads::removeParticipant($actor, (string) $hilo->id, $user)) {
            throw new NotFoundHttpException;
        }

        // Si se ha salido uno mismo, el hilo ya no se ve: llevar a la bandeja en
        // vez de a una pantalla que va a contestar 404.
        return $user === $actor->userId
            ? redirect('/messages')->with('success', __('messages.flash.left'))
            : back()->with('success', __('messages.flash.removed'));
    }

    private function find(PermissionChecker $checker, Actor $actor, Scope $scope, string $id): Conversation
    {
        $hilo = MessageScope::apply(Conversation::query(), $checker, $actor, $scope)
            ->where('conversations.id', $id)
            ->first();

        if ($hilo === null) {
            // 404 y no 403. Aquí importa más que en ningún otro sitio: un 403
            // sobre un hilo privado confirmaría que esa conversación existe, que
            // es la mitad de lo que quien fisgonea quiere saber.
            throw new NotFoundHttpException;
        }

        return $hilo;
    }

    /**
     * ¿Es este un hilo de carga sin nadie del transportista dentro?
     *
     * Nulo cuando la pregunta no aplica —un directo, un aviso general, o un hilo
     * de carga todavía sin transportista—. Con nombre cuando aplica y falta.
     */
    private function carrierMissing(Conversation $hilo): ?string
    {
        if ($hilo->kind !== 'load' || $hilo->carrier_id === null) {
            return null;
        }

        $hayAlguien = DB::table('conversation_participants as p')
            ->join('user_tenant_memberships as m', function ($j) use ($hilo): void {
                $j->on('m.user_id', '=', 'p.user_id')
                    ->where('m.tenant_id', '=', $hilo->tenant_id)
                    ->where('m.carrier_id', '=', $hilo->carrier_id)
                    ->whereNull('m.deleted_at');
            })
            ->where('p.conversation_id', $hilo->id)
            ->whereNull('p.left_at')
            ->whereNull('p.deleted_at')
            ->exists();

        if ($hayAlguien) {
            return null;
        }

        return (string) DB::table('carriers')->where('id', $hilo->carrier_id)->value('legal_name');
    }

    /** @return list<array<string, mixed>> */
    private function participants(string $conversationId): array
    {
        return DB::table('conversation_participants as p')
            ->join('users as u', 'u.id', '=', 'p.user_id')
            ->where('p.conversation_id', $conversationId)
            ->whereNull('p.left_at')
            ->whereNull('p.deleted_at')
            ->orderBy('p.created_at')
            ->get(['p.user_id', 'p.role', 'p.last_read_at', 'u.first_name', 'u.last_name', 'u.email'])
            ->map(static fn ($p): array => [
                'userId' => (string) $p->user_id,
                'role' => (string) $p->role,
                'name' => trim((string) $p->first_name.' '.(string) $p->last_name) ?: (string) $p->email,
                'lastReadAt' => $p->last_read_at === null ? null : substr((string) $p->last_read_at, 0, 16),
            ])
            ->all();
    }

    /**
     * Los números de carga de esta página, en una consulta y no una por fila.
     *
     * @param  list<Conversation>  $hilos
     * @return array<string, string>
     */
    private function loadNumbers(array $hilos): array
    {
        $ids = collect($hilos)->pluck('load_id')->filter()->unique()->values()->all();

        if ($ids === []) {
            return [];
        }

        return DB::table('loads')
            ->whereIn('id', $ids)
            ->pluck('load_number', 'id')
            ->map(static fn ($n): string => (string) $n)
            ->all();
    }
}
