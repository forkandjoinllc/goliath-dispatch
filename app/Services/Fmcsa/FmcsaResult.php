<?php

declare(strict_types=1);

namespace App\Services\Fmcsa;

use App\Enums\VerificationStatus;

/**
 * Lo que devuelve una verificación FMCSA, ya normalizado.
 *
 * `raw` NO viaja en este objeto. La respuesta cruda del proveedor puede contener
 * direcciones y nombres de personas, y guardarla entera en una tabla que el
 * sistema conserva siete años multiplicaría el dato personal almacenado sin que
 * nadie lo lea nunca. Se guarda un digest para poder demostrar que dos
 * respuestas eran idénticas.
 */
final readonly class FmcsaResult
{
    /**
     * @param  array<string, mixed>  $normalized
     */
    public function __construct(
        public VerificationStatus $status,
        public array $normalized = [],
        public ?string $rawDigest = null,
        public ?string $errorMessage = null,
        public string $provider = 'mock',
    ) {}
}
