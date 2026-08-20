<?php

declare(strict_types=1);

namespace App\Authorization;

use App\Enums\Scope;

/**
 * El resultado de una comprobación de permiso.
 *
 * `reasonKey` es una clave i18n, no un mensaje: la pantalla de acceso denegado
 * la traduce al idioma del usuario.
 */
final readonly class Decision
{
    public function __construct(
        public bool $allowed,
        public ?Scope $scope = null,
        public ?string $reasonKey = null,
    ) {}

    public static function allow(Scope $scope): self
    {
        return new self(true, $scope);
    }

    public static function deny(string $reasonKey, ?Scope $scope = null): self
    {
        return new self(false, $scope, $reasonKey);
    }
}
