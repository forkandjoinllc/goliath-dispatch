<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Support\InertiaPage;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Los avisos de QUIEN MIRA, y solo los suyos.
 *
 * Esta pantalla no tiene permiso propio, y no es un olvido: un aviso está
 * dirigido a una persona concreta —lleva su `user_id`— y no hay ningún rol al
 * que le corresponda leer los de otra. La frontera aquí no es el permiso, es la
 * identidad, y por eso todas las consultas de la clase pasan por `scoped()`,
 * que filtra por empresa Y por usuario.
 *
 * Las preferencias son igual de personales: se guardan por (empresa, usuario,
 * suceso). Un administrador no decide por sus compañeros de qué se enteran.
 */
final class NotificationController
{
    use InertiaPage;

    private const PER_PAGE = 30;

    /**
     * Los sucesos que hoy se pueden recibir.
     *
     * Lista explícita y no `distinct` sobre la tabla: la pantalla de
     * preferencias tiene que poder ofrecer un suceso que a esta persona todavía
     * no le ha ocurrido nunca. Con `distinct`, quien no hubiera recibido nada no
     * podría configurar nada.
     *
     * @var list<string>
     */
    private const EVENTS = [
        'document.expiring',
        'carrier.reverification_due',
        'invoice.overdue',
        'lead.assigned',
        'subscription.trial_ending',
        'subscription.trial_ended',
    ];

    public function index(Request $request, CurrentActor $current): Response
    {
        $actor = $current->require();

        $this->usesDictionary($request, ['notifications', 'nav', 'common']);

        $soloSinLeer = $request->query('unread') === '1';

        $query = $this->scoped($actor);

        if ($soloSinLeer) {
            $query->whereNull('read_at');
        }

        $page = $query
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        return Inertia::render('App/Notifications/Index', [
            'notifications' => [
                'data' => collect($page->items())->map(static fn (object $n): array => [
                    'id' => (string) $n->id,
                    'eventKey' => (string) $n->event_key,
                    'title' => (string) $n->title,
                    'body' => (string) $n->body,
                    'actionUrl' => $n->action_url,
                    'readAt' => $n->read_at === null ? null : substr((string) $n->read_at, 0, 19),
                    'createdAt' => substr((string) $n->created_at, 0, 19),
                ])->all(),
                'meta' => [
                    'total' => $page->total(),
                    'perPage' => self::PER_PAGE,
                    'currentPage' => $page->currentPage(),
                    'lastPage' => $page->lastPage(),
                ],
            ],
            'filters' => ['unread' => $soloSinLeer ? '1' : ''],
            'events' => self::EVENTS,
            'preferences' => $this->preferences($actor),
        ]);
    }

    /**
     * Marcar uno como leído.
     *
     * Se busca por el id DENTRO de la consulta acotada. Marcar como leído el
     * aviso de otra persona no llegaría a filtrarse a la vista, pero sí le
     * apagaría su campana — y ese es exactamente el tipo de efecto lateral que
     * no se nota hasta que alguien se pierde algo.
     */
    public function read(Request $request, string $notification, CurrentActor $current): RedirectResponse
    {
        $actor = $current->require();

        $this->scoped($actor)
            ->where('id', $notification)
            ->whereNull('read_at')
            ->update(['read_at' => CarbonImmutable::now(), 'updated_at' => CarbonImmutable::now()]);

        return back()->with('success', __('notifications.flash.read'));
    }

    public function readAll(Request $request, CurrentActor $current): RedirectResponse
    {
        $actor = $current->require();

        $this->scoped($actor)
            ->whereNull('read_at')
            ->update(['read_at' => CarbonImmutable::now(), 'updated_at' => CarbonImmutable::now()]);

        return back()->with('success', __('notifications.flash.allRead'));
    }

