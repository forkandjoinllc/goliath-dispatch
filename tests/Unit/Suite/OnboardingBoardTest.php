<?php

declare(strict_types=1);

use App\Enums\OnboardingStatus;
use App\Support\Onboarding\Transitions;
use Tests\Support\Source;

/**
 * El tablero no puede ofrecer un paso que la transición vaya a negar.
 *
 * ## El riesgo
 *
 * El flujo de alta son siete aristas con sus permisos, y viven en
 * `App\Support\Onboarding\Transitions`. La ficha del transportista lleva un
 * ESPEJO de ese grafo en TypeScript —lo dice su propio comentario— para no
 * pintar un botón que va a fallar. Al construir el tablero, una tercera copia
 * era lo cómodo.
 *
 * Con dos copias en el cliente, añadir una arista en PHP no cambia nada en la
 * pantalla: el tablero sigue ofreciendo las de antes, o —peor— ofrece una que ya
 * no existe. En un tablero eso se nota más que en un botón, porque arrastrar
 * INVITA: la columna se ilumina, el usuario suelta, y el servidor dice que no.
 *
 * Así que el tablero no lleva copia —recibe `moves` calculados por el
 * servidor— y el espejo de la ficha queda atado aquí al grafo de verdad.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código, como en los demás
 * guardianes de esta carpeta.
 */
function raizTablero(): string
{
    return Source::root();
}

/* ── El tablero no lleva reglas propias ──────────────────────────────────── */

it('el tablero no lleva su propia copia del flujo', function (): void {
    $pantalla = Source::compacta(raizTablero().'/resources/js/pages/App/Onboarding/Index.tsx');

    // Si alguna vez aparecen aquí los nombres de las acciones escritos a mano,
    // es que volvió la copia. Los destinos legales tienen que salir de `moves`.
    foreach (array_keys(Transitions::graph()) as $accion) {
        expect(str_contains($pantalla, "'{$accion}'"))->toBeFalse(
            "El tablero volvió a nombrar «{$accion}» a mano. Los destinos tienen que salir de `moves`, que "
            .'los calcula el servidor: una copia en la pantalla se separa del grafo y acaba invitando a un '
            .'movimiento que la transición va a negar.'
        );
    }

    expect(str_contains($pantalla, 'fila.moves'))->toBeTrue(
        'El tablero dejó de usar los movimientos que le manda el servidor.'
    );
});

it('el servidor manda los movimientos ya resueltos', function (): void {
    $codigo = Source::compacta(raizTablero().'/app/Http/Controllers/App/OnboardingController.php');

    expect(str_contains($codigo, 'Transitions::graph()'))->toBeTrue(
        'La cola dejó de leer el grafo. Si los movimientos se escriben a mano en el controlador, es la '
        .'misma copia de siempre un piso más abajo.'
    );

    expect(str_contains($codigo, "'moves'=>\$this->movimientos("))->toBeTrue(
        'Las tarjetas dejaron de traer sus movimientos.'
    );
});

/* ── El espejo de la ficha sigue siendo un espejo ────────────────────────── */

it('el mapa de la ficha del transportista coincide con el grafo del servidor', function (): void {
    $pantalla = (string) file_get_contents(raizTablero().'/resources/js/pages/App/Carriers/Show.tsx');

    preg_match('/const TRANSITIONS[^=]*= \{(.*?)\n\}/s', $pantalla, $bloque);

    expect($bloque)->not->toBeEmpty('No se encontró el mapa TRANSITIONS en la ficha del transportista.');

    // estado => acciones que la pantalla ofrece desde él
    preg_match_all('/^\s{2}(\w+): \[(.*?)\],?$/ms', $bloque[1], $filas, PREG_SET_ORDER);

    $delCliente = [];

    foreach ($filas as $fila) {
        preg_match_all("/action: '(\w+)'/", $fila[2], $acciones);
        $delCliente[$fila[1]] = $acciones[1];
        sort($delCliente[$fila[1]]);
    }

    $delServidor = [];

    foreach (Transitions::graph() as $accion => $regla) {
        foreach ($regla['from'] as $desde) {
            $delServidor[$desde][] = $accion;
        }
    }

    foreach ($delServidor as $estado => $acciones) {
        sort($delServidor[$estado]);
    }

    ksort($delCliente);
    ksort($delServidor);

    expect($delCliente)->toBe($delServidor,
        'El espejo de la ficha del transportista se separó del grafo. La pantalla ofrece un paso que el '
        .'servidor no admite, o esconde uno que sí. Los dos fallos son del mismo tipo: la pantalla dejó de '
        .'decir la verdad sobre lo que se puede hacer.'
    );
});

