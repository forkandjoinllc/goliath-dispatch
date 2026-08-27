<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * El desenlace de una consulta al registro federal.
 *
 * Cuatro desenlaces y no dos, porque a quien está dando de alta un
 * transportista le importa la diferencia: «ese USDOT no existe» se arregla
 * escribiéndolo bien, y «el registro no contesta» se arregla esperando. Un
 * único `null` para las dos cosas obligaría a la pantalla a mentir en una.
 */
enum FmcsaLookupStatus: string
{
    /** Hay ficha. */
    case Found = 'found';

    /** El registro contestó y no tiene a nadie con ese número. */
    case NotFound = 'not_found';

    /** El número no tiene forma de USDOT o de MC. Ni se preguntó. */
    case Invalid = 'invalid';

    /** El proveedor falló, tardó demasiado o devolvió algo ininteligible. */
    case Error = 'error';
}
