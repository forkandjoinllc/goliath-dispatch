<?php

declare(strict_types=1);

namespace App\Services\Vin;

/**
 * El vivo primero, y el respaldo tapando los huecos.
 *
 * Esta es la pieza que se inyecta de verdad. El orden no es casual:
 *
 *  1. La NHTSA, si está configurada. Es la única que sabe el MODELO.
 *  2. Lo que el propio número dice, para lo que la NHTSA no haya contestado.
 *
 * Con la NHTSA caída, o en una instalación sin salida a internet, el formulario
 * sigue rellenando año y marca. Es la diferencia entre una ayuda que a veces no
 * está y un campo que unos días funciona y otros no.
 */
final class ChainVinDecoder implements VinDecoder
{
    /** @param list<VinDecoder> $decodificadores */
    public function __construct(private readonly array $decodificadores) {}

    public function decode(string $vin): ?DecodedVin
    {
        $resultado = null;

        foreach ($this->decodificadores as $decodificador) {
            $suyo = $decodificador->decode($vin);

            if ($suyo === null) {
                continue;
            }

            $resultado = $resultado === null ? $suyo : $resultado->completarCon($suyo);
        }

        return $resultado;
    }

    /** Vivo si alguno de los suyos lo es: la pantalla lo dice. */
    public function isLive(): bool
    {
        foreach ($this->decodificadores as $decodificador) {
            if ($decodificador->isLive()) {
                return true;
            }
        }

        return false;
    }

    public function name(): string
    {
        return implode('+', array_map(static fn (VinDecoder $d): string => $d->name(), $this->decodificadores));
    }
}
