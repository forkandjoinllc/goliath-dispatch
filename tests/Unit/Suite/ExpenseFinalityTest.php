<?php

declare(strict_types=1);

use App\Enums\ExpenseStatus;
use App\Support\Finance\ExpenseTransitions;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;

/**
 * Decidir sobre un gasto no se deshace, y la pantalla no dice lo contrario.
 *
 * ## El defecto
 *
 * Al rechazar un gasto ya aprobado, el diccionario tenía escrito:
 *
 * > Un gasto aprobado no se puede rechazar directamente. Comuníquese con un
 * > administrador para revertirlo.
 *
 * No hay reversión. `approve` y `reject` solo aceptan `submitted`, `reimburse`
 * solo `approved`, y ninguna ruta, acción ni permiso devuelve un gasto decidido
 * a «presentado». El mensaje mandaba a una persona que tampoco puede hacerlo —
 * y como un gasto aprobado entra en la base de comisión, el clic equivocado se
 * queda dentro del dinero mientras el producto asegura que alguien lo deshace.
 *
 * (Esa frase, además, no la leía NADIE: vivía en `finance.json` y el
 * controlador lanzaba otra, `expenses.errors.badTransition`, que decía
 * «recargue la página» — sugiriendo una vista vieja cuando lo que pasa es que
 * la decisión es permanente. Dos textos falsos, uno muerto y otro vivo.)
 *
 * ## Lo que vigila este fichero
 *
 * Que la tabla de transiciones viva en UN sitio, que el mensaje de error SALGA
 * de ella en vez de escribirse aparte —que es como se llegó a prometer una
 * puerta que no existe—, que ninguna copia vuelva a prometer una reversión, y
 * que el aviso esté ANTES del clic, que es cuando sirve.
 *
 * Lo que de verdad mide que ningún rol puede revertir es
 * `tests/Feature/Expenses/FinalityTest.php`. Esto sujeta la estructura.
 */
function raizFinalidad(): string
{
    return Source::root();
}

/** @return array<string, mixed> */
function diccionarioFinalidad(string $idioma, string $fichero): array
{
    $ruta = raizFinalidad()."/lang/{$idioma}/{$fichero}.json";

    return (array) json_decode((string) file_get_contents($ruta), true, 512, JSON_THROW_ON_ERROR);
}

it('la tabla se lee en las dos direcciones sin confundirlas', function (): void {
    // Escribí esta clase confundiendo «no tiene salida» con «no tiene vuelta»,
    // dos veces en cinco minutos: primero declarando final a `approved`, que
    // tiene el botón de reembolsar al lado, y luego contestando que a
    // `submitted` sí se vuelve, que es la frase exacta que el lote desmiente.
    expect(ExpenseTransitions::sinRetorno('submitted'))->toBeTrue();
    expect(ExpenseTransitions::esFinal('submitted'))->toBeFalse();

    expect(ExpenseTransitions::sinRetorno('approved'))->toBeFalse();
    expect(ExpenseTransitions::esFinal('approved'))->toBeFalse();
    expect(ExpenseTransitions::salidasDe('approved'))->toBe(['reimbursed']);

    expect(ExpenseTransitions::esFinal('rejected'))->toBeTrue();
    expect(ExpenseTransitions::esFinal('reimbursed'))->toBeTrue();

    // Y lo que la tabla permite, en positivo y en negativo.
    expect(ExpenseTransitions::permitida('submitted', 'approved'))->toBeTrue();
    expect(ExpenseTransitions::permitida('approved', 'rejected'))->toBeFalse();
    expect(ExpenseTransitions::permitida('reimbursed', 'approved'))->toBeFalse();
});

it('todo estado del enum está contemplado por la tabla', function (): void {
    // Un estado nuevo que nadie mete en la tabla no es «sin transiciones»: es
    // un estado del que la pantalla no sabe decir nada, y el aviso de
    // finalidad empieza a mentir por omisión.
    $conocidos = array_merge(
        array_keys(ExpenseTransitions::DESDE),
        ...array_values(ExpenseTransitions::DESDE),
    );

    foreach (ExpenseStatus::cases() as $caso) {
        expect($conocidos)->toContain($caso->value);
    }

    // Y al revés: la tabla no habla de estados que no existen.
    foreach (array_unique($conocidos) as $estado) {
        expect(ExpenseStatus::tryFrom($estado))->not->toBeNull();
    }
});

