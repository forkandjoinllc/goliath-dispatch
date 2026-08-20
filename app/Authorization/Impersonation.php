<?php

declare(strict_types=1);

namespace App\Authorization;

/**
 * Presente solo mientras alguien actúa en nombre de otro usuario.
 *
 * `actorUserId` es quien realmente está a los mandos; el Actor que lo contiene
 * describe al usuario suplantado. Todo evento de auditoría emitido durante la
 * sesión guarda ambos, de modo que la pista nunca atribuye una acción a quien no
 * la hizo.
 */
final readonly class Impersonation
{
    public function __construct(
        public string $actorUserId,
        public string $impersonationSessionId,
        public string $reason,
    ) {}
}
