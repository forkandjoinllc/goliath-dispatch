<?php

declare(strict_types=1);

namespace App\Authorization;

use App\Enums\Locale;
use App\Enums\Role;

/**
 * Quién está actuando, resuelto una vez por petición.
 *
 * Es inmutable y autosuficiente a propósito: contiene todo lo que necesita una
 * decisión de autorización, de modo que `can()` es una función pura y puede
 * llamarse tantas veces como haga falta sin coste de base de datos.
 *
 * Un Actor NO es un usuario. Un usuario con acceso a tres empresas produce tres
 * Actores distintos, uno por empresa activa, con roles y asignaciones distintas.
 */
final readonly class Actor
{
    /**
     * @param  list<PermissionOverride>  $overrides
     */
    public function __construct(
        public string $userId,
        public string $email,
        public string $firstName,
        public string $lastName,
        public Locale $locale,
        public string $timezone,
        public bool $isPlatformSuperAdmin,

        /** Nulo solo en contextos de plataforma y en peticiones públicas. */
        public ?string $tenantId = null,
        public ?Role $role = null,

        /** Presente cuando el rol es carrier o driver. */
        public ?string $carrierId = null,
        public ?string $driverId = null,

        public AssignmentScope $assignments = new AssignmentScope,
        public array $overrides = [],

        public bool $mfaRequired = false,
        public bool $mfaSatisfied = false,
        public ?Impersonation $impersonation = null,
        public ?string $sessionId = null,
    ) {}

    public function fullName(): string
    {
        return trim("{$this->firstName} {$this->lastName}");
    }

    public function isImpersonating(): bool
    {
        return $this->impersonation !== null;
    }

    /**
     * El id de usuario al que debe atribuirse una acción en la auditoría.
     * Durante una suplantación es quien está realmente a los mandos, no el
     * usuario suplantado.
     */
    public function auditUserId(): string
    {
        return $this->impersonation->actorUserId ?? $this->userId;
    }

    public function findOverride(string $permissionKey, PermissionEffect $effect): ?PermissionOverride
    {
        foreach ($this->overrides as $override) {
            if ($override->permissionKey === $permissionKey && $override->effect === $effect) {
                return $override;
            }
        }

        return null;
    }

    /** Copia con otra empresa activa; el resto del contexto lo recalcula quien construye el Actor. */
    public function withTenant(?string $tenantId, ?Role $role): self
    {
        return new self(
            userId: $this->userId,
            email: $this->email,
            firstName: $this->firstName,
            lastName: $this->lastName,
            locale: $this->locale,
            timezone: $this->timezone,
            isPlatformSuperAdmin: $this->isPlatformSuperAdmin,
            tenantId: $tenantId,
            role: $role,
            carrierId: null,
            driverId: null,
            assignments: new AssignmentScope,
            overrides: [],
            mfaRequired: $this->mfaRequired,
            mfaSatisfied: $this->mfaSatisfied,
            impersonation: $this->impersonation,
            sessionId: $this->sessionId,
        );
    }
}
