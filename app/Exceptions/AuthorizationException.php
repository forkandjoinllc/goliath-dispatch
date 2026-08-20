<?php

declare(strict_types=1);

namespace App\Exceptions;

use RuntimeException;

/**
 * Se lanza cuando el actor no puede realizar la acción.
 *
 * `reasonKey` es una clave i18n. El manejador la traduce; el mensaje en inglés
 * que lleva la excepción es solo para los registros.
 */
class AuthorizationException extends RuntimeException
{
    public function __construct(
        public readonly string $reasonKey,
        public readonly ?string $permission = null,
        public readonly int $status = 403,
    ) {
        parent::__construct("Forbidden: {$reasonKey}".($permission ? " ({$permission})" : ''));
    }

    public static function unauthenticated(): self
    {
        return new self('errors.unauthenticated', null, 401);
    }

    public static function forbidden(string $reasonKey, ?string $permission = null): self
    {
        return new self($reasonKey, $permission);
    }
}
