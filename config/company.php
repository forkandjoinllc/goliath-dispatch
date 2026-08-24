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

    // Sin teléfono ni correo todavía. Se dejan fuera a propósito en vez de
    // poner un marcador: una dirección de correo inventada en una página de
    // contacto es peor que no tener ninguna.
    'phone' => null,
    'email' => null,
];
