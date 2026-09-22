<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    /*
    | FMCSA — QCMobile.
    |
    | Sin `FMCSA_WEBKEY` la aplicación ata el adaptador simulado y lo dice en
    | pantalla y en cada fila que escribe. La clave entra por el `.env` DEL
    | SERVIDOR: no se versiona, no se pega en un chat y no se registra en los
    | logs. Se pide en https://mobile.fmcsa.dot.gov/QCDevsite/
    */
    'fmcsa' => [
        'web_key' => env('FMCSA_WEBKEY'),
        'base_url' => env('FMCSA_BASE_URL', 'https://mobile.fmcsa.dot.gov/qc/services'),
    ],

    /*
    | NHTSA vPIC — decodificar un VIN.
    |
    | Es la base oficial de vehículos de EE. UU. y NO pide credenciales: lo
    | único que hace falta es que el servidor tenga salida a ese dominio. Por
    | eso se enciende con una bandera y no con una clave.
    |
    | Apagada, el formulario sigue rellenando AÑO y MARCA —los lee del propio
    | VIN— y deja el MODELO para que lo escriba la persona, porque el modelo no
    | está en el número: vive en las posiciones 4-8, que define cada
    | fabricante. Encendida, la NHTSA contesta también el modelo.
    */
    'nhtsa' => [
        'vin_enabled' => (bool) env('NHTSA_VIN_ENABLED', false),
        'vin_base_url' => env('NHTSA_VIN_BASE_URL', 'https://vpic.nhtsa.dot.gov/api/vehicles'),
        'vin_timeout' => (int) env('NHTSA_VIN_TIMEOUT', 4),
    ],

    /*
    | Stripe — el cobro de la suscripción.
    |
    | Hacen falta LAS DOS. Con solo `STRIPE_SECRET` el adaptador real cobraría y
    | no se enteraría nunca de que le pagaron —los sucesos llegan por el webhook,
    | y sin su secreto no se puede comprobar que vienen de Stripe—, así que la
    | persona pagaría y su suscripción seguiría en `past_due`. Faltando
    | cualquiera de las dos se ata el simulacro, que al menos no cobra.
    |
    | Las dos entran por el `.env` DEL SERVIDOR: no se versionan, no se pegan en
    | un chat y no se registran en los logs.
    */
    'stripe' => [
        'secret' => env('STRIPE_SECRET'),
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
