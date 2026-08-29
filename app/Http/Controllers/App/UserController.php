<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Actions\Tenancy\InviteUser;
use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\AuditAction;
use App\Enums\Role;
use App\Enums\Scope;
use App\Enums\UserStatus;
use App\Models\UserTenantMembership;
use App\Notifications\UserInvitation;
use App\Support\Audit;
use App\Support\InertiaPage;
use App\Support\Invitations\Invitations;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Quién trabaja en esta empresa.
 *
 * UNA PERSONA NO ES UNA CUENTA POR EMPRESA. `users` no tiene `tenant_id`: lo que
 * esta pantalla lista son PERTENENCIAS (`user_tenant_memberships`), y la misma
 * dirección de correo puede ser administradora aquí y despachadora en otra casa
 * de despacho. Por eso «quitar a alguien» borra su pertenencia y nunca su
 * cuenta: borrar la cuenta le echaría también de las empresas de otros.
 *
 * Una invitación pendiente es una pertenencia en estado `invited`, no una fila
 * aparte. Salen en la misma lista a propósito: quien mira esta pantalla quiere
 * saber quién tiene acceso, y alguien con una invitación sin caducar lo tiene en
 * cuanto abra su correo.
 *
 * El transportista también invita, pero solo a los suyos: su concesión de
 * `tenant:user:invite` tiene alcance Carrier, así que aquí se le obliga a que el
 * papel sea `carrier` o `driver` y el transportista sea el suyo. No se confía en
 * que el formulario mande lo correcto.
 */
final class UserController
{
    use InertiaPage;

    /**
     * Papeles que se pueden repartir desde esta pantalla.
     *
     * `driver` NO está, y es deliberado. La pertenencia de un conductor necesita
     * además `driver_id`, porque su alcance `own` llega a las cargas por
     * `load_assignments` y sin ese enlace ve la aplicación en blanco. Invitar a
     * un conductor es enlazar una cuenta con una FICHA de conductor que ya
     * existe, y eso es otra pantalla — ofrecerlo aquí a medias crearía cuentas
     * que entran y no ven nada.
     */
    private const ASIGNABLES = [Role::Admin, Role::Accounting, Role::Dispatcher, Role::Carrier];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tenant:user:read', null, $policy);

        $this->usesDictionary($request, ['users', 'nav', 'common']);

        $filas = $this->scoped($checker, $actor, $scope)
            ->orderByRaw("field(status, 'invited', 'active', 'suspended', 'deactivated')")
            ->orderBy('role')
            ->get();

        $personas = $this->people($filas->pluck('user_id')->all());