/* ── Ninguna tarjeta se queda sin columna ────────────────────────────────── */

it('hay una columna por cada estado del alta', function (): void {
    $codigo = Source::sinComentarios(raizTablero().'/app/Http/Controllers/App/OnboardingController.php');

    preg_match('/private const COLUMNAS = \[(.*?)\];/s', $codigo, $bloque);

    expect($bloque)->not->toBeEmpty('No se encontró la lista de columnas.');

    preg_match_all("/'([a-z_]+)'/", $bloque[1], $columnas);

    $delEnum = array_map(static fn (OnboardingStatus $s): string => $s->value, OnboardingStatus::cases());

    $faltan = array_diff($delEnum, $columnas[1]);
    $sobran = array_diff($columnas[1], $delEnum);

    // Un estado sin columna no sale mal: sale INVISIBLE. Las tarjetas que
    // estuvieran en él desaparecen del tablero sin que nada avise, y quien lo
    // mire creerá que no hay ninguna.
    expect($faltan)->toBe([],
        'Estados del alta sin columna en el tablero: '.implode(', ', $faltan).'. Sus tarjetas desaparecen '
        .'de la pantalla sin que nada lo diga.'
    );

    expect($sobran)->toBe([],
        'Columnas que no son estados del alta: '.implode(', ', $sobran).'. Siempre estarán vacías.'
    );
});

it('cada columna tiene rótulo en los dos idiomas', function (): void {
    foreach (['en', 'es'] as $idioma) {
        $diccionario = json_decode(
            (string) file_get_contents(raizTablero()."/lang/{$idioma}/onboarding.json"), true
        );

        foreach (OnboardingStatus::cases() as $estado) {
            expect($diccionario['status'][$estado->value] ?? null)->not->toBeNull(
                "Falta el rótulo «{$estado->value}» en {$idioma}/onboarding.json. La cabecera de la columna "
                .'pintaría la clave cruda.'
            );
        }
    }
});

it('cada acción del grafo tiene rótulo en los dos idiomas', function (): void {
    // El botón «Mover» y el título del diálogo del motivo salen de aquí. Una
    // acción sin rótulo pinta la clave en el sitio donde se decide si un
    // transportista se queda sin cargas.
    foreach (['en', 'es'] as $idioma) {
        $diccionario = json_decode(
            (string) file_get_contents(raizTablero()."/lang/{$idioma}/carriers.json"), true
        );

        foreach (array_keys(Transitions::graph()) as $accion) {
            expect($diccionario['onboarding']['actions'][$accion] ?? null)->not->toBeNull(
                "Falta el rótulo de «{$accion}» en {$idioma}/carriers.json."
            );
        }
    }
});

/* ── Lo que perjudica al transportista sigue pidiendo motivo ─────────────── */

it('los tres pasos que perjudican al transportista piden motivo escrito', function (): void {
    $conMotivo = [];

    foreach (Transitions::graph() as $accion => $regla) {
        if ($regla['reason'] === true) {
            $conMotivo[] = $accion;
        }
    }

    sort($conMotivo);

    // Si alguno deja de pedirlo, el tablero lo ejecutaría de una sola arrastrada
    // y sin decir por qué: alguien se quedaría sin cargas sin explicación.
    expect($conMotivo)->toBe(['corrections_required', 'rejected', 'suspended']);

    $pantalla = Source::compacta(raizTablero().'/resources/js/pages/App/Onboarding/Index.tsx');

    expect(str_contains($pantalla, 'movimiento.reason'))->toBeTrue(
        'El tablero dejó de mirar si el paso exige motivo. Arrastrar ejecutaría directamente un rechazo o '
        .'una suspensión sin que nadie escriba por qué.'
    );
});
