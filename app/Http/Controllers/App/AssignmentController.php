<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\AuditAction;
use App\Enums\Role;
use App\Enums\Scope;
use App\Support\Audit;
use App\Support\InertiaPage;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Qué lleva cada despachador.
 *
 * ESTO ES LO QUE HACE FUNCIONAR EL ÁMBITO `assigned`. La matriz de roles le da
 * al despachador alcance `Assigned` sobre cargas, transportistas, equipos,
 * conductores y gastos, y ScopeFilter lo traduce a un `where in (…)` con los ids
 * que salgan de aquí. Sin una fila en esta tabla, un despachador entra con sus
 * quince permisos y ve una lista vacía en todas las pantallas. Hasta ahora las
 * únicas filas las ponía el sembrador de demostración.
 *
 * Se escribe en `dispatcher_resource_assignments` y NO en
 * `carrier_dispatcher_assignments`, que existe en el esquema y no la lee nadie:
 * ActorFactory solo mira la primera. Mantener las dos significaría dos verdades
 * sobre quién lleva qué, y la que decide el acceso sería la que nadie está
 * mirando. La segunda tiene `is_primary`, que es un concepto que aquí no existe
 * todavía; el día que haga falta un «despachador principal» por transportista,
 * o se usa esa tabla de verdad o se quita.
 *
 * Retirar una asignación le pone FECHA DE FIN en lugar de borrarla. La pregunta
 * «¿quién llevaba esta carga en marzo?» se contesta con el histórico, y un
 * borrado la deja sin respuesta.
 */
final class AssignmentController
{
    use InertiaPage;

    /** @var list<string> */
    private const TIPOS = ['carrier', 'truck', 'trailer', 'driver', 'group'];

