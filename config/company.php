<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| La empresa que opera la plataforma
|--------------------------------------------------------------------------
|
| Estos son los datos de Goliath Dispatch LLC, no los de una empresa cliente.
| Se usan en el sitio público de la plataforma —goliathdispatch.com— y en los
| documentos legales.
|
| Los datos de cada empresa CLIENTE viven en `tenant_settings`, que ya tiene sus
| columnas de domicilio y contacto. Cuando el sitio se sirve bajo el dominio
| verificado de un cliente, lo que se enseña es el suyo: estampar el domicilio
| de Goliath en la página de un cliente sería decirle a los visitantes de ese
| cliente que la empresa está en Davie. Ver App\Support\Company.
|
| Están en configuración y no en base de datos porque no son un dato de negocio
| que cambie solo: cambian cuando la empresa se muda, y eso pasa por un
| despliegue de todas formas.
|
*/

return [
    'legal_name' => 'Goliath Dispatch LLC',

    'address' => [
        'line1' => '4474 Weston Rd',
        'line2' => 'Unit #2130',
        'city' => 'Davie',
        'state' => 'FL',
        'postal_code' => '33331',
        // Código ISO de dos letras: el NOMBRE del país se traduce en el
        // diccionario, porque el sitio es bilingüe y «United States» no se
        // escribe igual en las dos versiones.
        'country' => 'US',
    ],

    // Tal y como se enseña. El enlace `tel:` se construye en el componente
    // quitando todo lo que no sea dígito: un teléfono se lee mejor con
    // paréntesis y se marca mejor sin ellos.
    'phone' => '(888) 909-9037',
    // El mismo número en formato E.164, para el enlace `tel:`. Explícito y no
    // deducido: adivinar el prefijo de país a partir de diez dígitos funciona
    // hasta el día que la empresa tenga un número que no sea de EE. UU.
    'phone_href' => '+18889099037',
    'email' => 'info@goliathdispatch.com',

    // Despacho de carga pesada: un camión que se avería a las tres de la
    // mañana no espera a que abra la oficina. `true` pinta «24 horas, todos
    // los días» en vez de una tabla de horarios.
    'hours_247' => true,

    /*
    | El mapa
    |
    | La URL se construye a partir del domicilio de arriba, no de unas
    | coordenadas escritas a mano: así no hay dos sitios que puedan decir cosas
    | distintas cuando la empresa se mude.
    |
    | `provider` decide de dónde sale el marco:
    |
    |   'google' — el marco incrustado que espera reconocer un cliente en
    |              EE. UU. Es un tercero que ve la IP de quien visita la
    |              página aunque no haga clic en nada, así que si la política
    |              de privacidad enumera subencargados, ahí tiene que constar.
    |   'none'   — sin marco. Queda la tarjeta con el domicilio y el enlace
    |              «cómo llegar», que abre la aplicación de mapas del visitante
    |              sin cargarle nada de nadie.
    |
    | El enlace de «cómo llegar» se pinta con los dos.
    */
    'map' => [
        'provider' => 'google',
        'zoom' => 16,
    ],
];