    /**
     * Guardar de qué se avisa a esta persona.
     *
     * Se escribe fila a fila con `updateOrInsert` y no se borra y reinserta: la
     * tabla tiene un único por (empresa, usuario, suceso) y un borrado seguido
     * de un alta deja una ventana en la que un barrido simultáneo leería «sin
     * fila» y aplicaría los valores por defecto — justo los que esta persona
     * acaba de apagar.
     */
    public function savePreferences(Request $request, CurrentActor $current): RedirectResponse
    {
        $actor = $current->require();

        $data = $request->validate([
            'preferences' => ['required', 'array'],
            'preferences.*.event_key' => ['required', 'string', Rule::in(self::EVENTS)],
            'preferences.*.in_app' => ['required', 'boolean'],
            'preferences.*.email' => ['required', 'boolean'],
        ]);

        $ahora = CarbonImmutable::now();

        foreach ($data['preferences'] as $preferencia) {
            DB::table('notification_preferences')->updateOrInsert(
                [
                    'tenant_id' => $actor->tenantId,
                    'user_id' => $actor->userId,
                    'event_key' => $preferencia['event_key'],
                ],
                [
                    'id' => (string) Str::uuid(),
                    'in_app' => (bool) $preferencia['in_app'],
                    'email' => (bool) $preferencia['email'],
                    'updated_at' => $ahora,
                    'created_at' => $ahora,
                ],
            );
        }

        return back()->with('success', __('notifications.preferences.saved'));
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * Los avisos de esta persona en esta empresa.
     *
     * Empresa Y usuario. Con solo la empresa, un administrador vería los avisos
     * dirigidos a sus compañeros; con solo el usuario, los suyos de otra empresa
     * en la que también trabaja.
     */
    private function scoped(Actor $actor): Builder
    {
        return DB::table('notifications')
            ->where('tenant_id', $actor->tenantId)
            ->where('user_id', $actor->userId)
            // Solo el canal de dentro de la aplicación. Cada aviso se escribe
            // una fila POR CANAL —es el registro de entrega, y hace falta para
            // saber si el correo salió— pero para quien mira son el mismo
            // hecho: sin este filtro la lista enseñaba cada aviso dos veces y
            // no cuadraba con la campana, que sí contaba solo los de dentro.
            ->where('channel', 'in_app')
            ->whereNull('deleted_at');
    }

    /**
     * @return list<array{eventKey: string, inApp: bool, email: bool}>
     */
    private function preferences(Actor $actor): array
    {
        $guardadas = DB::table('notification_preferences')
            ->where('tenant_id', $actor->tenantId)
            ->where('user_id', $actor->userId)
            ->whereNull('deleted_at')
            ->get(['event_key', 'in_app', 'email'])
            ->keyBy('event_key');

        return array_map(static function (string $evento) use ($guardadas): array {
            $fila = $guardadas->get($evento);

            // Sin fila valen los valores por defecto de la tabla: dentro de la
            // aplicación sí, correo sí. Es lo correcto en un producto de
            // cumplimiento — quien no ha tocado nada quiere enterarse de que un
            // documento caduca.
            return [
                'eventKey' => $evento,
                'inApp' => $fila === null ? true : (bool) $fila->in_app,
                'email' => $fila === null ? true : (bool) $fila->email,
            ];
        }, self::EVENTS);
    }

    /**
     * Cuántos sin leer, para la campana del armazón.
     *
     * Vive aquí y no en `AppShell` para que la regla de «solo los míos» esté
     * escrita una vez. Se apoya en `notifications_user_unread_idx`, que el
     * esquema marca con un comentario pidiendo que no se pierda.
     */
    public static function unreadCount(?Actor $actor): int
    {
        if ($actor === null || $actor->tenantId === null || $actor->userId === null) {
            return 0;
        }

        return DB::table('notifications')
            ->where('tenant_id', $actor->tenantId)
            ->where('user_id', $actor->userId)
            ->where('channel', 'in_app')
            ->whereNull('deleted_at')
            ->whereNull('read_at')
            ->count();
    }

    /** @return list<string> */
    public static function events(): array
    {
        return self::EVENTS;
    }
}
