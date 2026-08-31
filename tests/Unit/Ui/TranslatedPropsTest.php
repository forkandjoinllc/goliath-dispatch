<?php

declare(strict_types=1);

/**
 * Un texto que el servidor ya tradujo no se vuelve a traducir en la pantalla.
 *
 * El caso: `LoadController` manda los motivos de bloqueo YA REDACTADOS —a
 * propósito, porque los documentos que faltan llevan el tipo pegado a la clave
 * (`missingDocument:certificate_of_insurance`) y partirla en dos sitios acaba
 * discrepando— y la ficha de carga los traducía otra vez. El resultado, en la
 * pantalla más usada de la aplicación:
 *
 *     loads.blocking.No se ha elegido transportista.
 *
 * ## Por qué esto es una prueba estática y no una del navegador simulado
 *
 * PORQUE NINGUNA PRUEBA DE PHP PUEDE VERLO. Inertia renderiza en el cliente: la
 * respuesta del servidor lleva los props en un `data-page` y un div vacío. Una
 * prueba que mire el HTML encuentra el texto correcto —está en los props— y
 * nunca ve la concatenación, que ocurre en el navegador. Lo comprobé
 * reintroduciendo el fallo: la prueba de HTML pasaba igual.
 *
 * Eso explica de una vez por qué cada lote desde el 44 ha tenido un defecto que
 * solo aparecía abriendo el navegador. No es descuido: es que la mitad de esta
 * aplicación corre donde las pruebas de PHP no llegan.
 *
 * Lo que SÍ se puede comprobar sin navegador es la forma del código. De ahí la
 * convención que esta prueba impone:
 *
 *   **una prop cuyo nombre acaba en `Message`/`Messages` lleva TEXTO, y no se
 *   pasa por `t()`.**
 *
 * El nombre carga el contrato, y el contrato se comprueba.
 */
it('ninguna prop de mensajes se pasa por el traductor', function () {
    $raiz = dirname(__DIR__, 3);
    $infractores = [];

    $iterador = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($raiz.'/resources/js')
    );

    foreach ($iterador as $fichero) {
        if (! in_array($fichero->getExtension(), ['tsx', 'ts'], true)) {
            continue;
        }

        $codigo = (string) file_get_contents($fichero->getPathname());

        // `t(\`algo.${loQueSea}\`)` donde la variable acaba en Message/Messages.
        preg_match_all('/\bt\(\s*`[^`]*\$\{([^}]*\bMessages?)\}/', $codigo, $m);

        foreach ($m[1] as $expresion) {
            $infractores[] = str_replace($raiz.'/', '', $fichero->getPathname()).': '.trim($expresion);
        }
    }

    expect($infractores)->toBe([], implode("\n", [
        'Props de texto pasadas por el traductor:',
        ...$infractores,
        '',
        'Una prop cuyo nombre acaba en Message/Messages ya viene redactada por el',
        'servidor. Traducirla otra vez pinta la clave pegada al texto.',
    ]));
});

it('la ficha de carga recibe los motivos como mensajes, no como claves', function () {
    // El nombre es el contrato. Si alguien renombra la prop a `blocking` —como
    // se llamaba— vuelve a parecerse a las de otras pantallas, que sí traen
    // claves, y el siguiente que la lea la volverá a traducir.
    $raiz = dirname(__DIR__, 3);

    $controlador = (string) file_get_contents($raiz.'/app/Http/Controllers/App/LoadController.php');
    $pantalla = (string) file_get_contents($raiz.'/resources/js/pages/App/Loads/Show.tsx');

    expect($controlador)->toContain("'blockingMessages' => array_map");
    expect($pantalla)->toContain('blockingMessages: string[]');

    // Y no queda ningún `t('loads.blocking.…')` en esa pantalla.
    expect($pantalla)->not->toContain('loads.blocking.${');
});
