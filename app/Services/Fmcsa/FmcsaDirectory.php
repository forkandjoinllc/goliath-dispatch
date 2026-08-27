<?php

declare(strict_types=1);

namespace App\Services\Fmcsa;

/**
 * Consultar el registro federal para TRAER la ficha de un transportista.
 *
 * Es distinto de FmcsaVerifier, y por eso son dos interfaces. El verificador
 * responde «¿cuadra lo que el transportista dijo con lo que dice el registro?»
 * y su respuesta es un estado. El directorio responde «¿quién es el USDOT
 * 1234567?» y su respuesta son datos que se van a escribir en un formulario.
 * Juntarlas obligaría a que dar de alta a alguien pasara por verificarlo, que
 * es justo al revés del orden en que ocurre.
 *
 * Existe como interfaz porque la aplicación tiene que arrancar y demostrarse
 * SIN credenciales del proveedor: sin ellas se ata el adaptador simulado, que
 * dice de sí mismo que lo es.
 */
interface FmcsaDirectory
{
    public function byDot(string $dotNumber): FmcsaLookup;

    public function byDocket(string $mcNumber): FmcsaLookup;

    /** Lo que se guarda en la fila para que nadie confunda simulacro con realidad. */
    public function name(): string;

    /** Verdadero solo si detrás hay una consulta real al registro. */
    public function isLive(): bool;
}
