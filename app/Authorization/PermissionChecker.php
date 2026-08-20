<?php

declare(strict_types=1);

namespace App\Authorization;

use App\Enums\Scope;
use App\Exceptions\AuthorizationException;

/**
 * El único sitio donde se decide la autorización.
 *
 * `can()` responde sí/no y con qué ámbito; `authorize()` lanza. Ambos son
 * funciones puras del Actor — sin acceso a base de datos — así que son lo bastante
 * baratos como para llamarlos en un renderizado y triviales de probar.
 *
 * Nada de la interfaz decide el acceso. Los componentes preguntan `can()`; los
 * controladores llaman `authorize()`. Los nombres de rol aparecen en un solo
 * sitio: la matriz de RoleMatrix.
 *
 * Portado de src/lib/permissions/check.ts.
 */
final class PermissionChecker
{
    /**
     * @param  array{allow_dispatcher_resource_assignment?: bool}|null  $policy  ajustes de la empresa
     */
    public function can(
        ?Actor $actor,
        string $permission,
        ?ResourceContext $resource = null,
        ?array $policy = null,
    ): Decision {
        // Una errata en la clave debe romper en las pruebas, no conceder silencio.
        if (! Permissions::exists($permission)) {
            throw new \InvalidArgumentException("Permiso desconocido: {$permission}");
        }

        if ($actor === null) {
            return Decision::deny('errors.unauthenticated');
        }

        // Una denegación explícita gana sobre todo, incluido un Super Admin.
        if ($actor->findOverride($permission, PermissionEffect::Deny) !== null) {
            return Decision::deny('errors.permissionDenied');
        }

        if ($actor->mfaRequired && ! $actor->mfaSatisfied) {
            return Decision::deny('errors.mfaRequired');
        }

        /** @var list<Scope> $grants */
        $grants = [];

        if ($actor->role !== null) {
            $matrix = RoleMatrix::resolve($actor->role, $policy);
            if (isset($matrix[$permission])) {
                $grants[] = $matrix[$permission];
            }
        }

        if ($grant = $actor->findOverride($permission, PermissionEffect::Grant)) {
            $grants[] = $grant->scope;
        }

        if ($grants === []) {
            return Decision::deny('errors.permissionDenied');
        }

        // Gana la concesión más ancha; el recurso la estrecha después.
        usort($grants, static fn (Scope $a, Scope $b): int => $b->rank() <=> $a->rank());
        $scope = $grants[0];

        if ($resource === null) {
            return Decision::allow($scope);
        }

        return $this->resourceInScope($actor, $scope, $resource)
            ? Decision::allow($scope)
            : Decision::deny('errors.outOfScope', $scope);
    }

    /** Evalúa si un registro concreto cae dentro del ámbito concedido. */
    public function resourceInScope(Actor $actor, Scope $scope, ResourceContext $resource): bool
    {
        if ($scope === Scope::Platform) {
            return true;
        }

        // Todo ámbito que no sea de plataforma es, ante todo, una frontera de empresa.
        if ($resource->tenantId !== null && $resource->tenantId !== $actor->tenantId) {
            return false;
        }

        // Scope::Platform ya volvió arriba y por eso no tiene brazo aquí. Si
        // alguna vez llegase, PHP lanza UnhandledMatchError — que es la reacción
        // correcta a un invariante roto en una decisión de autorización: fallar
        // ruidosamente, no conceder por defecto.
        return match ($scope) {
            Scope::Tenant => $actor->tenantId !== null,

            Scope::Assigned => $this->matchesAssignment($actor, $resource),

            Scope::Carrier => $actor->carrierId !== null
                && $resource->carrierId === $actor->carrierId,

            Scope::Own => $this->matchesOwn($actor, $resource),
        };
    }

    private function matchesAssignment(Actor $actor, ResourceContext $resource): bool
    {
        $a = $actor->assignments;

        if ($resource->carrierId !== null && in_array($resource->carrierId, $a->carrierIds, true)) {
            return true;
        }
        if ($resource->dispatcherUserId !== null && $resource->dispatcherUserId === $actor->userId) {
            return true;
        }
        if ($resource->truckId !== null && in_array($resource->truckId, $a->truckIds, true)) {
            return true;
        }
        if ($resource->trailerId !== null && in_array($resource->trailerId, $a->trailerIds, true)) {
            return true;
        }
        if ($resource->driverId !== null && in_array($resource->driverId, $a->driverIds, true)) {
            return true;
        }
        if ($resource->groupId !== null && in_array($resource->groupId, $a->groupIds, true)) {
            return true;
        }

        // Un recurso sin ningún hecho de ámbito no puede demostrarse dentro.
        return false;
    }

    private function matchesOwn(Actor $actor, ResourceContext $resource): bool
    {
        if ($resource->ownerUserId !== null && $resource->ownerUserId === $actor->userId) {
            return true;
        }
        if ($resource->driverId !== null && $actor->driverId !== null
            && $resource->driverId === $actor->driverId) {
            return true;
        }
        if ($resource->dispatcherUserId !== null && $resource->dispatcherUserId === $actor->userId) {
            return true;
        }

        return false;
    }

    /**
     * Lanza AuthorizationException salvo que el actor pueda hacerlo.
     *
     * @param  array{allow_dispatcher_resource_assignment?: bool}|null  $policy
     * @return Scope el ámbito concedido, para estrechar la consulta que venga después
     */
    public function authorize(
        ?Actor $actor,
        string $permission,
        ?ResourceContext $resource = null,
        ?array $policy = null,
    ): Scope {
        $decision = $this->can($actor, $permission, $resource, $policy);

        if ($decision->allowed && $decision->scope !== null) {
            return $decision->scope;
        }

        if ($actor === null) {
            throw AuthorizationException::unauthenticated();
        }

        throw AuthorizationException::forbidden(
            $decision->reasonKey ?? 'errors.permissionDenied',
            $permission,
        );
    }

    /**
     * Verdadero si el actor tiene el permiso con cualquier ámbito. Para decidir
     * si un elemento de menú se muestra siquiera.
     *
     * @param  list<string>  $permissions
     * @param  array{allow_dispatcher_resource_assignment?: bool}|null  $policy
     */
    public function canAny(?Actor $actor, array $permissions, ?array $policy = null): bool
    {
        foreach ($permissions as $permission) {
            if ($this->can($actor, $permission, null, $policy)->allowed) {
                return true;
            }
        }

        return false;
    }

    /** Los hechos de estrechamiento que la capa de datos debe aplicar. */
    public function scopeFilter(Actor $actor, Scope $scope): ScopeFilter
    {
        return ScopeFilter::for($actor, $scope);
    }
}
