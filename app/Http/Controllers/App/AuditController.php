<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Support\InertiaPage;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * La pista de auditoría, por fin legible.
 *
 * `audit_events` se venía escribiendo desde treinta y siete sitios repartidos
 * por catorce controladores, con el actor real bajo suplantación, resúmenes de
 * antes y después, motivo, IP y petición. Nada de eso se podía leer sin abrir
 * la base de datos: el permiso existía, la entrada del menú existía, y la
 * pantalla no. Esto es esa pantalla.
 *
 * Es SOLO de lectura, y no por prudencia sino por el esquema: dos disparadores
 * rechazan cualquier UPDATE o DELETE sobre la tabla. Una ruta de escritura aquí
 * no podría hacer otra cosa que reventar, así que no la hay.
 *
 * Dos decisiones que conviene no deshacer sin pensarlo:
 *
 *  - Los desplegables de filtro se construyen con lo que HAY en la pista de
 *    esta empresa, no con los 57 casos del enum. Cuarenta de esos casos son de
 *    dominios que aún no están construidos; ofrecerlos sería un desplegable
 *    donde casi toda opción devuelve cero. El diccionario, en cambio, sí trae
 *    los 57 nombres: en cuanto un dominio empiece a escribir, su evento se
 *    pinta con nombre y aparece solo en el filtro.
 *  - Se filtra por `tenant_id` SIEMPRE, también con alcance de plataforma. Un
 *    super administrador mirando esta pantalla está actuando dentro de una
 *    empresa concreta, y mezclarle los eventos de las demás convertiría la
 *    pista de una empresa en la de todas. La vista de plataforma, cuando
 *    exista, será otra pantalla con su propio permiso.
 *
 * Lo que esta pantalla NO puede enseñar, y conviene saberlo: los eventos que se
 * graban sin actor —un intento de acceso fallido, por ejemplo— van con
 * `tenant_id` nulo, porque en ese momento todavía no se sabe de qué empresa
 * son. No aparecen aquí. Hoy no se graba ninguno; cuando se graben, su sitio es
 * la pantalla de seguridad de plataforma, no esta.
 */
final class AuditController
{
    use InertiaPage;

    private const PER_PAGE = 40;

