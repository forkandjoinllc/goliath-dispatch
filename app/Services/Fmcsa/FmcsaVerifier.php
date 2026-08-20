<?php

declare(strict_types=1);

namespace App\Services\Fmcsa;

/**
 * La verificación de un transportista contra FMCSA.
 *
 * Existe como interfaz y no como una llamada suelta porque la aplicación tiene
 * que poder arrancar y demostrarse SIN credenciales del proveedor. Cuando no las
 * hay, se ata el adaptador simulado; cuando las haya, se ata el real y no cambia
 * ni una línea de los controladores.
 */
interface FmcsaVerifier
{
    public function verify(string $dotNumber, ?string $mcNumber, ?string $legalName): FmcsaResult;

    /** Lo que se guarda en la fila para que nadie confunda simulacro con realidad. */
    public function name(): string;
}
