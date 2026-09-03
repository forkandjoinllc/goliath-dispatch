<?php

declare(strict_types=1);

/**
 * Los diccionarios PORTADOS son documentación, no relleno.
 *
 * El puerto trajo un diccionario por dominio en singular —`document.json`,
 * `load.json`, `notification.json`, `tracking.json`, `oversize.json`,
 * `signature.json`…— con el vocabulario completo de la aplicación original en
 * los dos idiomas. Ningún controlador los declara: a medida que se construye
 * cada dominio se escribe uno nuevo en plural (`documents.json`, `loads.json`)
 * con lo que esa pantalla necesita.
 *
 * Esa convención está bien y no se cambia. Lo que sí cuesta caro es que nadie
 * mire el portado antes de escribir el nuevo: al construir los avisos escribí
 * `notifications.json` desde cero mientras `notification.json` ya traía el
 * catálogo entero de sucesos en los dos idiomas —incluido `document.expired`
 * como suceso APARTE de `document.expiring`, que es exactamente el matiz que se
 * me escapó y que dejó un aviso diciendo «renuévelo antes de que venza» sobre un
 * documento ya caducado.
 *
 * Los portados son, en la práctica, media especificación de los dominios que
 * faltan: `tracking` trae 191 claves, `oversize` 172 y `signature` 161. Quien
 * construya esos dominios debería leerlas primero.
 *
 * Esta prueba no impide duplicar —a veces es lo correcto— sino que lo hace
 * VISIBLE: si aparece un plural nuevo cuyo singular portado existe y no está
 * declarado en la lista de abajo, falla y obliga a mirar el portado y a dejar
 * dicho qué se tomó de él.
 */

/**
 * Pares ya revisados: plural construido aquí => qué se hizo con su portado.
 *
 * @var array<string, string>
 */
const PORTADOS_REVISADOS = [
    'documents' => 'Se escribió antes de esta prueba. Pendiente de repasar contra document.json.',
    'carriers' => 'Se escribió antes de esta prueba. Sin solape.',
    'loads' => 'Se escribió antes de esta prueba. Pendiente de repasar contra load.json.',
    'drivers' => 'Repasado: de driver.json se adoptaron las TRES tablas de la licencia —clase, endosos y restricciones— con su nombre en los dos idiomas. La pantalla enseñaba letras sueltas («H, N, T») y las restricciones no salían en ningún sitio con la columna llena. Lo demás de ese portado —portal del conductor, relación con varios transportistas, revisión de licencia— describe dominios sin construir.',
    'customers' => 'Se escribió antes de esta prueba. Pendiente de repasar contra customer.json.',
    'assignments' => 'Se escribió antes de esta prueba. Pendiente de repasar contra assignment.json.',
    'reports' => 'Se escribió antes de esta prueba. Sin solape.',
    'notifications' => 'Repasado: de notification.json se adoptó document.expired como suceso aparte. El resto de su catálogo cubre dominios sin construir.',
];

it('un diccionario nuevo con portado detrás está revisado', function () {
    $raiz = dirname(__DIR__, 3);
    $sinRevisar = [];

    foreach (glob($raiz.'/lang/es/*.json') ?: [] as $ruta) {
        $plural = basename($ruta, '.json');

        // La convención es plural construido / singular portado. Solo interesan
        // los plurales terminados en «s» cuyo singular existe.
        if (! str_ends_with($plural, 's')) {
            continue;
        }

        $singular = substr($plural, 0, -1);

        if (! is_file($raiz."/lang/es/{$singular}.json")) {
            continue;
        }

        if (! array_key_exists($plural, PORTADOS_REVISADOS)) {
            $sinRevisar[] = "{$plural}.json (portado: {$singular}.json)";
        }
    }

    sort($sinRevisar);

    expect($sinRevisar)->toBe([], implode("\n", [
        'Diccionarios nuevos cuyo portado no se ha mirado:',
        ...$sinRevisar,
        '',
        'Lea el portado —suele traer estados y matices que no se le ocurren a uno—',
        'y luego añada el par a PORTADOS_REVISADOS diciendo qué tomó de él.',
    ]));
});