    /** Tope de eventos hermanos que se traen al detalle. */
    private const MAX_HERMANOS = 20;

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'audit:read', null, $current->policy());

        $this->usesDictionary($request, ['audit', 'users', 'nav', 'common']);

        $filters = $this->filters($request);
        $query = $this->scoped($actor);
        $this->apply($query, $filters);

        $page = $query
            ->orderByDesc('occurred_at')
            // Desempate estable: dos eventos de la MISMA petición comparten
            // milisegundo con frecuencia, y sin esto el paginado los baraja
            // entre páginas y alguno no se ve nunca.
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        $filas = collect($page->items());
        $nombres = $this->names($filas->pluck('actor_user_id')->filter()->unique()->all());

        return Inertia::render('App/Audit/Index', [
            'events' => [
                'data' => $filas->map(fn (object $e): array => $this->row($e, $nombres))->all(),
                'meta' => [
                    'total' => $page->total(),
                    'perPage' => self::PER_PAGE,
                    'currentPage' => $page->currentPage(),
                    'lastPage' => $page->lastPage(),
                ],
            ],
            'filters' => $filters,
            'actions' => $this->distinct($actor, 'action'),
            'entityTypes' => $this->distinct($actor, 'entity_type'),
            'actors' => $this->actorOptions($actor),
        ]);
    }

    /**
     * Un evento entero, con el antes y el después y sus hermanos de petición.
     *
     * Los hermanos son el motivo por el que esta pantalla existe y no basta con
     * la lista: una sola acción de una persona —aprobar un gasto, digamos—
     * escribe varios eventos, y leerlos sueltos no cuenta lo que pasó. Se
     * agrupan por `request_id`, que es justo para lo que está el índice
     * `audit_events_request_idx`.
     */
    public function show(Request $request, string $event, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'audit:read', null, $current->policy());

        $this->usesDictionary($request, ['audit', 'users', 'nav', 'common']);

        $fila = $this->scoped($actor)->where('id', $event)->first();

        if ($fila === null) {
            throw new NotFoundHttpException;
        }

        $hermanos = collect();

        if ($fila->request_id !== null && $fila->request_id !== '') {
            $hermanos = $this->scoped($actor)
                ->where('request_id', $fila->request_id)
                ->where('id', '!=', $fila->id)
                ->orderBy('occurred_at')
                ->limit(self::MAX_HERMANOS)
                ->get();
        }

        $ids = $hermanos->pluck('actor_user_id')
            ->push($fila->actor_user_id)
            ->filter()
            ->unique()
            ->all();

        $nombres = $this->names($ids);

        return Inertia::render('App/Audit/Show', [
            'event' => [
                ...$this->row($fila, $nombres),
                'before' => $this->json($fila->before_summary),
                'after' => $this->json($fila->after_summary),
                'ipAddress' => $fila->ip_address,
                'userAgent' => $fila->user_agent,
                'requestId' => $fila->request_id,
                'effectiveUserName' => $fila->effective_user_id === null
                    ? null
                    : ($nombres[(string) $fila->effective_user_id] ?? null),
            ],
            'siblings' => $hermanos->map(fn (object $e): array => $this->row($e, $nombres))->all(),
        ]);
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * La pista que este actor puede ver.
     *
     * Va sobre `DB::table`, que no lleva el ámbito global de empresa: el
     * `where` de abajo es la ÚNICA frontera, y por eso está en un solo sitio
     * por el que pasan las tres consultas de la clase.
     */
    private function scoped(Actor $actor): Builder
    {
        return DB::table('audit_events')->where('tenant_id', $actor->tenantId);
    }

    /**
     * @return array{action: string, entityType: string, actor: string, q: string, from: ?string, to: ?string}
     */
    private function filters(Request $request): array
    {
        return [
            'action' => trim((string) $request->query('action', '')),
            'entityType' => trim((string) $request->query('entityType', '')),
            'actor' => trim((string) $request->query('actor', '')),
            'q' => trim((string) $request->query('q', '')),
            'from' => $this->fecha($request->query('from')),
            'to' => $this->fecha($request->query('to')),
        ];
    }

    /**
     * @param  array{action: string, entityType: string, actor: string, q: string, from: ?string, to: ?string}  $filters
     */
    private function apply(Builder $query, array $filters): void
    {
        if ($filters['action'] !== '') {
            $query->where('action', $filters['action']);
        }

        if ($filters['entityType'] !== '') {
            $query->where('entity_type', $filters['entityType']);
        }

        if ($filters['actor'] !== '') {
            $query->where('actor_user_id', $filters['actor']);
        }

        if ($filters['from'] !== null) {
            $query->where('occurred_at', '>=', CarbonImmutable::parse($filters['from'])->startOfDay());
        }

        if ($filters['to'] !== null) {
            $query->where('occurred_at', '<=', CarbonImmutable::parse($filters['to'])->endOfDay());
        }

        if ($filters['q'] !== '') {
            // Se escapan `%` y `_` porque son comodines de LIKE: sin esto,
            // buscar «100_%» barrería la pista entera.
            $termino = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['q']).'%';

            $query->where(static function (Builder $q) use ($termino, $filters): void {
                $q->where('entity_label', 'like', $termino)
                    ->orWhere('actor_email', 'like', $termino)
                    ->orWhere('reason', 'like', $termino)
                    // Los identificadores se buscan enteros y no por trozo: son
                    // columnas indexadas y un LIKE con comodín delante las
                    // dejaría inservibles.
                    ->orWhere('entity_id', $filters['q'])
                    ->orWhere('request_id', $filters['q']);
            });
        }
    }

    /**
     * Valores distintos de una columna, para poblar un desplegable.
     *
     * @return list<string>
     */
    private function distinct(Actor $actor, string $column): array
    {
        return $this->scoped($actor)
            ->whereNotNull($column)
            ->distinct()
            ->orderBy($column)
            ->limit(100)
            ->pluck($column)
            ->map(static fn ($v): string => (string) $v)
            ->all();
    }

    /**
     * Quién ha dejado rastro en esta empresa, para el desplegable de actor.
     *
     * @return list<array{id: string, name: string, email: string}>
     */
    private function actorOptions(Actor $actor): array
    {
        $filas = $this->scoped($actor)
            ->whereNotNull('actor_user_id')
            ->select('actor_user_id', DB::raw('max(actor_email) as email'))
            ->groupBy('actor_user_id')
            ->limit(200)
            ->get();

        $nombres = $this->names($filas->pluck('actor_user_id')->map(
            static fn ($id): string => (string) $id
        )->all());

        return $filas
            ->map(static fn (object $f): array => [
                'id' => (string) $f->actor_user_id,
                'name' => $nombres[(string) $f->actor_user_id] ?? '',
                'email' => (string) ($f->email ?? ''),
            ])
            ->sortBy(static fn (array $a): string => $a['name'] !== '' ? $a['name'] : $a['email'])
            ->values()
            ->all();
    }

    /**
     * @param  array<string, string>  $nombres
     * @return array<string, mixed>
     */
    private function row(object $e, array $nombres): array
    {
        $actorId = $e->actor_user_id === null ? null : (string) $e->actor_user_id;

        return [
            'id' => (string) $e->id,
            'occurredAt' => (string) $e->occurred_at,
            'action' => (string) $e->action,
            'entityType' => $e->entity_type === null ? null : (string) $e->entity_type,
            'entityId' => $e->entity_id === null ? null : (string) $e->entity_id,
            'entityLabel' => $e->entity_label === null ? null : (string) $e->entity_label,
            'actorId' => $actorId,
            'actorName' => $actorId === null ? null : ($nombres[$actorId] ?? null),
            'actorEmail' => $e->actor_email === null ? null : (string) $e->actor_email,
            'actorRole' => $e->actor_role === null ? null : (string) $e->actor_role,
            'reason' => $e->reason === null ? null : (string) $e->reason,
            // El actor atribuido es quien estaba REALMENTE a los mandos. Cuando
            // además hay sesión de suplantación, la persona suplantada es otra,
            // y eso hay que enseñarlo o el registro engaña por omisión.
            'impersonated' => $e->impersonation_session_id !== null,
            'hasDetail' => $e->before_summary !== null || $e->after_summary !== null,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function json(mixed $valor): ?array
    {
        if ($valor === null || $valor === '') {
            return null;
        }

        $decodificado = json_decode((string) $valor, true);

        // Un resumen ilegible no puede tumbar la pantalla: la pista es de solo
        // añadir, así que una fila mal formada de hace meses seguirá ahí para
        // siempre y esta pantalla tiene que poder enseñar el resto del evento.
        return is_array($decodificado) ? $decodificado : null;
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    private function names(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        // `users` no lleva `tenant_id`, así que la consulta va sin frontera de
        // empresa — pero solo con los ids que la consulta ya estrechada
        // devolvió, que es lo que impide que esto se convierta en un directorio.
        return app(TenantContext::class)->withoutTenant(fn (): array => DB::table('users')
            ->whereIn('id', $ids)
            ->get(['id', 'first_name', 'last_name'])
            ->mapWithKeys(static fn (object $u): array => [
                (string) $u->id => trim("{$u->first_name} {$u->last_name}"),
            ])
            ->all());
    }

    private function fecha(mixed $valor): ?string
    {
        $texto = trim((string) ($valor ?? ''));

        if ($texto === '') {
            return null;
        }

        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $texto) === 1 ? $texto : null;
    }
}
