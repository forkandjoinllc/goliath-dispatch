<?php

declare(strict_types=1);

namespace App\Services\Vin;

/**
 * Quién sabe traducir un VIN a marca, modelo y año.
 *
 * Interfaz y no una clase suelta por la misma razón que el cobro y el FMCSA:
 * la instalación sin salida a internet —o sin ganas de depender de un servicio
 * de fuera— tiene que seguir funcionando, y el camino de «no contesta» hay que
 * poder recorrerlo en una prueba.
 *
 * Devuelve `null` cuando no puede decir NADA. Un resultado con la mitad de los
 * campos vacíos es una respuesta legítima y no un fallo.
 */
interface VinDecoder
{
    public function decode(string $vin): ?DecodedVin;

    /** ¿Está hablando con el servicio de verdad? La pantalla lo dice. */
    public function isLive(): bool;

    public function name(): string;
}
