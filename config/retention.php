<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Purga permanente
    |--------------------------------------------------------------------------
    |
    | APAGADA de fábrica, y no por cobardía: el coste de las dos equivocaciones
    | no se parece en nada. Purgar de menos deja unos gigabytes de más en una
    | tabla. Purgar de más borra la prueba de un pleito.
    |
    | Con esto apagado, el barrido archiva —que es marcar, y se deshace— y la
    | pantalla de retención enseña EN SECO qué se purgaría. Una empresa lo
    | enciende el día que ha leído esa lista, no antes.
    |
    */
    'purge_enabled' => (bool) env('RETENTION_PURGE_ENABLED', false),

];
