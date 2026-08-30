<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Clave del sello de integridad
    |--------------------------------------------------------------------------
    |
    | Con esta clave se firma el HMAC que sella cada registro de firma. No está
    | en la base de datos a propósito: quien pueda modificar una fila no debe
    | poder volver a sellarla.
    |
    | Si se deja vacía, `App\Support\Signatures\Seal` deriva una a partir de
    | APP_KEY para que la aplicación funcione sin configurar nada. Es una red de
    | seguridad, no la recomendación: en producción conviene poner un valor
    | propio, porque una clave derivada de APP_KEY deja de validar los sellos
    | anteriores el día que se rote APP_KEY.
    |
    */

    'pepper' => env('SIGNATURE_HASH_PEPPER'),

    /*
    |--------------------------------------------------------------------------
    | Vida del enlace de firma
    |--------------------------------------------------------------------------
    |
    | Días por defecto y tope. A diferencia del enlace de seguimiento, aquí el
    | valor puede ser nulo: un acuerdo de transportista se manda para que se
    | firme, no para que caduque, y quien lo envía decide.
    |
    */

    'default_expiry_days' => 30,
    'max_expiry_days' => 365,

];