    /** Los que puede contener un grupo. Un grupo dentro de otro grupo, no. */
    private const TIPOS_DE_GRUPO = ['carrier', 'truck', 'trailer', 'driver'];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'assignment:read', null, $policy);

        $this->usesDictionary($request, ['assignments', 'nav', 'common']);

        $despachadores = $this->dispatchers($actor, $scope);
        $puedeGestionar = $checker->can($actor, 'assignment:manage', null, $policy)->allowed;

        return Inertia::render('App/Assignments/Index', [
            'dispatchers' => $this->withAssignments($actor, $despachadores),
            'groups' => $this->groups($actor),
            // Los desplegables solo se mandan a quien puede asignar. Un
            // despachador mirando lo suyo no necesita el catálogo entero de la
            // empresa, y mandárselo sería enseñarle nombres que su ámbito le
            // niega en todas las demás pantallas.
            'resources' => $puedeGestionar ? $this->resources($actor) : null,
            'types' => self::TIPOS,
            'groupTypes' => self::TIPOS_DE_GRUPO,
            'can' => [
                'manage' => $puedeGestionar,
                'commission' => $checker->can($actor, 'assignment:commission:update', null, $policy)->allowed,
            ],
            'onlyMine' => ! $scope->atLeast(Scope::Tenant),
        ]);
    }

    public function store(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'assignment:manage', null, $current->policy());

        $data = $request->validate([
            'dispatcher_user_id' => ['required', 'string', 'size:36'],
            'resource_type' => ['required', 'string', Rule::in(self::TIPOS)],
            'resource_id' => ['required', 'string', 'size:36'],
            'start_date' => ['nullable', 'date'],
            'end_date' => ['nullable', 'date', 'after:start_date'],
            'reason' => ['nullable', 'string', 'max:2000'],
        ]);

        $this->requireDispatcher($actor, $data['dispatcher_user_id']);
        $etiqueta = $this->requireResource($actor, $data['resource_type'], $data['resource_id']);

        $ahora = CarbonImmutable::now();
        $inicio = isset($data['start_date'])
            ? CarbonImmutable::parse($data['start_date'])
            : $ahora;

        // Ya la lleva: no se crea una segunda fila. La clave única incluye
        // start_date, así que la base de datos NO lo impediría — dejaría dos
        // asignaciones vivas del mismo recurso y una fecha de fin puesta a una
        // sola no quitaría el acceso.
        $viva = DB::table('dispatcher_resource_assignments')
            ->where('tenant_id', $actor->tenantId)
            ->where('dispatcher_user_id', $data['dispatcher_user_id'])
            ->where('resource_type', $data['resource_type'])
            ->where('resource_id', $data['resource_id'])
            ->whereNull('deleted_at')
            ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', $ahora))
            ->exists();

        if ($viva) {
            throw ValidationException::withMessages(['resource_id' => __('assignments.errors.alreadyAssigned')]);
        }

        $id = (string) Str::uuid();

        DB::table('dispatcher_resource_assignments')->insert([
            'id' => $id,
            'tenant_id' => $actor->tenantId,
            'dispatcher_user_id' => $data['dispatcher_user_id'],
            'resource_type' => $data['resource_type'],
            'resource_id' => $data['resource_id'],
            'start_date' => $inicio,
            'end_date' => isset($data['end_date']) ? CarbonImmutable::parse($data['end_date']) : null,
            'assigned_by_user_id' => $actor->auditUserId(),
            'reason' => $data['reason'] ?? null,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        Audit::record(
            $actor,
            AuditAction::PermissionChanged,
            entityType: 'dispatcher_resource_assignment',
            entityId: $id,
            entityLabel: $etiqueta,
            after: [
                'dispatcher_user_id' => $data['dispatcher_user_id'],
                'resource_type' => $data['resource_type'],
                'resource_id' => $data['resource_id'],
            ],
            reason: $data['reason'] ?? null,
        );

        return back()->with('success', __('assignments.flash.assigned', ['name' => $etiqueta]));
    }

    /**
     * Retirar: fecha de fin hoy, no borrado.
     *
     * ActorFactory descarta las que tengan `end_date` anterior a hoy, así que el
     * acceso se corta al siguiente inicio de sesión — y la fila sigue ahí para
     * contestar quién llevaba qué el mes pasado.
     */
    public function end(string $assignment, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'assignment:manage', null, $current->policy());

        $fila = DB::table('dispatcher_resource_assignments')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $assignment)
            ->whereNull('deleted_at')
            ->first(['id', 'resource_type', 'resource_id', 'dispatcher_user_id', 'end_date']);

        abort_if($fila === null, 404);

        $ahora = CarbonImmutable::now();

        DB::table('dispatcher_resource_assignments')->where('id', $fila->id)->update([
            // Ayer y no hoy: el filtro de ActorFactory es `end_date >= hoy`, así
            // que poner hoy la dejaría viva el resto del día. Quien retira una
            // asignación quiere que deje de valer ahora.
            'end_date' => $ahora->subDay(),
            'updated_at' => $ahora,
        ]);

        Audit::record(
            $actor,
            AuditAction::PermissionChanged,
            entityType: 'dispatcher_resource_assignment',
            entityId: (string) $fila->id,
            entityLabel: (string) $fila->resource_id,
            before: ['end_date' => $fila->end_date],
            after: ['end_date' => $ahora->subDay()->toDateString()],
        );

        return back()->with('success', __('assignments.flash.ended'));
    }

    /**
     * El porcentaje de comisión del despachador.
     *
     * Vive en `dispatcher_profiles` y tiene permiso propio
     * (`assignment:commission:update`): quién lleva qué y cuánto cobra por ello
     * son dos decisiones distintas, y no tienen por qué tomarlas las mismas
     * personas.
     */
    public function commission(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'assignment:commission:update', null, $current->policy());

        $data = $request->validate([
            'dispatcher_user_id' => ['required', 'string', 'size:36'],
            // Puntos básicos, igual que la columna: 2500 son 25,00 %. El
            // formulario enseña el porcentaje y convierte en el borde.
            'commission_bps' => ['required', 'integer', 'min:0', 'max:10000'],
        ]);

        $this->requireDispatcher($actor, $data['dispatcher_user_id']);

        $ahora = CarbonImmutable::now();
        $existente = DB::table('dispatcher_profiles')
            ->where('tenant_id', $actor->tenantId)
            ->where('user_id', $data['dispatcher_user_id'])
            ->first(['id', 'commission_bps']);

        if ($existente === null) {
            DB::table('dispatcher_profiles')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $actor->tenantId,
                'user_id' => $data['dispatcher_user_id'],
                'commission_bps' => (int) $data['commission_bps'],
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ]);
        } else {
            DB::table('dispatcher_profiles')->where('id', $existente->id)->update([
                'commission_bps' => (int) $data['commission_bps'],
                'updated_at' => $ahora,
            ]);
        }

        Audit::record(
            $actor,
            AuditAction::PermissionChanged,
            entityType: 'dispatcher_profile',
            entityId: (string) $data['dispatcher_user_id'],
            entityLabel: (string) $data['dispatcher_user_id'],
            before: ['commission_bps' => $existente->commission_bps ?? null],
            after: ['commission_bps' => (int) $data['commission_bps']],
        );

        // Los puntos básicos de una carga YA ACORDADA no se tocan: viven en la
        // propia carga y en las instantáneas. Esto es el valor por defecto de
        // las que vengan.
        return back()->with('success', __('assignments.flash.commissionSaved'));
    }

    // ------------------------------------------------------------------ grupos

    public function storeGroup(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'assignment:manage', null, $current->policy());

        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:2000'],
        ]);

        $ahora = CarbonImmutable::now();

        // El nombre es único entre los vivos (`live_name_key`). Se contesta antes
        // de que reviente el índice, con un mensaje que se entiende.
        $repetido = DB::table('dispatcher_groups')
            ->where('tenant_id', $actor->tenantId)
            ->where('name', $data['name'])
            ->whereNull('deleted_at')
            ->exists();

        if ($repetido) {
            throw ValidationException::withMessages(['name' => __('assignments.errors.groupExists')]);
        }

        DB::table('dispatcher_groups')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $actor->tenantId,
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'active' => true,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return back()->with('success', __('assignments.flash.groupCreated'));
    }

    public function addMember(Request $request, string $group, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'assignment:manage', null, $current->policy());

        $data = $request->validate([
            'member_type' => ['required', 'string', Rule::in(self::TIPOS_DE_GRUPO)],
            'member_id' => ['required', 'string', 'size:36'],
        ]);

        $grupo = $this->requireGroup($actor, $group);
        $etiqueta = $this->requireResource($actor, $data['member_type'], $data['member_id']);

        $ahora = CarbonImmutable::now();

        DB::table('group_members')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'tenant_id' => $actor->tenantId,
            'group_id' => $grupo->id,
            'member_type' => $data['member_type'],
            'member_id' => $data['member_id'],
            'added_by_user_id' => $actor->auditUserId(),
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return back()->with('success', __('assignments.flash.memberAdded', ['name' => $etiqueta]));
    }

    public function removeMember(string $group, string $member, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'assignment:manage', null, $current->policy());

        $grupo = $this->requireGroup($actor, $group);
        $ahora = CarbonImmutable::now();

        DB::table('group_members')
            ->where('tenant_id', $actor->tenantId)
            ->where('group_id', $grupo->id)
            ->where('id', $member)
            ->update([
                'deleted_at' => $ahora,
                'deleted_by' => $actor->auditUserId(),
                'updated_at' => $ahora,
            ]);

        return back()->with('success', __('assignments.flash.memberRemoved'));
    }

    /**
     * Activar o desactivar un grupo.
     *
     * Desactivarlo deja de conceder a TODOS los despachadores que lo tengan
     * asignado a la vez — ver ActorFactory::groupMembers. Es la forma de cortar
     * un reparto entero sin ir asignación por asignación.
     */
    public function toggleGroup(string $group, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'assignment:manage', null, $current->policy());

        $grupo = $this->requireGroup($actor, $group);
        $ahora = CarbonImmutable::now();
        $nuevo = ! (bool) $grupo->active;

        DB::table('dispatcher_groups')->where('id', $grupo->id)->update([
            'active' => $nuevo,
            'updated_at' => $ahora,
        ]);

        Audit::record(
            $actor,
            AuditAction::PermissionChanged,
            entityType: 'dispatcher_group',
            entityId: (string) $grupo->id,
            entityLabel: (string) $grupo->name,
            before: ['active' => (bool) $grupo->active],
            after: ['active' => $nuevo],
        );

        return back()->with('success', __($nuevo ? 'assignments.flash.groupOn' : 'assignments.flash.groupOff'));
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * Los despachadores de la empresa, con su comisión.
     *
     * Un despachador con alcance `own` se ve solo a sí mismo: la pantalla le
     * sirve para saber qué lleva, no para auditar a sus compañeros.
     *
     * @return list<array<string, mixed>>
     */
    private function dispatchers(Actor $actor, Scope $scope): array
    {
        $query = DB::table('user_tenant_memberships as m')
            ->where('m.tenant_id', $actor->tenantId)
            ->where('m.role', Role::Dispatcher->value)
            ->whereNull('m.deleted_at')
            ->whereIn('m.status', ['active', 'invited', 'suspended']);

        if (! $scope->atLeast(Scope::Tenant)) {
            $query->where('m.user_id', $actor->userId);
        }

        $filas = $query->orderBy('m.created_at')->get(['m.user_id', 'm.status']);
        $ids = $filas->pluck('user_id')->all();

        if ($ids === []) {
            return [];
        }

        // `users` no lleva tenant_id, así que va sin frontera — pero solo con los
        // ids que la consulta de arriba ya acotó a esta empresa.
        $personas = app(TenantContext::class)->withoutTenant(fn () => DB::table('users')
            ->whereIn('id', $ids)
            ->get(['id', 'first_name', 'last_name', 'email'])
            ->keyBy('id'));

        $perfiles = DB::table('dispatcher_profiles')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('user_id', $ids)
            ->whereNull('deleted_at')
            ->pluck('commission_bps', 'user_id');

        return $filas
            ->map(function ($f) use ($personas, $perfiles): array {
                $p = $personas[$f->user_id] ?? null;

                return [
                    'userId' => (string) $f->user_id,
                    'name' => $p === null ? '' : trim("{$p->first_name} {$p->last_name}"),
                    'email' => $p === null ? '' : (string) $p->email,
                    'status' => (string) $f->status,
                    'commissionBps' => (int) ($perfiles[$f->user_id] ?? 0),
                    'hasProfile' => isset($perfiles[$f->user_id]),
                ];
            })
            ->values()
            ->all();
    }

    /**
     * Le cuelga a cada despachador lo que lleva vivo hoy.
     *
     * @param  list<array<string, mixed>>  $despachadores
     * @return list<array<string, mixed>>
     */
    private function withAssignments(Actor $actor, array $despachadores): array
    {
        $ids = array_map(static fn (array $d): string => (string) $d['userId'], $despachadores);

        if ($ids === []) {
            return [];
        }

        $hoy = CarbonImmutable::now();

        $filas = DB::table('dispatcher_resource_assignments')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('dispatcher_user_id', $ids)
            ->whereNull('deleted_at')
            ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', $hoy))
            ->orderBy('resource_type')
            ->get(['id', 'dispatcher_user_id', 'resource_type', 'resource_id', 'start_date', 'end_date']);

        $etiquetas = $this->labelsFor($actor, $filas);

        return array_map(static function (array $d) use ($filas, $etiquetas): array {
            $suyas = $filas
                ->where('dispatcher_user_id', $d['userId'])
                ->map(static fn ($a): array => [
                    'id' => (string) $a->id,
                    'type' => (string) $a->resource_type,
                    'resourceId' => (string) $a->resource_id,
                    'label' => $etiquetas[(string) $a->resource_type][(string) $a->resource_id]
                        ?? __('assignments.unknownResource'),
                    'startDate' => substr((string) $a->start_date, 0, 10),
                    'endDate' => $a->end_date === null ? null : substr((string) $a->end_date, 0, 10),
                ])
                ->values()
                ->all();

            return [...$d, 'assignments' => $suyas];
        }, $despachadores);
    }

    /**
     * Los nombres de todo lo asignado, en una consulta por tipo.
     *
     * @param  Collection<int, object>  $filas
     * @return array<string, array<string, string>>
     */
    private function labelsFor(Actor $actor, Collection $filas): array
    {
        $salida = [];

        foreach (self::TIPOS as $tipo) {
            $ids = $filas->where('resource_type', $tipo)->pluck('resource_id')->unique()->all();

            if ($ids === []) {
                continue;
            }

            foreach ($this->catalogue($actor, $tipo, $ids) as $fila) {
                $salida[$tipo][(string) $fila['id']] = (string) $fila['name'];
            }
        }

        return $salida;
    }

    /**
     * Los desplegables: todo lo que se puede repartir.
     *
     * @return array<string, list<array<string, mixed>>>
     */
    private function resources(Actor $actor): array
    {
        $salida = [];

        foreach (self::TIPOS as $tipo) {
            $salida[$tipo] = $this->catalogue($actor, $tipo, null);
        }

        return $salida;
    }

    /**
     * Un catálogo por tipo, con nombre presentable.
     *
     * Una sola función y no cinco métodos porque lo único que cambia entre tipos
     * son la tabla y las columnas del nombre; cinco copias se separan en cuanto
     * alguien toque una.
     *
     * @param  list<string>|null  $ids  null = todos
     * @return list<array{id: string, name: string, hint: string|null}>
     */
    private function catalogue(Actor $actor, string $tipo, ?array $ids): array
    {
        [$tabla, $columnas, $nombre] = match ($tipo) {
            'carrier' => ['carriers', ['id', 'legal_name', 'dba_name'],
                static fn ($r): string => (string) ($r->dba_name ?: $r->legal_name)],
            'truck' => ['trucks', ['id', 'unit_number', 'make', 'model'],
                static fn ($r): string => (string) $r->unit_number],
            'trailer' => ['trailers', ['id', 'unit_number', 'make', 'model'],
                static fn ($r): string => (string) $r->unit_number],
            'driver' => ['drivers', ['id', 'first_name', 'last_name'],
                static fn ($r): string => trim("{$r->first_name} {$r->last_name}")],
            'group' => ['dispatcher_groups', ['id', 'name', 'description'],
                static fn ($r): string => (string) $r->name],
            default => ['carriers', ['id', 'legal_name', 'dba_name'],
                static fn ($r): string => (string) $r->legal_name],
        };

        $query = DB::table($tabla)
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at');

        if ($ids !== null) {
            $query->whereIn('id', $ids);
        }

        return $query
            ->limit(1000)
            ->get($columnas)
            ->map(static function ($r) use ($nombre): array {
                $name = $nombre($r);

                $hint = match (true) {
                    property_exists($r, 'make') => trim(((string) ($r->make ?? '')).' '.((string) ($r->model ?? ''))) ?: null,
                    property_exists($r, 'legal_name') => (string) $r->legal_name,
                    property_exists($r, 'description') => $r->description === null ? null : (string) $r->description,
                    default => null,
                };

                return [
                    'id' => (string) $r->id,
                    'name' => $name,
                    // Sin pista si repite el nombre: un transportista sin nombre
                    // comercial saldría dos veces lo mismo, una debajo de otra.
                    'hint' => $hint === $name ? null : $hint,
                ];
            })
            ->sortBy('name')
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function groups(Actor $actor): array
    {
        $grupos = DB::table('dispatcher_groups')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->orderBy('name')
            ->get(['id', 'name', 'description', 'active']);

        if ($grupos->isEmpty()) {
            return [];
        }

        $miembros = DB::table('group_members')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('group_id', $grupos->pluck('id')->all())
            ->whereNull('deleted_at')
            ->get(['id', 'group_id', 'member_type', 'member_id']);

        $etiquetas = [];

        foreach (self::TIPOS_DE_GRUPO as $tipo) {
            $ids = $miembros->where('member_type', $tipo)->pluck('member_id')->unique()->all();

            if ($ids === []) {
                continue;
            }

            foreach ($this->catalogue($actor, $tipo, $ids) as $fila) {
                $etiquetas[$tipo][(string) $fila['id']] = (string) $fila['name'];
            }
        }

        return $grupos
            ->map(static fn ($g): array => [
                'id' => (string) $g->id,
                'name' => (string) $g->name,
                'description' => $g->description,
                'active' => (bool) $g->active,
                'members' => $miembros
                    ->where('group_id', $g->id)
                    ->map(static fn ($m): array => [
                        'id' => (string) $m->id,
                        'type' => (string) $m->member_type,
                        'label' => $etiquetas[(string) $m->member_type][(string) $m->member_id]
                            ?? __('assignments.unknownResource'),
                    ])
                    ->values()
                    ->all(),
            ])
            ->values()
            ->all();
    }

    /**
     * Que sea despachador DE ESTA EMPRESA.
     *
     * Sin esto se podría asignarle media flota a un usuario con papel de
     * contabilidad: no le serviría de nada —su matriz no tiene alcance
     * `assigned`— pero la lista diría una cosa que no es.
     */
    private function requireDispatcher(Actor $actor, string $userId): void
    {
        $existe = DB::table('user_tenant_memberships')
            ->where('tenant_id', $actor->tenantId)
            ->where('user_id', $userId)
            ->where('role', Role::Dispatcher->value)
            ->whereNull('deleted_at')
            ->exists();

        if (! $existe) {
            throw ValidationException::withMessages([
                'dispatcher_user_id' => __('assignments.errors.notADispatcher'),
            ]);
        }
    }

    /**
     * Que el recurso exista y sea de esta empresa. Devuelve su nombre.
     */
    private function requireResource(Actor $actor, string $tipo, string $id): string
    {
        $catalogo = $this->catalogue($actor, $tipo, [$id]);

        if ($catalogo === []) {
            throw ValidationException::withMessages([
                'resource_id' => __('assignments.errors.resourceNotFound'),
            ]);
        }

        return (string) $catalogo[0]['name'];
    }

    private function requireGroup(Actor $actor, string $id): object
    {
        $grupo = DB::table('dispatcher_groups')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $id)
            ->whereNull('deleted_at')
            ->first(['id', 'name', 'active']);

        abort_if($grupo === null, 404);

        return $grupo;
    }
}
