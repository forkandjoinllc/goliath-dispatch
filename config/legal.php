<?php

declare(strict_types=1);

return [
    /*
    |--------------------------------------------------------------------------
    | Versión de las políticas
    |--------------------------------------------------------------------------
    |
    | Se graba en cada fila de `consent_records`. Un consentimiento que solo dice
    | «aceptó» no prueba a QUÉ texto aceptó, y el texto cambia: cuando se
    | modifiquen la política de privacidad o los términos, se sube esta versión y
    | los consentimientos nuevos quedan atados al texto nuevo, sin reescribir los
    | viejos — que siguen siendo válidos para la versión que sí aceptaron.
    |
    | Formato: fecha de publicación del texto, ISO 8601.
    |
    */
    'policy_version' => env('LEGAL_POLICY_VERSION', '2026-08-20'),
];
