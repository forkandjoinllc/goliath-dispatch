<?php

declare(strict_types=1);

namespace App\Services\Fmcsa;

use App\Enums\FmcsaLookupStatus;

/**
 * Lo que devuelve el directorio: el desenlace, y la ficha si la hay.
 *
 * `live` es el campo que no se puede quitar. Distingue «FMCSA dice esto» de «el
 * adaptador simulado se lo inventó porque no hay credenciales», y de esa
 * distinción depende que la pantalla bloquee los campos o los deje escribir.
 */
final readonly class FmcsaLookup
{
    private function __construct(
        public FmcsaLookupStatus $status,
        public ?FmcsaCarrier $carrier = null,
        public ?string $message = null,
        public bool $live = false,
        public string $provider = 'mock',
    ) {}

    public static function found(FmcsaCarrier $carrier, bool $live, string $provider): self
    {
        return new self(FmcsaLookupStatus::Found, $carrier, null, $live, $provider);
    }

    public static function notFound(bool $live, string $provider): self
    {
        return new self(FmcsaLookupStatus::NotFound, null, null, $live, $provider);
    }

    public static function invalid(string $message, string $provider): self
    {
        return new self(FmcsaLookupStatus::Invalid, null, $message, false, $provider);
    }

    public static function error(string $message, bool $live, string $provider): self
    {
        return new self(FmcsaLookupStatus::Error, null, $message, $live, $provider);
    }
}
