<?php

declare(strict_types=1);

namespace App\Authorization;

use App\Enums\Scope;

/**
 * Una excepción por usuario superpuesta a la matriz de su rol.
 *
 * Una denegación gana siempre, incluso frente a un Super Admin de plataforma.
 * Esa asimetría es deliberada: la vía de escape debe poder cerrar una puerta con
 * más fuerza de la que tiene cualquier rol para abrirla.
 */
final readonly class PermissionOverride
{
    public function __construct(
        public string $permissionKey,
        public PermissionEffect $effect,
        public Scope $scope,
    ) {}
}
