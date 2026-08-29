<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\AuditAction;
use App\Support\Audit;
use App\Support\Customers\NameKey;
use App\Support\InertiaPage;
use App\Support\Notifications\Notifier;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * El embudo comercial: quién ha llamado a la puerta y qué se ha hecho con él.
 *
 * Tres formularios públicos escriben aquí —contacto, presupuesto y alta de
 * transportista— y hasta ahora nadie podía leerlos. Un transportista que se
 * apuntaba en la web, o un cargador que pedía precio, caía en una tabla que no
 * abría nadie. El permiso `lead:update` ya se describía a sí mismo como
 * «cambiar el estado y la asignación de un prospecto»: esta es la pantalla que
 * faltaba para poder ejercerlo.
 *
 * Cuatro cosas que conviene no deshacer sin pensarlo:
 *
 *  - `tenant_id` lo pone el contexto del dominio al recibir el formulario, NUNCA
 *    el formulario. Un envío desde goliathdispatch.com es un prospecto de la
 *    plataforma y no aparece en la lista de ninguna empresa; el mismo formulario
 *    bajo el dominio propio de una empresa es suyo. Aquí se filtra siempre por
 *    la empresa del actor, que es la otra mitad de esa regla.
 *  - Los estados NO se castean en el modelo. `leads.status` no tiene CHECK en el
 *    esquema, así que el vocabulario vive aquí; y añadirle un cast de enum a
 *    `App\Models\Lead` rompería `PublicFormsTest`, que compara la columna con la
 *    cadena `'new'`. Es exactamente el patrón de `(string)` sobre un enum que ya
 *    ha costado varios lotes: se deja como cadena y se comprueba con `Rule::in`.
 *  - Cambiar el estado y asignar dejan rastro de auditoría. Son actos con
 *    permiso propio, y un acto con permiso propio y sin rastro es un agujero —
 *    el mismo argumento que ya obligó a añadir `driver.verified`.
 *  - Un prospecto no se borra desde aquí. «Perdido» es un estado del embudo y
 *    conserva de dónde vino y qué se hizo; borrarlo tira la única prueba de que
 *    esa persona escribió alguna vez.
 */
final class LeadController
{
    use InertiaPage;

    private const PER_PAGE = 30;

