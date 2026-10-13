<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * El foco de una ventana modal, y la forma que se lo robaba.
 *
 * ## El defecto
 *
 * Escribir una letra en cualquier campo de una ventana hacía saltar el foco al
 * primer campo. Una letra, un salto: el alta rápida de una carga era
 * imposible de rellenar.
 *
 * El efecto que mete el foco dependía de `[open, onClose]`, y `onClose` llega
 * escrita dentro de quien pinta la ventana, así que es OTRA función en cada
 * render. Cada tecla cambia el estado del formulario, cada cambio vuelve a
 * pintar, cada pintada crea un `onClose` nuevo, y React desmonta el efecto y
 * lo vuelve a montar. Lo primero que hace al montarse es poner el foco en el
 * primer campo.
 *
 * **El efecto hacía lo que su comentario decía.** Lo que no era cierto era «al
 * abrirse»: se abría treinta veces mientras alguien escribía una ciudad.
 *
 * ## Por qué esto se vigila con un guardián de forma
 *
 * Porque la suite de este producto es de servidor: no hay nada que monte un
 * componente de React y escriba en él. Lo que sí se puede sujetar es la forma
 * que causa el defecto, que es siempre la misma — una identidad que cambia en
 * cada render dentro de un array de dependencias — y se puede sujetar en TODA
 * la aplicación y no solo en el fichero donde dolió.
 *
 * El paseo por el navegador comprueba el efecto; esto impide que vuelva.
 */
function fuenteDeLaVentana(string $ruta): string
{
    return Source::codigo(Source::root().'/'.$ruta);
}

it('el efecto que mueve el foco depende solo de que la ventana esté abierta', function (): void {
    $ventana = fuenteDeLaVentana('resources/js/components/App/Modal.tsx');

    test()->assertStringContainsString('}, [open])', $ventana);
    test()->assertStringNotContainsString('}, [open, onClose])', $ventana);
});

it('la ventana aguanta que le pasen una función nueva en cada render', function (): void {
    /*
    | La alternativa era pedirle a cada pantalla que memorizara su `onClose`.
    | Eso es un contrato que no se ve: funciona hasta que alguien escribe la
    | cuarta ventana sin enterarse, y el defecto vuelve en otra pantalla.
    |
    | Así que `onClose` se lee por referencia DENTRO del efecto, y el efecto no
    | depende de él.
    */
    $ventana = fuenteDeLaVentana('resources/js/components/App/Modal.tsx');

    test()->assertStringContainsString('const cerrar = useRef(onClose)', $ventana);
    test()->assertStringContainsString('cerrar.current()', $ventana);
});

it('la referencia se pone al día en un efecto y no durante el render', function (): void {
    // Escribir en una referencia mientras se pinta es escribir fuera de
    // tiempo: en modo concurrente React puede pintar sin llegar a usar ese
    // resultado, y la referencia se queda con una función de un render que no
    // existió.
    $ventana = fuenteDeLaVentana('resources/js/components/App/Modal.tsx');

    test()->assertStringContainsString(
        "useEffect(() => {\n    cerrar.current = onClose\n  }, [onClose])",
        $ventana,
    );
});