it('cada callejón sin salida está declarado con su motivo', function (): void {
    // El registro y la tabla tienen que decir lo mismo. Un callejón sin
    // declarar se lee como descuido, y entonces alguien escribe el mensaje
    // prometiendo la salida que cree que hay — que es lo que pasó.
    $sinRetorno = array_values(array_filter(
        array_map(static fn (ExpenseStatus $c): string => $c->value, ExpenseStatus::cases()),
        static fn (string $e): bool => ExpenseTransitions::sinRetorno($e),
    ));

    expect($sinRetorno)->toBe(array_keys(ExpenseTransitions::SIN_RETORNO));

    foreach (ExpenseTransitions::SIN_RETORNO as $motivo) {
        expect(strlen($motivo))->toBeGreaterThan(40);
    }
});

it('el controlador no tiene su propia tabla de transiciones', function (): void {
    $fuente = Source::compacta(raizFinalidad().'/app/Http/Controllers/App/ExpenseController.php');

    // La tabla vivía dentro de un `match` en un método privado, y la copia del
    // error se escribió aparte: dos sitios que hablan de lo mismo sin mirarse.
    expect($fuente)->toContain('ExpenseTransitions::permitida($actual,$nuevo)');
    expect($fuente)->not->toContain("'submitted'=>\$nuevo");
    expect($fuente)->not->toContain('match($actual)');
});

it('ninguna ruta pide una transición que la tabla no tiene', function (): void {
    $fuente = Source::sinComentarios(raizFinalidad().'/app/Http/Controllers/App/ExpenseController.php');

    preg_match_all('/\$this->decide\(.*?,\s*\x27(\w+)\x27,/s', $fuente, $m);

    $pedidos = array_unique($m[1]);

    // Tres rutas, tres destinos: approve, reject y reimburse.
    expect(count($pedidos))->toBe(3);

    foreach ($pedidos as $destino) {
        // El día que alguien añada una ruta de vuelta a `submitted`, esto se
        // pone en rojo. Es lo que sustituye a la copia que escribí para esa
        // ruta ANTES de que existiera: un texto que nadie podía leer, que es
        // exactamente la enfermedad que este lote cura.
        // Con `assertArrayHasKey` y no con `toHaveKey($destino, $mensaje)`: el
        // segundo argumento de `toHaveKey` es el VALOR esperado, no el
        // mensaje. Es la tercera vez que me pasa con la familia `toContain`.
        assertArrayHasKey(
            $destino,
            ExpenseTransitions::DESDE,
            "una ruta pide pasar a «{$destino}», que no es destino de la tabla",
        );
    }
});

it('el mensaje de por qué no sale de la tabla', function (): void {
    $fuente = Source::compacta(raizFinalidad().'/app/Http/Controllers/App/ExpenseController.php');

    // Las tres frases se eligen preguntándole a la tabla. Si alguna se
    // escribiera a mano vuelve el problema entero: un texto que opina sobre
    // transiciones sin consultarlas.
    expect($fuente)->toContain('ExpenseTransitions::salidasDe($actual)');
    expect($fuente)->toContain("__('expenses.errors.noWayOut'");
    expect($fuente)->toContain("__('expenses.errors.onlyThese'");
});

/**
 * Textos que SÍ pueden nombrar al administrador junto a deshacer, porque lo
 * NIEGAN. La diferencia entre prometer y desmentir no la sabe una expresión
 * regular, así que se declara aquí con su motivo: una lista corta y revisable
 * es más honesta que una regla negativa que se cuela sola.
 *
 * @var array<string, string>
 */
const FINALIDAD_NIEGAN = [
    'expenses.index.decisionIsFinal' => 'El aviso previo al clic: dice que decidir no se deshace.',
];

/** @return array<string, string> Cada hoja del diccionario por su ruta completa. */
function hojasFinalidad(string $idioma): array
{
    $hojas = [];

    foreach (glob(raizFinalidad()."/lang/{$idioma}/*.json") ?: [] as $ruta) {
        $raiz = basename($ruta, '.json');
        $datos = json_decode((string) file_get_contents($ruta), true, 512, JSON_THROW_ON_ERROR);

        $aplanar = static function (mixed $nodo, string $prefijo) use (&$aplanar, &$hojas): void {
            if (is_array($nodo)) {
                foreach ($nodo as $clave => $hijo) {
                    $aplanar($hijo, "{$prefijo}.{$clave}");
                }

                return;
            }

            $hojas[$prefijo] = (string) $nodo;
        };

        $aplanar($datos, $raiz);
    }

    return $hojas;
}

