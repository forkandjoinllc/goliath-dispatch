<?php

declare(strict_types=1);

/*
| Cada pantalla traduce con las claves de uno o varios diccionarios, y el
| controlador que la pinta declara cuáles manda al cliente con usesDictionary().
| Si la pantalla usa un espacio que el controlador no declara, el texto sale EN
| CRUDO: «payments.fields.method» en mitad de un formulario.
|
| Eso no lo atrapa ningún tipo ni ninguna prueba de comportamiento, y en el
| primer render de la página tampoco se ve cuando el texto vive detrás de un
| botón — que es exactamente cómo se coló en la ficha de factura: el formulario
| de anotar un cobro usaba `payments.*` y la ficha solo mandaba `invoices`.
|
| Esta prueba lo compara de forma estática y no necesita ni base de datos ni
| navegador.
*/

/** @return array<string, list<string>> página => espacios que usa */
function namespacesUsadosPorPagina(): array
{
    $raiz = dirname(__DIR__, 3);
    $salida = [];

    foreach (glob("{$raiz}/resources/js/pages/**/*.tsx", GLOB_BRACE) ?: [] as $_) {
        // glob no recurre; se usa el iterador de abajo.
    }

    $iter = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator("{$raiz}/resources/js/pages")
    );

    foreach ($iter as $fichero) {
        if (! $fichero->isFile() || $fichero->getExtension() !== 'tsx') {
            continue;
        }

        $pagina = str_replace(["{$raiz}/resources/js/pages/", '.tsx'], '', $fichero->getPathname());
        $contenido = (string) file_get_contents($fichero->getPathname());

        preg_match_all("/t\(\s*['`]([a-zA-Z]+)\./", $contenido, $m);

        $salida[$pagina] = array_values(array_unique($m[1]));
    }

    return $salida;
}

/** @return array<string, list<string>> página => espacios que declara su controlador */
function namespacesDeclaradosPorControlador(): array
{
    $raiz = dirname(__DIR__, 3);
    $salida = [];

    $iter = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator("{$raiz}/app/Http/Controllers")
    );

    foreach ($iter as $fichero) {
        if (! $fichero->isFile() || $fichero->getExtension() !== 'php') {
            continue;
        }

        $contenido = (string) file_get_contents($fichero->getPathname());

        // Cada par usesDictionary(...) → Inertia::render('X') SIN otro
        // usesDictionary por medio: así no se atribuye a una pantalla la
        // declaración del método de al lado.
        preg_match_all(
            "/usesDictionary\(\\\$request,\s*\[(.*?)\]\s*\);(.*?)Inertia::render\('([^']+)'/s",
            $contenido,
            $m,
            PREG_SET_ORDER,
        );

        foreach ($m as $par) {
            if (str_contains($par[2], 'usesDictionary')) {
                continue;
            }

            preg_match_all("/'([^']+)'/", $par[1], $lista);
            $salida[$par[3]] = array_values(array_unique(
                array_merge($salida[$par[3]] ?? [], $lista[1])
            ));
        }
    }

    return $salida;
}

it('ninguna pantalla usa un diccionario que su controlador no manda', function () {
    // Estos van SIEMPRE en el armazón o en las respuestas de error, así que no
    // hace falta declararlos por pantalla.
    // `notifications` es global desde que la campana vive en la barra superior:
    // ver Dictionary::ALWAYS. Sin añadirlo aquí, esta prueba exigiría que las
    // treinta y tantas páginas lo declarasen una a una.
    $globales = ['nav', 'common', 'errors', 'validation', 'auth', 'notifications'];

    $usados = namespacesUsadosPorPagina();
    $declarados = namespacesDeclaradosPorControlador();

    $problemas = [];

    foreach ($usados as $pagina => $espacios) {
        // Las páginas del sitio público y App/Denied las pinta otro camino.
        if (! isset($declarados[$pagina])) {
            continue;
        }

        $faltan = array_diff($espacios, $declarados[$pagina], $globales);

        if ($faltan !== []) {
            $problemas[] = "{$pagina} usa [".implode(', ', $faltan).'] y su controlador no lo manda';
        }
    }

    expect($problemas)->toBe([]);
});

it('encuentra pantallas y controladores de verdad', function () {
    // Sin esto, un cambio de rutas o de convención dejaría la prueba de arriba
    // pasando sobre cero ficheros y nadie se enteraría.
    expect(count(namespacesUsadosPorPagina()))->toBeGreaterThan(25)
        ->and(count(namespacesDeclaradosPorControlador()))->toBeGreaterThan(15);
});
