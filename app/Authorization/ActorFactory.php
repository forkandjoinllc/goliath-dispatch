<?php

declare(strict_types=1);

namespace App\Authorization;

use App\Enums\Locale;
use App\Enums\Role;
use App\Enums\Scope;
use App\Models\Session;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Construye el Actor de la petición a partir del usuario y la empresa activa.
 *
 * Es el puente que faltaba entre la autenticación (quién eres) y la
 * autorización (qué puedes hacer). PermissionChecker es una función pura del
 * Actor y no toca la base de datos; TODO el coste de leer pertenencias,
 * asignaciones y excepciones se paga aquí, una vez por petición.
 *
 * Ese reparto es deliberado: `can()` se llama decenas de veces al pintar un menú,
 * y si cada llamada consultara la base de datos, una pantalla con veinte botones
 * haría veinte consultas para decidir cuáles enseñar.
 */
final class ActorFactory
{
    public function __construct(private readonly TenantContext $context) {}

    public function for(User $user, ?string $tenantId = null, ?string $sessionId = null): Actor
    {
        $tenantId ??= $this->context->id();

        $membership = $tenantId === null ? null : $this->context->withoutTenant(
            fn () => DB::table('user_tenant_memberships')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $user->id)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->first()
        );

        $role = $membership === null ? null : Role::tryFrom((string) $membership->role);

        // El Super Admin de plataforma no tiene pertenencia: su ámbito es la
        // plataforma entera y se marca con una bandera en el usuario, no con una
        // fila en user_tenant_memberships. Sin esto se quedaba con rol null y,
        // por tanto, con CERO permisos — podía entrar y no podía hacer nada.
        //
        // Si además pertenece a una empresa y está actuando dentro de ella,
        // manda el rol de la pertenencia: la matriz de plataforma excluye a
        // propósito los datos operativos, que exigen una sesión de soporte
        // explícita (ver RoleMatrix).
        if ($role === null && $user->is_platform_super_admin) {
            $role = Role::PlatformSuperAdmin;
        }
        $session = $sessionId === null ? null : Session::query()->whereKey($sessionId)->first();

        return new Actor(
            userId: $user->id,
            email: $user->email,
            firstName: $user->first_name,
            lastName: $user->last_name,
            locale: $user->locale instanceof Locale ? $user->locale : Locale::from((string) $user->locale),
            timezone: (string) $user->timezone,
            isPlatformSuperAdmin: (bool) $user->is_platform_super_admin,
            tenantId: $membership === null ? null : $tenantId,
            role: $role,
            carrierId: $membership->carrier_id ?? null,
            driverId: $membership->driver_id ?? null,
            assignments: $this->assignments($user, $tenantId, $role),
            overrides: $this->overrides($user, $tenantId),
            mfaRequired: $this->mfaRequired($user),
            mfaSatisfied: $session?->mfa_satisfied_at !== null,
            impersonation: null,
            sessionId: $sessionId,
        );
    }

    /**
     * Lo que un despachador tiene asignado. Para los demás roles es irrelevante:
     * el ámbito `assigned` solo aparece en la matriz del despachador, así que
     * consultarlo para un Admin serían cuatro consultas que nadie mira.
     */
    private function assignments(User $user, ?string $tenantId, ?Role $role): AssignmentScope
    {
        if ($tenantId === null || $role !== Role::Dispatcher) {
            return new AssignmentScope;
        }

        return $this->context->runAs($tenantId, function () use ($user, $tenantId): AssignmentScope {
            $rows = DB::table('dispatcher_resource_assignments')
                ->where('tenant_id', $tenantId)
                ->where('dispatcher_user_id', $user->id)
                ->whereNull('deleted_at')
                // Una asignación con fecha de fin pasada ya no asigna nada. Sin
                // este filtro, un despachador conservaría el acceso a un
                // transportista que dejó de llevar hace meses.
                ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', now()->toDateString()))
                ->where('start_date', '<=', now()->toDateString())
                ->get(['resource_type', 'resource_id']);

            $by = static fn (string $type): array => $rows
                ->where('resource_type', $type)
                ->pluck('resource_id')
                ->unique()
                ->values()
                ->all();

            return new AssignmentScope(
                carrierIds: $by('carrier'),
                truckIds: $by('truck'),
                trailerIds: $by('trailer'),
                driverIds: $by('driver'),
                groupIds: $by('group'),
            );
        });
    }

    /**
     * @return list<PermissionOverride>
     */
    private function overrides(User $user, ?string $tenantId): array
    {
        if ($tenantId === null) {
            return [];
        }

        $rows = $this->context->withoutTenant(fn () => DB::table('user_permission_overrides as o')
            ->join('permissions as p', 'p.id', '=', 'o.permission_id')
            ->where('o.tenant_id', $tenantId)
            ->where('o.user_id', $user->id)
            ->whereNull('o.deleted_at')
            // Una excepción caducada deja de aplicar sola. Es lo que permite
            // conceder un permiso "hasta fin de mes" sin acordarse de quitarlo.
            ->where(fn ($q) => $q->whereNull('o.expires_at')->orWhere('o.expires_at', '>', now()))
            ->get(['p.key', 'o.effect', 'o.scope']));

        return $rows->map(fn ($row): PermissionOverride => new PermissionOverride(
            permissionKey: (string) $row->key,
            effect: PermissionEffect::from((string) $row->effect),
            scope: Scope::from((string) $row->scope),
        ))->all();
    }

    /**
     * Si el usuario tiene un método de segundo factor CONFIRMADO, se le exige.
     *
     * Uno sin confirmar no cuenta: alguien a mitad de la configuración quedaría
     * fuera de su propia cuenta, sin forma de terminar de configurarlo.
     */
    private function mfaRequired(User $user): bool
    {
        return DB::table('mfa_configurations')
            ->where('user_id', $user->id)
            ->whereNotNull('confirmed_at')
            ->whereNull('deleted_at')
            ->exists();
    }
}
