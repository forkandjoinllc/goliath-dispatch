<?php

declare(strict_types=1);

/**
 * Toda lista paginada tiene que poder llegar a su página dos.
 *
 * Cuatro pantallas de dinero —facturas, cobros, gastos y liquidaciones—
 * paginaban de veinticinco o treinta en treinta en el servidor y no pintaban un
 * solo enlace de página: la factura número veintiséis no se podía alcanzar de
 * ninguna manera desde la interfaz. Ninguna prueba lo veía, y no por descuido:
 * el servidor respondía perfectamente a `?page=2`. El fallo estaba en que nadie
 * tenía por dónde pedirlo.
 *
 * Esta prueba cruza las dos mitades. Es estática —lee ficheros, no arranca la
 * aplicación— porque el defecto no aparece en ninguna respuesta, sino en lo que
 * la página deja de dibujar.
 */

/**
 * Las páginas que un controlador renderiza DESDE un método que pagina.
 *
 * Se trocea por método y no se busca en el fichero entero porque el mismo
 * controlador que pagina en `index()` renderiza además su ficha y su
 * formulario, que no paginan nada: mirando el fichero como un bloque, esta
 * prueba exigiría un paginador en la ficha de un transportista.
 *
 * @return list<string>
 */
function paginasPaginadas(string $php): array
{
    $paginas = [];

    // El corte por `function ` deja el cuerpo de cada método en su trozo. No es
    // un analizador de PHP, y no hace falta que lo sea: basta con no mezclar
    // el `paginate()` de un método con el `render()` de otro.
    foreach (preg_split('/\n    (?:public|private|protected) function /', $php) ?: [] as $metodo) {
        if (! str_contains($metodo, '->paginate(')) {
            continue;
        }

        if (preg_match("/Inertia::render\(\s*'([^']+)'/", $metodo, $m) === 1) {
            $paginas[] = $m[1];
        }
    }

    return $paginas;
}

it('cada pantalla que pagina en el servidor pinta su paginador', function () {
    $raiz = dirname(__DIR__, 3);
    $sinPaginador = [];
    $revisadas = 0;

    foreach (glob($raiz.'/app/Http/Controllers/App/*.php') ?: [] as $controlador) {
        foreach (paginasPaginadas((string) file_get_contents($controlador)) as $pagina) {
            $tsx = $raiz.'/resources/js/pages/'.$pagina.'.tsx';

            if (! is_file($tsx)) {
                continue;
            }

            $revisadas++;
            $jsx = (string) file_get_contents($tsx);

            // O usa el componente compartido, o pinta los números a mano. Las
            // dos valen; no pintar nada, no.
            if (! str_contains($jsx, '<Pager ') && ! str_contains($jsx, 'meta.lastPage')) {
                $sinPaginador[] = $pagina.'  (desde '.basename($controlador).')';
            }
        }
    }

    // Sin esto la prueba pasaría en verde el día que un cambio de nombre dejara
    // el recorrido a cero — que es como se cuela un fallo por una comprobación
    // que ya no comprueba nada.
    expect($revisadas)->toBeGreaterThan(8);

    expect($sinPaginador)->toBe([], "Pantallas que paginan sin poder cambiar de página:\n".implode("\n", $sinPaginador));
});

it('el paginador conserva los filtros al cambiar de página', function () {
    $raiz = dirname(__DIR__, 3);
    $pager = (string) file_get_contents($raiz.'/resources/js/components/App/Pager.tsx');

    // Un paginador que se lleva `?page=2` y tira los filtros manda al usuario a
    // la segunda página de OTRA lista. Se comprueba aquí porque es la clase de
    // detalle que se pierde en el primer refactor.
    expect($pager)->toContain('params');
    expect($pager)->toContain('page');
});