    /**
     * El embudo, en orden.
     *
     * `converted` no lo pone solo esta pantalla: `CarrierSignupController` ya lo
     * escribe cuando el alta de un transportista bajo el dominio de una empresa
     * crea de verdad el transportista. Por eso el vocabulario tiene que
     * incluirlo aunque nadie lo elija a mano.
     *
     * @var list<string>
     */
    private const STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];

    /** @var list<string> */
    private const SOURCES = ['contact_form', 'quote_form', 'carrier_signup'];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'lead:read', null, $policy);

        $this->usesDictionary($request, ['leads', 'users', 'nav', 'common']);

        $filters = $this->filters($request);

        $query = $this->scoped($actor);
        $this->apply($query, $filters);

        $page = $query
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        $filas = collect($page->items());
        $nombres = $this->names($filas->pluck('assigned_to_user_id')->filter()->unique()->all());

        return Inertia::render('App/Leads/Index', [
            'leads' => [
                'data' => $filas->map(fn (object $l): array => $this->row($l, $nombres))->all(),
                'meta' => [
                    'total' => $page->total(),
                    'perPage' => self::PER_PAGE,
                    'currentPage' => $page->currentPage(),
                    'lastPage' => $page->lastPage(),
                ],
            ],
            'filters' => $filters,
            'statuses' => self::STATUSES,
            'sources' => self::SOURCES,
            'counts' => $this->countsByStatus($actor),
            'assignees' => $this->assignees($actor),
            'can' => [
                'update' => $checker->can($actor, 'lead:update', null, $policy)->allowed,
            ],
        ]);
    }

    public function show(Request $request, string $lead, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'lead:read', null, $policy);

        $this->usesDictionary($request, ['leads', 'users', 'nav', 'common', 'validation']);

        $fila = $this->find($actor, $lead);
        $nombres = $this->names(array_filter([$fila->assigned_to_user_id]));

        return Inertia::render('App/Leads/Show', [
            'lead' => [
                ...$this->row($fila, $nombres),
                'message' => $fila->message,
                'sourcePath' => $fila->source_path,
                'utm' => $this->json($fila->utm),
                'ipAddress' => $fila->ip_address,
                'locale' => (string) $fila->locale,
            ],
            'quotes' => $this->quotes($actor, (string) $fila->id),
            'matches' => $this->matches($actor, $fila),
            'statuses' => self::STATUSES,
            'assignees' => $this->assignees($actor),
            'can' => [
                'update' => $checker->can($actor, 'lead:update', null, $policy)->allowed,
                'createCustomer' => $checker->can($actor, 'customer:create', null, $policy)->allowed,
            ],
        ]);
    }

    /**
     * Mover el prospecto por el embudo.
     *
     * Con motivo opcional salvo al perderlo: «perdido» es la única salida que
     * cierra la conversación, y sin el porqué el embudo no enseña nada más que
     * un número que baja.
     */
    public function updateStatus(Request $request, string $lead, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'lead:read', null, $policy);
        $checker->authorize($actor, 'lead:update', null, $policy);

        $fila = $this->find($actor, $lead);

        $data = $request->validate([
            'status' => ['required', 'string', Rule::in(self::STATUSES)],
            'reason' => ['nullable', 'string', 'max:2000', Rule::requiredIf(
                static fn (): bool => $request->input('status') === 'lost'
            )],
        ]);

        $antes = (string) $fila->status;

        if ($antes === $data['status']) {
            return back();
        }

        DB::table('leads')->where('id', $fila->id)->update([
            'status' => $data['status'],
            'updated_at' => CarbonImmutable::now(),
        ]);

        Audit::record(
            $actor,
            AuditAction::LeadStatusChanged,
            entityType: 'lead',
            entityId: (string) $fila->id,
            entityLabel: $this->label($fila),
            before: ['status' => $antes],
            after: ['status' => $data['status']],
            reason: $data['reason'] ?? null,
        );

        return back()->with('success', __('leads.flash.statusChanged', [
            'status' => __('leads.status.'.$data['status']),
        ]));
    }

    /**
     * Poner nombre a quien tiene que llamar.
     *
     * Se acepta la cadena vacía para desasignar: un prospecto sin dueño se ve
     * en la lista con el filtro «sin asignar», y esa es la cola de trabajo.
     */
    public function assign(Request $request, string $lead, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'lead:read', null, $policy);
        $checker->authorize($actor, 'lead:update', null, $policy);

        $fila = $this->find($actor, $lead);

        $data = $request->validate([
            'assigned_to_user_id' => ['nullable', 'string', 'size:36'],
        ]);

        $nuevo = $data['assigned_to_user_id'] ?? null;

        // Se comprueba contra los miembros de ESTA empresa. Sin esto, un id de
        // usuario de otra empresa entraría por la clave foránea —que apunta a
        // `users`, que no lleva tenant_id— y el prospecto quedaría asignado a
        // alguien que ni siquiera puede verlo.
        if ($nuevo !== null && ! $this->isMember($actor, $nuevo)) {
            return back()->with('error', __('leads.errors.notAMember'));
        }

        $antes = $fila->assigned_to_user_id === null ? null : (string) $fila->assigned_to_user_id;

        if ($antes === $nuevo) {
            return back();
        }

        DB::table('leads')->where('id', $fila->id)->update([
            'assigned_to_user_id' => $nuevo,
            'updated_at' => CarbonImmutable::now(),
        ]);

        $nombres = $this->names(array_values(array_filter([$antes, $nuevo])));

        Audit::record(
            $actor,
            AuditAction::LeadAssigned,
            entityType: 'lead',
            entityId: (string) $fila->id,
            entityLabel: $this->label($fila),
            before: ['assigned_to' => $antes === null ? null : ($nombres[$antes] ?? $antes)],
            after: ['assigned_to' => $nuevo === null ? null : ($nombres[$nuevo] ?? $nuevo)],
        );

        // Asignarle a alguien un prospecto y no decírselo convierte la
        // asignación en un apunte contable. El aviso va a quien lo RECIBE, no a
        // quien lo reparte, y solo cuando hay alguien a quien avisar.
        if ($nuevo !== null) {
            Notifier::toUser(
                tenantId: (string) $actor->tenantId,
                userId: $nuevo,
                eventKey: 'lead.assigned',
                dedupeKey: "lead.assigned:{$fila->id}",
                params: ['name' => $this->label($fila)],
                actionUrl: '/leads/'.$fila->id,
                subjectType: 'lead',
                subjectId: (string) $fila->id,
            );
        }

        return back()->with('success', __('leads.flash.assigned'));
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * Los prospectos que este actor puede ver.
     *
     * Sobre `DB::table`, que no lleva el ámbito global de empresa: este `where`
     * es la ÚNICA frontera, y por eso está en un solo sitio por el que pasan
     * todas las consultas de la clase. Los borrados quedan fuera aquí mismo.
     */
    private function scoped(Actor $actor): Builder
    {
        return DB::table('leads')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at');
    }

    private function find(Actor $actor, string $id): object
    {
        $fila = $this->scoped($actor)->where('id', $id)->first();

        if ($fila === null) {
            throw new NotFoundHttpException;
        }

        return $fila;
    }

    /**
     * @return array{status: string, source: string, assigned: string, q: string, from: ?string, to: ?string}
     */
    private function filters(Request $request): array
    {
        return [
            'status' => in_array($request->query('status'), self::STATUSES, true)
                ? (string) $request->query('status')
                : '',
            'source' => in_array($request->query('source'), self::SOURCES, true)
                ? (string) $request->query('source')
                : '',
            // `unassigned` es un valor propio y no un id: la cola de trabajo de
            // un equipo comercial es «lo que no tiene dueño».
            'assigned' => trim((string) $request->query('assigned', '')),
            'q' => trim((string) $request->query('q', '')),
            'from' => $this->fecha($request->query('from')),
            'to' => $this->fecha($request->query('to')),
        ];
    }

    /**
     * @param  array{status: string, source: string, assigned: string, q: string, from: ?string, to: ?string}  $filters
     */
    private function apply(Builder $query, array $filters): void
    {
        if ($filters['status'] !== '') {
            $query->where('status', $filters['status']);
        }

        if ($filters['source'] !== '') {
            $query->where('source', $filters['source']);
        }

        if ($filters['assigned'] === 'unassigned') {
            $query->whereNull('assigned_to_user_id');
        } elseif ($filters['assigned'] !== '') {
            $query->where('assigned_to_user_id', $filters['assigned']);
        }

        if ($filters['from'] !== null) {
            $query->where('created_at', '>=', CarbonImmutable::parse($filters['from'])->startOfDay());
        }

        if ($filters['to'] !== null) {
            $query->where('created_at', '<=', CarbonImmutable::parse($filters['to'])->endOfDay());
        }

        if ($filters['q'] !== '') {
            // Se escapan `%` y `_`, que son comodines de LIKE: sin esto, buscar
            // «100%» devolvería el embudo entero.
            $termino = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['q']).'%';

            $query->where(static function (Builder $q) use ($termino): void {
                $q->where('first_name', 'like', $termino)
                    ->orWhere('last_name', 'like', $termino)
                    ->orWhere('email', 'like', $termino)
                    ->orWhere('company_name', 'like', $termino)
                    ->orWhere('dot_number', 'like', $termino)
                    ->orWhere('mc_number', 'like', $termino);
            });
        }
    }

    /**
     * Cuántos hay en cada estado, sin los demás filtros.
     *
     * Sin filtrar a propósito: los recuadros de arriba son el embudo entero, y
     * si cambiaran con el filtro no se podría usar para navegar.
     *
     * @return array<string, int>
     */
    private function countsByStatus(Actor $actor): array
    {
        // `selectRaw` con alias y NO `pluck(DB::raw(...))`: con una expresión
        // cruda, `pluck` busca en el resultado una propiedad con el nombre de la
        // expresión y revienta en cuanto hay una fila. Con cero filas pasa, que
        // es como esa forma sobrevivió hasta el lote de informes.
        $conteo = $this->scoped($actor)
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status')
            ->all();

        $salida = [];

        foreach (self::STATUSES as $estado) {
            $salida[$estado] = (int) ($conteo[$estado] ?? 0);
        }

        return $salida;
    }

    /**
     * A quién se le puede asignar un prospecto.
     *
     * A cualquier miembro activo de la empresa, no solo a quien tenga
     * `lead:update`: asignarle a alguien un prospecto es decir «llama tú», y
     * quien llama no tiene por qué ser quien mueve el estado.
     *
     * @return list<array{id: string, name: string, email: string}>
     */
    private function assignees(Actor $actor): array
    {
        $ids = DB::table('user_tenant_memberships')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->whereIn('status', ['active', 'invited'])
            ->pluck('user_id')
            ->map(static fn ($id): string => (string) $id)
            ->unique()
            ->all();

        if ($ids === []) {
            return [];
        }

        return app(TenantContext::class)->withoutTenant(fn (): array => DB::table('users')
            ->whereIn('id', $ids)
            ->orderBy('first_name')
            ->orderBy('last_name')
            ->get(['id', 'first_name', 'last_name', 'email'])
            ->map(static fn (object $u): array => [
                'id' => (string) $u->id,
                'name' => trim("{$u->first_name} {$u->last_name}"),
                'email' => (string) $u->email,
            ])
            ->all());
    }

    private function isMember(Actor $actor, string $userId): bool
    {
        return DB::table('user_tenant_memberships')
            ->where('tenant_id', $actor->tenantId)
            ->where('user_id', $userId)
            ->whereNull('deleted_at')
            ->whereIn('status', ['active', 'invited'])
            ->exists();
    }

    /**
     * Las solicitudes de presupuesto de este prospecto.
     *
     * @return list<array<string, mixed>>
     */
    private function quotes(Actor $actor, string $leadId): array
    {
        return DB::table('quote_requests')
            ->where('tenant_id', $actor->tenantId)
            ->where('lead_id', $leadId)
            ->whereNull('deleted_at')
            ->orderByDesc('created_at')
            ->get()
            ->map(static fn (object $q): array => [
                'id' => (string) $q->id,
                'commodity' => $q->commodity,
                'weightPounds' => $q->weight_pounds === null ? null : (int) $q->weight_pounds,
                'lengthInches' => $q->length_inches === null ? null : (int) $q->length_inches,
                'widthInches' => $q->width_inches === null ? null : (int) $q->width_inches,
                'heightInches' => $q->height_inches === null ? null : (int) $q->height_inches,
                'origin' => trim(implode(', ', array_filter([$q->origin_city, $q->origin_state]))),
                'destination' => trim(implode(', ', array_filter([$q->destination_city, $q->destination_state]))),
                'readyDate' => $q->ready_date === null ? null : substr((string) $q->ready_date, 0, 10),
                'equipmentPreference' => $q->equipment_preference,
                'oversizeSuspected' => (bool) $q->is_oversize_suspected,
                'notes' => $q->notes,
                'createdOn' => substr((string) $q->created_at, 0, 10),
            ])
            ->all();
    }

    /**
     * ¿Esta persona ya está en la casa?
     *
     * Se busca por correo y por nombre de empresa antes de proponer crear nada.
     * Un prospecto que escribe por segunda vez no debería acabar en un cliente
     * duplicado — y el alta de clientes tiene su propia detección de
     * duplicados, pero solo salta al guardar, cuando ya se ha tecleado todo.
     *
     * @return array{customers: list<array{id: string, name: string}>, carriers: list<array{id: string, name: string}>}
     */
    private function matches(Actor $actor, object $lead): array
    {
        $empresa = trim((string) ($lead->company_name ?? ''));
        $correo = trim((string) $lead->email);

        // Se compara contra las columnas NORMALIZADAS, que es como el alta de
        // clientes decide si algo está duplicado. Comparando contra las crudas,
        // «Aceros del Norte S.A.» y «Aceros del Norte SA» no se reconocerían —
        // y son la misma empresa escrita por dos personas distintas.
        $clientes = DB::table('customers')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->where(static function (Builder $q) use ($empresa, $correo): void {
                $q->whereRaw('1 = 0');

                if ($correo !== '') {
                    $q->orWhere('email_normalized', mb_strtolower($correo));
                }

                if ($empresa !== '') {
                    $q->orWhere('company_name_normalized', NameKey::for($empresa));
                }
            })
            ->limit(5)
            ->get(['id', 'company_name']);

        $transportistas = DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->where(static function (Builder $q) use ($lead, $empresa): void {
                $q->whereRaw('1 = 0');

                if ($lead->dot_number !== null && $lead->dot_number !== '') {
                    $q->orWhere('dot_number', $lead->dot_number);
                }

                if ($empresa !== '') {
                    $q->orWhere('legal_name', $empresa);
                }
            })
            ->limit(5)
            ->get(['id', 'legal_name']);

        return [
            'customers' => $clientes->map(static fn (object $c): array => [
                'id' => (string) $c->id,
                'name' => (string) $c->company_name,
            ])->all(),
            'carriers' => $transportistas->map(static fn (object $c): array => [
                'id' => (string) $c->id,
                'name' => (string) $c->legal_name,
            ])->all(),
        ];
    }

    /**
     * @param  array<string, string>  $nombres
     * @return array<string, mixed>
     */
    private function row(object $l, array $nombres): array
    {
        $asignado = $l->assigned_to_user_id === null ? null : (string) $l->assigned_to_user_id;

        return [
            'id' => (string) $l->id,
            'firstName' => (string) $l->first_name,
            'lastName' => (string) $l->last_name,
            'name' => $this->label($l),
            'email' => (string) $l->email,
            'phone' => $l->phone,
            'companyName' => $l->company_name,
            'dotNumber' => $l->dot_number,
            'mcNumber' => $l->mc_number,
            'status' => (string) $l->status,
            'source' => (string) $l->source,
            'assignedToId' => $asignado,
            'assignedToName' => $asignado === null ? null : ($nombres[$asignado] ?? null),
            'createdOn' => substr((string) $l->created_at, 0, 10),
            'createdAt' => substr((string) $l->created_at, 0, 19),
        ];
    }

    private function label(object $l): string
    {
        $persona = trim("{$l->first_name} {$l->last_name}");
        $empresa = trim((string) ($l->company_name ?? ''));

        return $empresa === '' ? $persona : "{$persona} · {$empresa}";
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

        return is_array($decodificado) && $decodificado !== [] ? $decodificado : null;
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

        // `users` no lleva `tenant_id`, así que va sin frontera de empresa —
        // pero solo con los ids que la consulta ya acotada devolvió.
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