it('ninguna copia promete una reversión que no existe', function (): void {
    foreach (['es', 'en'] as $idioma) {
        // La frase muerta no vuelve, ni por su clave ni por su contenido.
        // Vivía en `finance.json` y NO LA LEÍA NADIE: el controlador lanzaba
        // otra. Una copia falsa y muerta engaña igual al siguiente que la lea
        // —me engañó a mí— así que se vigila aunque no se pinte.
        $hojas = hojasFinalidad($idioma);

        foreach (array_keys($hojas) as $ruta) {
            expect($ruta)->not->toContain('cannotRejectApprovedExpense');
            expect($ruta)->not->toContain('badTransition');
        }

        foreach ($hojas as $ruta => $texto) {
            if (array_key_exists($ruta, FINALIDAD_NIEGAN)) {
                continue;
            }

            // Se busca la PAREJA «administrador» + «deshacer/revertir», no cada
            // palabra suelta: mandar a un administrador es legítimo en las
            // pantallas donde ese administrador sí puede hacer algo.
            //
            // Sin excepciones dentro de la expresión: la primera versión traía
            // un «salvo que diga no puede» metido en el propio patrón, y eso es
            // una puerta que se abre sola —cualquier frase con un «no» delante
            // pasaba sin que nadie la mirara—. Las excepciones se declaran
            // arriba, con nombre y motivo, o no existen.
            $promete = preg_match(
                '/(administrador|administrator)[^.]{0,80}(revert|deshace|deshacer|undo|undone)/iu',
                $texto,
            );

            expect($promete)->toBe(0, "{$ruta} promete una reversión a través de un administrador: «{$texto}»");
        }
    }

    // Y la lista de excepciones no envejece: una clave declarada que ya no
    // existe es una excepción abierta sin nada detrás.
    $todas = hojasFinalidad('es') + hojasFinalidad('en');

    foreach (array_keys(FINALIDAD_NIEGAN) as $ruta) {
        expect($todas)->toHaveKey($ruta);
    }
});

it('las tres frases existen en los dos idiomas con los mismos huecos', function (): void {
    $claves = ['noWayOut', 'onlyThese'];

    $es = diccionarioFinalidad('es', 'expenses');
    $en = diccionarioFinalidad('en', 'expenses');

    foreach ($claves as $clave) {
        foreach ([['es', $es], ['en', $en]] as [$idioma, $diccionario]) {
            expect($diccionario['errors'][$clave] ?? null)->toBeString("falta {$clave} en {$idioma}");
        }

        // Un hueco que solo existe en un idioma sale impreso tal cual, con sus
        // llaves, delante del usuario del otro.
        preg_match_all('/\{(\w+)\}/', $es['errors'][$clave], $huecosEs);
        preg_match_all('/\{(\w+)\}/', $en['errors'][$clave], $huecosEn);

        sort($huecosEs[1]);
        sort($huecosEn[1]);

        expect($huecosEs[1])->toBe($huecosEn[1], "los huecos de {$clave} no coinciden");
    }

    expect($es['index']['decisionIsFinal'] ?? null)->toBeString();
    expect($en['index']['decisionIsFinal'] ?? null)->toBeString();
});

it('el aviso se pinta antes del botón que lo necesita', function (): void {
    $ruta = raizFinalidad().'/resources/js/pages/App/Expenses/Index.tsx';
    $vista = (string) file_get_contents($ruta);

    $aviso = strpos($vista, 'expenses.index.decisionIsFinal');
    expect($aviso)->not->toBeFalse('el aviso de finalidad no se pinta');

    // Antes del clic, que es cuando sirve. Un aviso debajo de los botones lo
    // lee quien ya decidió.
    $botones = strpos($vista, 'expenses.index.approve');
    expect($botones)->not->toBeFalse();
    expect($aviso)->toBeLessThan($botones);

    // Y solo donde hay decisión pendiente: al que ya está aprobado no se le
    // avisa de algo que ya no puede evitar.
    expect($vista)->toContain("{canApprove && e.status === 'submitted' ? (");
});
