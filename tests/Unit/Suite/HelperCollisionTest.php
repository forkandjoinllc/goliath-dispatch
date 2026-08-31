<?php

declare(strict_types=1);

/**
 * Ningún fichero de prueba puede declarar una función que ya declare otro.
 *
 * Pest carga TODOS los ficheros de prueba en un único espacio de nombres
 * global. Dos ayudantes de primer nivel con el mismo nombre no son un fallo de
 * una prueba: son un `Cannot redeclare function` que impide ejecutar la suite
 * ENTERA, y el mensaje señala los dos ficheros sin decir cuál es el nuevo.
 *
 * Ha pasado tres veces en este proyecto. La última, en el mismo fichero donde
 * había un comentario advirtiendo de ello: escribí `documentoQueCaduca()` sin
 * saber que `SweepTest.php` ya la tenía. Un ayudante con un nombre natural
 * —«un documento que caduca»— es exactamente el que dos personas escriben
 * igual.
 *
 * Esta prueba lo convierte en un fallo normal, con el nombre y los dos ficheros
 * en el mensaje, en vez de en una suite que no arranca.
 */
it('no hay dos ficheros de prueba que declaren la misma función', function () {
    $raiz = dirname(__DIR__, 2);

    /** @var array<string, list<string>> $porNombre */
    $porNombre = [];

    $iterador = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raiz));

    foreach ($iterador as $fichero) {
        if (! $fichero->isFile() || $fichero->getExtension() !== 'php') {
            continue;
        }

        $contenido = (string) file_get_contents($fichero->getPathname());

        // Solo las de primer nivel: las declaradas dentro de una clase o de
        // otra función no comparten el espacio global. Se reconocen porque
        // empiezan en la primera columna.
        preg_match_all('/^function\s+([a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*)\s*\(/m', $contenido, $coincidencias);

        foreach ($coincidencias[1] as $nombre) {
            $porNombre[$nombre][] = str_replace($raiz.'/', '', $fichero->getPathname());
        }
    }

    $chocan = [];

    foreach ($porNombre as $nombre => $ficheros) {
        $unicos = array_values(array_unique($ficheros));

        if (count($unicos) > 1) {
            $chocan[$nombre] = $unicos;
        }
    }

    expect($chocan)->toBe([]);
});