it('ninguna pantalla mete una función de sus props en las dependencias de un efecto', function (): void {
    /*
    | La forma que causó el defecto, buscada en toda la aplicación.
    |
    | Una prop que se llama `onAlgo` es, por convención, una función que escribe
    | quien pinta el componente — y casi nunca memorizada. Metida en un array
    | de dependencias, el efecto se desmonta y se vuelve a montar en cada
    | render del padre. Si ese efecto mueve el foco, roba el foco; si abre una
    | conexión, la reabre; si arranca un reloj, lo reinicia.
    |
    | Esto no prohíbe reaccionar a un cambio de `onClose`: para eso está el
    | efecto de una línea que pone la referencia al día, que no tiene limpieza
    | y no le hace daño a nadie. Lo que se prohíbe es que un efecto CON
    | limpieza dependa de una de esas funciones.
    */
    $raiz = Source::root().'/resources/js';
    $culpables = [];

    $iterador = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raiz));

    foreach ($iterador as $fichero) {
        if (! $fichero->isFile() || ! in_array($fichero->getExtension(), ['ts', 'tsx'], true)) {
            continue;
        }

        $codigo = Source::codigo((string) $fichero->getPathname());

        // Cada efecto entero: desde `useEffect(` hasta su array de
        // dependencias. Mirar solo la línea del array no diría si ese efecto
        // tiene limpieza, que es lo que convierte la forma en defecto.
        preg_match_all('/useEffect\(\(\) => \{(.*?)\n  \}, \[([^\]]*)\]\)/s', $codigo, $efectos, PREG_SET_ORDER);

        foreach ($efectos as $efecto) {
            $cuerpo = $efecto[1];
            $deps = $efecto[2];

            if (preg_match('/\breturn \(\) =>/', $cuerpo) !== 1) {
                continue;
            }

            if (preg_match('/\bon[A-Z][A-Za-z]*\b/', $deps) === 1) {
                $culpables[] = substr((string) $fichero->getPathname(), strlen(Source::root()) + 1)
                    .' => ['.trim($deps).']';
            }
        }
    }

    sort($culpables);

    expect($culpables)->toBe(
        [],
        "Un efecto con limpieza depende de una función de las props:\n  ".
        implode("\n  ", $culpables).
        "\nEsa función es nueva en cada render del padre, así que el efecto se desmonta y se ".
        'vuelve a montar con cada tecla. Léela desde una referencia — ver `components/App/Modal.tsx`.',
    );
});

it('las tres ventanas de la aplicación usan la misma pieza', function (): void {
    // Una cuarta ventana escrita a mano haría dos de las cuatro cosas que
    // hace esta —y la que se dejaría es la trampa del foco, que es la que no
    // se ve hasta que alguien navega con el teclado.
    foreach ([
        'resources/js/components/App/Board/QuickAdd.tsx',
        'resources/js/components/App/Board/LoadPanel.tsx',
        'resources/js/pages/App/Vendors/Show.tsx',
    ] as $ruta) {
        test()->assertStringContainsString(
            "from '@/components/App/Modal'",
            fuenteDeLaVentana($ruta),
            "{$ruta} no usa la ventana común.",
        );
    }
});

it('ningún menú escribe su propio cierre', function (): void {
    /*
    | `useMenu` hace tres cosas: cierra al pulsar fuera, cierra con Escape y
    | DEVUELVE EL FOCO al botón que lo abrió. La tercera es la que se olvida
    | siempre, porque solo se nota navegando con el teclado — y el menú de los
    | tres puntos del panel de la carga llevaba sin ella desde que nació.
    |
    | Su propio comentario lo había predicho: «un cuarto menú escrito a mano
    | acabaría haciendo dos de las tres». Lo era.
    |
    | La ventana modal queda fuera a propósito: no es un menú, es un diálogo
    | con trampa de foco, y su cierre con Escape tiene que parar la propagación
    | para no cerrar además lo que haya debajo.
    */
    $permitidos = [
        'resources/js/lib/useMenu.ts',
        'resources/js/components/App/Modal.tsx',
    ];

    $raiz = Source::root().'/resources/js';
    $culpables = [];

    $iterador = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raiz));

    foreach ($iterador as $fichero) {
        if (! $fichero->isFile() || ! in_array($fichero->getExtension(), ['ts', 'tsx'], true)) {
            continue;
        }

        $relativa = substr((string) $fichero->getPathname(), strlen(Source::root()) + 1);

        if (in_array($relativa, $permitidos, true)) {
            continue;
        }

        $codigo = Source::codigo((string) $fichero->getPathname());

        if (preg_match("/addEventListener\('(mousedown|keydown)'/", $codigo) === 1) {
            $culpables[] = $relativa;
        }
    }

    sort($culpables);

    expect($culpables)->toBe(
        [],
        "Estos ficheros escuchan el ratón o el teclado por su cuenta:\n  ".
        implode("\n  ", $culpables).
        "\nSi es un menú, usa `lib/useMenu`: lo que se deja el que se escribe a mano es ".
        'devolver el foco al botón, y eso solo se nota con el teclado.',
    );
});