it('los portados sin pareja en singular/plural también se repasan', function () {
    // EL AGUJERO DE ESTA PRUEBA. Solo empareja `X` con `Xs`, así que un portado
    // cuyo dominio se construyó con OTRO nombre nunca se compara con nada.
    //
    // `finance.json` es el mayor de los nueve —383 claves— y su dominio se
    // construyó repartido en `invoices`, `payments`, `settlements`,
    // `commissions`, `expenses` y `factoring`. Ni una de esas seis termina en
    // «finance»+s, así que el portado más grande del repositorio llevaba desde
    // el puerto sin que nadie lo mirase, y esta prueba decía que todo estaba
    // repasado.
    //
    // @var array<string, string>
    $sinPareja = [
        'finance' => 'PENDIENTE de repasar contra invoices, payments, settlements, commissions, expenses y factoring.',
        'report' => 'Repasado: describe un selector con cinco informes con nombre que no existen. reports.json es otro producto —el informe por periodo— y no toma nada de él.',
        'carrier' => 'Repasado en su día: sin solape.',
    ];

    $raiz = dirname(__DIR__, 3);
    $huerfanos = [];

    foreach (glob($raiz.'/lang/es/*.json') ?: [] as $ruta) {
        $portado = basename($ruta, '.json');

        // Un portado es el que NINGUNA pantalla puede cargar. La lista de
        // espacios que se cargan vive en los controladores; aquí basta con la
        // convención: si existe su plural, ya lo cubre la prueba de arriba.
        if (is_file($raiz."/lang/es/{$portado}s.json")) {
            continue;
        }

        if (! in_array($portado, ['assignment', 'carrier', 'customer', 'document', 'driver', 'finance', 'load', 'notification', 'report'], true)) {
            continue;
        }

        if (! array_key_exists($portado, $sinPareja)) {
            $huerfanos[] = $portado;
        }
    }

    sort($huerfanos);

    expect($huerfanos)->toBe([], implode("\n", [
        'Portados sin pareja plural que nadie ha repasado:',
        ...$huerfanos,
        '',
        'No tienen un `Xs.json` que dispare la prueba de arriba, así que hay que',
        'nombrarlos aquí a mano diciendo contra qué se compararon.',
    ]));
});

it('la lista de revisados no menciona diccionarios que ya no existen', function () {
    $raiz = dirname(__DIR__, 3);

    $fantasmas = array_values(array_filter(
        array_keys(PORTADOS_REVISADOS),
        static fn (string $p): bool => ! is_file($raiz."/lang/es/{$p}.json"),
    ));

    expect($fantasmas)->toBe([], 'Revisados que ya no existen: '.implode(', ', $fantasmas));
});

it('los diccionarios portados siguen completos en los dos idiomas', function () {
    // Son la referencia de los dominios que faltan. Si uno se queda a medias en
    // un idioma, el día que se construya ese dominio se descubre tarde.
    $raiz = dirname(__DIR__, 3);
    $rotos = [];

    foreach (['tracking', 'oversize', 'signature', 'notification', 'finance'] as $portado) {
        $en = $raiz."/lang/en/{$portado}.json";
        $es = $raiz."/lang/es/{$portado}.json";

        if (! is_file($en) || ! is_file($es)) {
            $rotos[] = "{$portado}: falta un idioma";

            continue;
        }

        $ke = aplanarClaves(json_decode((string) file_get_contents($en), true, flags: JSON_THROW_ON_ERROR));
        $ks = aplanarClaves(json_decode((string) file_get_contents($es), true, flags: JSON_THROW_ON_ERROR));

        $diferencia = array_merge(
            array_diff(array_keys($ke), array_keys($ks)),
            array_diff(array_keys($ks), array_keys($ke)),
        );

        if ($diferencia !== []) {
            $rotos[] = "{$portado}: ".implode(', ', array_slice($diferencia, 0, 5));
        }
    }

    expect($rotos)->toBe([]);
});