        return Inertia::render('App/Users/Index', [
            'members' => $filas
                ->map(fn (UserTenantMembership $m): array => [
                    'id' => (string) $m->id,
                    'userId' => (string) $m->user_id,
                    'role' => $m->role->value,
                    'status' => $m->status->value,
                    'carrierId' => $m->carrier_id === null ? null : (string) $m->carrier_id,
                    'invitedAt' => $m->invited_at?->toDateString(),
                    'acceptedAt' => $m->accepted_at?->toDateString(),
                    // Marca quién eres tú en la lista: es lo que evita que
                    // alguien se quite a sí mismo el acceso sin darse cuenta.
                    'isSelf' => (string) $m->user_id === $actor->userId,
                    ...($personas[(string) $m->user_id] ?? []),
                ])
                ->all(),
            'roles' => array_map(fn (Role $r): string => $r->value, $this->assignableFor($actor, $scope)),
            'carriers' => $this->carriers($actor, $scope),
            'requiresCarrier' => [Role::Carrier->value],
            'can' => [
                'invite' => $checker->can($actor, 'tenant:user:invite', null, $policy)->allowed,
                'update' => $checker->can($actor, 'tenant:user:update', null, $policy)->allowed,
                'suspend' => $checker->can($actor, 'tenant:user:suspend', null, $policy)->allowed,
            ],
        ]);
    }

    public function store(Request $request, CurrentActor $current, PermissionChecker $checker, InviteUser $invite): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tenant:user:invite', null, $policy);

        $asignables = array_map(fn (Role $r): string => $r->value, $this->assignableFor($actor, $scope));

        $data = $request->validate([
            'email' => ['required', 'string', 'email:rfc', 'max:255'],
            'first_name' => ['required', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'role' => ['required', 'string', Rule::in($asignables)],
            'carrier_id' => ['nullable', 'string', 'size:36'],
            'locale' => ['required', 'string', Rule::in(['en', 'es'])],
        ]);

        $role = Role::from($data['role']);
        $carrierId = $this->resolveCarrier($actor, $scope, $role, $data['carrier_id'] ?? null);

        $resultado = $invite($actor, $this->companyName($actor), [
            'email' => $data['email'],
            'first_name' => $data['first_name'],
            'last_name' => $data['last_name'],
            'role' => $role,
            'carrier_id' => $carrierId,
            'locale' => $data['locale'],
        ]);

        return back()->with('success', __(
            $resultado['isNewAccount'] ? 'users.flash.invited' : 'users.flash.invitedExisting',
            ['email' => $data['email']],
        ));
    }

    /**
     * Reenviar la invitación.
     *
     * Emite un vale NUEVO, y el de antes deja de valer — ver Invitations::issue.
     * Reenviar el mismo enlace dejaría vivos dos, y el que se mandó a la
     * dirección equivocada seguiría abriendo la puerta una semana entera.
     */
    public function resend(string $membership, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tenant:user:invite', null, $policy);
        $m = $this->find($checker, $actor, $scope, $membership);

        if ($m->status !== UserStatus::Invited) {
            throw ValidationException::withMessages(['status' => __('users.errors.notPending')]);
        }

        $user = $m->user()->withoutGlobalScopes()->firstOrFail();

        $token = Invitations::issue(
            (string) $actor->tenantId,
            (string) $m->user_id,
            (string) $user->email,
            ['role' => $m->role->value, 'membership_id' => (string) $m->id],
        );

        $user->notify(new UserInvitation(
            token: $token,
            companyName: $this->companyName($actor),
            inviterName: $actor->fullName(),
            roleLabelKey: 'users.roles.'.$m->role->value,
            locale: $user->locale->value,
        ));

        return back()->with('success', __('users.flash.resent', ['email' => (string) $user->email]));
    }

    /**
     * Retirar una invitación que todavía no se ha aceptado.
     *
     * Se borra la PERTENENCIA, nunca la cuenta: esa persona puede tener cuenta
     * desde antes y trabajar para otra empresa. Y se quema el vale, porque si no
     * el enlace del correo seguiría creando una pertenencia que acabamos de
     * quitar.
     */
    public function destroy(Request $request, string $membership, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tenant:user:update', null, $policy);
        $m = $this->find($checker, $actor, $scope, $membership);

        $this->guardSelf($actor, $m);

        if ($m->status !== UserStatus::Invited) {
            throw ValidationException::withMessages(['status' => __('users.errors.notPending')]);
        }

        $ahora = CarbonImmutable::now();

        DB::table('user_tenant_memberships')->where('id', $m->id)->update([
            'deleted_at' => $ahora,
            'deleted_by' => $actor->auditUserId(),
            'deletion_reason' => trim((string) $request->input('reason')) ?: null,
            'updated_at' => $ahora,
        ]);

        Invitations::revokeFor((string) $actor->tenantId, (string) $m->user_id);

        Audit::record(
            $actor,
            AuditAction::RoleChanged,
            entityType: 'user_tenant_membership',
            entityId: (string) $m->id,
            entityLabel: (string) $m->user_id,
            before: ['status' => 'invited', 'role' => $m->role->value],
            after: ['status' => 'revoked'],
        );

        return back()->with('success', __('users.flash.revoked'));
    }

    public function updateRole(Request $request, string $membership, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tenant:user:update', null, $policy);
        $m = $this->find($checker, $actor, $scope, $membership);

        $this->guardSelf($actor, $m);

        $asignables = array_map(fn (Role $r): string => $r->value, $this->assignableFor($actor, $scope));

        $data = $request->validate([
            'role' => ['required', 'string', Rule::in($asignables)],
        ]);

        $nuevo = Role::from($data['role']);

        if ($nuevo === $m->role) {
            return back();
        }

        // La clave única es (tenant_id, user_id, role): si ya tiene ese papel por
        // otra pertenencia, el UPDATE reventaría contra la base de datos.
        $choca = UserTenantMembership::query()
            ->where('user_id', $m->user_id)
            ->where('role', $nuevo->value)
            ->whereKeyNot($m->id)
            ->exists();

        if ($choca) {
            throw ValidationException::withMessages(['role' => __('users.errors.alreadyMember')]);
        }

        $this->guardLastAdmin($actor, $m, quitandoAdmin: $m->role === Role::Admin);

        $ahora = CarbonImmutable::now();
        $antes = $m->role->value;

        DB::table('user_tenant_memberships')->where('id', $m->id)->update([
            'role' => $nuevo->value,
            // Cambiar a un papel de transportista sin transportista dejaría a esa
            // persona con alcance Carrier y `carrier_id` en NULL: ScopeFilter
            // devuelve cero filas y la aplicación se le queda en blanco.
            'carrier_id' => in_array($nuevo, [Role::Carrier, Role::Driver], true) ? $m->carrier_id : null,
            'updated_at' => $ahora,
        ]);

        Audit::record(
            $actor,
            AuditAction::RoleChanged,
            entityType: 'user_tenant_membership',
            entityId: (string) $m->id,
            entityLabel: (string) $m->user_id,
            before: ['role' => $antes],
            after: ['role' => $nuevo->value],
        );

        return back()->with('success', __('users.flash.roleChanged'));
    }

    /**
     * Suspender y reactivar.
     *
     * Se toca la PERTENENCIA, no la cuenta. Suspender a alguien aquí no puede
     * dejarle sin entrar en otra empresa donde sigue trabajando.
     */
    public function suspend(Request $request, string $membership, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tenant:user:suspend', null, $policy);
        $m = $this->find($checker, $actor, $scope, $membership);

        $this->guardSelf($actor, $m);

        $suspender = $m->status !== UserStatus::Suspended;

        if ($suspender) {
            $this->guardLastAdmin($actor, $m, quitandoAdmin: $m->role === Role::Admin);
        }

        if (! in_array($m->status, [UserStatus::Active, UserStatus::Suspended], true)) {
            throw ValidationException::withMessages(['status' => __('users.errors.notActive')]);
        }

        $ahora = CarbonImmutable::now();

        DB::table('user_tenant_memberships')->where('id', $m->id)->update([
            'status' => $suspender ? 'suspended' : 'active',
            'updated_at' => $ahora,
        ]);

        Audit::record(
            $actor,
            AuditAction::RoleChanged,
            entityType: 'user_tenant_membership',
            entityId: (string) $m->id,
            entityLabel: (string) $m->user_id,
            before: ['status' => $m->status->value],
            after: ['status' => $suspender ? 'suspended' : 'active'],
            reason: trim((string) $request->input('reason')) ?: null,
        );

        return back()->with('success', __($suspender ? 'users.flash.suspended' : 'users.flash.reactivated'));
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * @return Builder<UserTenantMembership>
     */
    private function scoped(PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        return $checker->scopeFilter($actor, $scope)->apply(
            UserTenantMembership::query()->whereNull('user_tenant_memberships.deleted_at'),
            // El transportista solo ve las pertenencias de SU transportista.
            // `owner` deja que cualquiera se vea a sí mismo.
            ['carrier' => 'carrier_id', 'owner' => 'user_id'],
        );
    }

    private function find(PermissionChecker $checker, Actor $actor, Scope $scope, string $id): UserTenantMembership
    {
        $m = $this->scoped($checker, $actor, $scope)->whereKey($id)->first();

        abort_if($m === null, 404);

        return $m;
    }

    /**
     * Nadie se cambia el papel ni se suspende a sí mismo.
     *
     * No es paternalismo: el único administrador de una empresa que se rebaja a
     * despachador ya no puede volver a subirse, y no hay pantalla desde la que
     * arreglarlo sin meterse en la base de datos.
     */
    private function guardSelf(Actor $actor, UserTenantMembership $m): void
    {
        if ((string) $m->user_id === $actor->userId) {
            throw ValidationException::withMessages(['role' => __('users.errors.notYourself')]);
        }
    }

    /**
     * Una empresa no se puede quedar sin ningún administrador activo.
     *
     * Hoy es un cinturón por encima de los tirantes: `guardSelf` corta antes el
     * único camino por el que se llega —el último administrador rebajándose a sí
     * mismo—, así que esta comprobación casi nunca dispara. Se queda porque el
     * día que se abra otro camino (un administrador de plataforma actuando
     * dentro de la empresa, un traspaso de propiedad) el coste de no tenerla es
     * una empresa a la que nadie puede entrar a arreglar desde dentro.
     */
    private function guardLastAdmin(Actor $actor, UserTenantMembership $m, bool $quitandoAdmin): void
    {
        if (! $quitandoAdmin) {
            return;
        }

        $otros = UserTenantMembership::query()
            ->where('role', Role::Admin->value)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->whereKeyNot($m->id)
            ->count();

        if ($otros === 0) {
            throw ValidationException::withMessages(['role' => __('users.errors.lastAdmin')]);
        }
    }

    /**
     * Los papeles que ESTE actor puede repartir.
     *
     * Con alcance Carrier solo los dos suyos. Un transportista que pudiera
     * invitar administradores se ascendería a sí mismo en dos pasos.
     *
     * @return list<Role>
     */
    private function assignableFor(Actor $actor, Scope $scope): array
    {
        if (! $scope->atLeast(Scope::Tenant)) {
            return [Role::Carrier];
        }

        return self::ASIGNABLES;
    }

    /**
     * Qué transportista le toca a esta invitación.
     *
     * Con alcance Carrier se IGNORA lo que mande el formulario y se usa el del
     * actor. Es la diferencia entre un desplegable que no ofrece otros y un
     * servidor que no los acepta.
     */
    private function resolveCarrier(Actor $actor, Scope $scope, Role $role, ?string $enviado): ?string
    {
        if (! in_array($role, [Role::Carrier, Role::Driver], true)) {
            return null;
        }

        if (! $scope->atLeast(Scope::Tenant)) {
            return $actor->carrierId;
        }

        if ($enviado === null || $enviado === '') {
            throw ValidationException::withMessages(['carrier_id' => __('users.errors.carrierRequired')]);
        }

        $existe = DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $enviado)
            ->whereNull('deleted_at')
            ->exists();

        if (! $existe) {
            throw ValidationException::withMessages(['carrier_id' => __('users.errors.carrierNotFound')]);
        }

        return $enviado;
    }

    /**
     * Nombre, correo y último acceso de las personas de la lista, de una vez.
     *
     * `users` no tiene tenant_id, así que la consulta va sin frontera de empresa
     * — pero solo con los ids que la consulta estrechada ya devolvió, que es lo
     * que impide que esto se convierta en un listado de toda la plataforma.
     *
     * @param  list<string>  $ids
     * @return array<string, array<string, mixed>>
     */
    private function people(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $filas = app(TenantContext::class)->withoutTenant(fn () => DB::table('users')
            ->whereIn('id', $ids)
            ->get(['id', 'first_name', 'last_name', 'email', 'locale', 'last_login_at']));

        $salida = [];

        foreach ($filas as $f) {
            $salida[(string) $f->id] = [
                'name' => trim("{$f->first_name} {$f->last_name}"),
                'email' => (string) $f->email,
                'locale' => (string) $f->locale,
                'lastLoginAt' => $f->last_login_at === null ? null : substr((string) $f->last_login_at, 0, 10),
            ];
        }

        return $salida;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function carriers(Actor $actor, Scope $scope): array
    {
        if (! $scope->atLeast(Scope::Tenant)) {
            return [];
        }

        return DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->orderBy('legal_name')
            ->limit(500)
            ->get(['id', 'legal_name', 'dba_name'])
            ->map(fn ($c): array => [
                'id' => (string) $c->id,
                'name' => (string) ($c->dba_name ?: $c->legal_name),
                'hint' => $c->dba_name ? (string) $c->legal_name : null,
            ])
            ->all();
    }

    private function companyName(Actor $actor): string
    {
        $nombre = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
            ->where('id', $actor->tenantId)
            ->value('display_name'));

        return (string) ($nombre ?? '');
    }
}
