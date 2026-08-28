<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * Cómo queda un conductor frente a UN requisito de una carga.
 *
 * Tres estados y no dos. «No consta» no es un «no cumple» suave: significa que
 * nadie ha mirado ese dato todavía, y se arregla mirándolo, no buscando otro
 * conductor. Colapsarlo en «no cumple» enseñaría a la gente a ignorar los
 * avisos, que es la única manera de que un aviso deje de servir para nada.
 */
enum EligibilityOutcome: string
{
    case Meets = 'meets';

    case Fails = 'fails';

    case Unknown = 'unknown';
}
