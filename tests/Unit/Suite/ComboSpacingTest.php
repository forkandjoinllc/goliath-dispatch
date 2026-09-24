<?php

declare(strict_types=1);

use App\Support\Equipment\ComboSpacing;
use Tests\Support\Source;

/**
 * Lo que mide un camión CON un remolque.
 *
 * ## El hueco que no cabía en ninguna ficha
 *
 * `AxleSpacings` guarda los huecos de UNA unidad. En una combinación de cinco
 * ejes hay cuatro huecos y solo tres son de alguna unidad: el que sobra —de la
 * última tracción al primer eje del remolque— es de la pareja, cambia al
 * cambiar cualquiera de las dos, y es el que piden la fórmula federal del
 * puente y toda oficina de permisos.
 *
 * ## Lo que este guardián sujeta
 *
 * Que la distancia total de la combinación APARECE O NO APARECE, y nunca a
 * medias. Una suma a la que le falta un tramo no es una suma aproximada: es un
 * número que se parece a la distancia de un permiso sin serlo, y ese número
 * acaba copiado en un papel que alguien firma.
 */
function fuenteDelConjunto(string $ruta): string
{
    return Source::codigo(Source::root().'/'.$ruta);
}

/* ── La cadena entera, o ninguna ───────────────────────────────────────── */

it('sin el enganche no hay cadena', function (): void {
    // Los dos extremos medidos y el tramo del medio sin tomar. Es el estado
    // normal de una flota el día que instala esto.
    expect(ComboSpacing::cadena(3, [232, 54], null, 5, [61, 61, 61, 61]))->toBeNull();
});

it('sin los huecos de una de las dos fichas tampoco', function (): void {
    foreach ([
        'el tractor sin medir' => [3, [], 426, 5, [61, 61, 61, 61]],
        'el remolque sin medir' => [3, [232, 54], 426, 5, []],
        'el tractor a medias' => [3, [232], 426, 5, [61, 61, 61, 61]],
        'el remolque a medias' => [3, [232, 54], 426, 5, [61, 61]],
    ] as $caso => [$ejesCamion, $camion, $enganche, $ejesRemolque, $remolque]) {
        expect(ComboSpacing::cadena($ejesCamion, $camion, $enganche, $ejesRemolque, $remolque))
            ->toBeNull("Con {$caso} salió una cadena.");
    }
});

it('sin el recuento de ejes no se puede decir si están todos', function (): void {
    /*
    | Cero huecos guardados es lo CORRECTO para un remolque de un eje y es
    | «nadie lo ha medido» para uno de tres. Contar lo guardado sin el recuento
    | al lado mide algo adyacente a la pregunta: mide cuántas filas hay, no si
    | están todas.
    */
    expect(ComboSpacing::cadena(null, [232, 54], 426, 5, [61, 61, 61, 61]))->toBeNull();
    expect(ComboSpacing::cadena(3, [232, 54], 426, null, [61, 61, 61, 61]))->toBeNull();

    // Y un remolque de UN eje tiene cero huecos con todo derecho: la cadena
    // sale, y sale sin ningún tramo de remolque.
    expect(ComboSpacing::cadena(3, [232, 54], 426, 1, []))->toBe([232, 54, 426]);
});

it('con las tres piezas la cadena lleva el enganche en medio', function (): void {
    // El orden importa: la fórmula del puente se calcula sobre los huecos en
    // el orden en que están en la calle, no sobre el conjunto de sus valores.
    expect(ComboSpacing::cadena(3, [232, 54], 426, 5, [61, 61, 61, 61]))
        ->toBe([232, 54, 426, 61, 61, 61, 61]);
});

it('el total no existe mientras no exista la cadena', function (): void {
    expect(ComboSpacing::total(null))->toBeNull();
    expect(ComboSpacing::total([]))->toBeNull();
    expect(ComboSpacing::total([232, 54, 426, 61, 61, 61, 61]))->toBe(956);
});

it('los ejes de la combinación son los de las dos, y solo si se saben las dos', function (): void {
    expect(ComboSpacing::ejes(3, 4))->toBe(7);
    expect(ComboSpacing::ejes(null, 4))->toBeNull();
    expect(ComboSpacing::ejes(3, null))->toBeNull();
});

/* ── Quién escribe, y cómo se buscan las parejas ────────────────────────── */

it('nadie más escribe en la tabla de conjuntos', function (): void {
    /*
    | La unicidad de la pareja vive en una columna GENERADA que solo cuenta las
    | filas vivas. Un `insert` suelto en otro controlador la duplicaría en
    | cuanto alguien retirara una medida y la volviera a tomar.
    |
    | Se mira la consulta y no el fichero: el controlador LEE la tabla para
    | saber qué parejas enseñar, y contar por fichero lo señalaría a él y no al
    | defecto. Mismo método que `StandingAssignmentTest`.
    */
    $raiz = Source::root().'/app';
    $escriben = [];

    $iterador = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raiz));

    foreach ($iterador as $fichero) {
        if (! $fichero->isFile() || $fichero->getExtension() !== 'php') {
            continue;
        }

        $codigo = Source::compacta((string) $fichero->getPathname());
        $trozos = explode("DB::table('equipment_combo_spacings')", $codigo);
        array_shift($trozos);

        foreach ($trozos as $trozo) {
            $consulta = explode(';', $trozo, 2)[0] ?? '';

            if (preg_match('/->(insert|update|delete)\(/', $consulta) === 1) {
                $escriben[] = substr((string) $fichero->getPathname(), strlen(Source::root()) + 1);

                break;
            }
        }
    }

    sort($escriben);
    $escriben = array_values(array_unique($escriben));

    expect($escriben)->toBe(['app/Support/Equipment/ComboSpacing.php']);
});

it('una medida retirada se conserva', function (): void {
    // Por qué un permiso se pidió con una cifra y no con otra es parte de lo
    // que hay que poder explicar después. Retirar es marcar, no quitar.
    $soporte = fuenteDelConjunto('app/Support/Equipment/ComboSpacing.php');

    test()->assertStringContainsString("'deleted_at' => now()", $soporte);
    test()->assertStringNotContainsString('->delete()', $soporte);
});

it('las parejas se buscan por pares y no por dos listas', function (): void {
    /*
    | Con los camiones por un lado y los remolques por otro —dos `whereIn`
    | sueltos— salen también las parejas que nadie ha formado: el camión de una
    | con el remolque de otra. La pantalla enseñaría la medida de un conjunto
    | que no existe, y encima cuadraría.
    */
    $soporte = fuenteDelConjunto('app/Support/Equipment/ComboSpacing.php');

    test()->assertStringContainsString("\$q->where('truck_id', \$camion)->where('trailer_id', \$remolque);", $soporte);
    test()->assertStringNotContainsString("whereIn('trailer_id'", $soporte);
});

/* ── Lo que la pantalla promete ─────────────────────────────────────────── */

it('la ficha de una unidad no llama a su suma la del permiso', function (): void {
    /*
    | Decía «del primer eje al último» a secas. De la unidad es cierto; de un
    | tractor son del eje de dirección a la última tracción, y quien lee eso en
    | la ficha del camión mientras rellena un permiso copia una cifra a la que
    | le faltan treinta y cinco pies.
    */
    foreach (['en', 'es'] as $idioma) {
        $d = json_decode((string) file_get_contents(Source::root()."/lang/{$idioma}/equipment.json"), true);

        test()->assertStringContainsString(
            $idioma === 'en' ? 'this unit alone' : 'esta unidad sola',
            (string) $d['detail']['axleSpacingsTotal'],
            "En {$idioma} la suma de la ficha no dice que es de la unidad sola.",
        );
    }
});

it('la pantalla de conjuntos dice cuándo no puede dar el total', function (): void {
    // Y no enseña una suma a medias. La fila lo dice con todas sus letras.
    $pantalla = fuenteDelConjunto('resources/js/pages/App/Equipment/Combos.tsx');

    test()->assertStringContainsString('c.overallInches === null', $pantalla);
    test()->assertStringContainsString('equipment.combos.chainIncomplete', $pantalla);
});

it('la lista de conjuntos declara su alcance', function (): void {
    /*
    | Quien tiene el alcance acotado tiene que leer que la lista está ACOTADA,
    | y no que su empresa no tenga ningún conjunto. Es la lección que hizo
    | nacer `EmptyState`, y esta pantalla no usa ese componente porque un
    | conjunto no se da de alta en una lista.
    */
    $controlador = fuenteDelConjunto('app/Http/Controllers/App/ComboSpacingController.php');
    $pantalla = fuenteDelConjunto('resources/js/pages/App/Equipment/Combos.tsx');

    test()->assertStringContainsString("'scope' => \$scope->value", $controlador);
    test()->assertStringContainsString('common.states.scoped.', $pantalla);
});

it('el hueco del conjunto es la razón de ser de la fila', function (): void {
    // Guardar las tres medidas del margen sin el enganche dejaría tres datos
    // de permiso colgando de nada.
    $controlador = fuenteDelConjunto('app/Http/Controllers/App/ComboSpacingController.php');

    test()->assertStringContainsString('if ($enganche === null || $enganche < 1)', $controlador);
    test()->assertStringContainsString('equipment.combos.hitchRequired', $controlador);
});

it('las dos unidades se comprueban en el servidor', function (): void {
    // Que el desplegable solo ofrezca las suyas no basta: una petición a mano
    // llevaría cualquier identificador.
    $controlador = fuenteDelConjunto('app/Http/Controllers/App/ComboSpacingController.php');

    test()->assertStringContainsString('in_array((string) $datos[\'truck_id\'], $camiones, true)', $controlador);
    test()->assertStringContainsString('$this->exigeRemolqueDeLaEmpresa(', $controlador);
});

it('el conjunto tiene que caber dentro de sí mismo', function (): void {
    /*
    | Cada medida por separado es plausible; el par no lo es. El parachoques
    | delantero y el trasero no pueden estar más cerca que el primer eje y el
    | último, porque los dos voladizos van por fuera de los ejes.
    |
    | Lo destapó el sembrado de demostración: cifras de una hoja real pegadas a
    | otro conjunto, y la pantalla enseñó un camión más corto que su propia
    | distancia entre ejes sin quejarse.
    */
    $controlador = fuenteDelConjunto('app/Http/Controllers/App/ComboSpacingController.php');

    test()->assertStringContainsString('$parachoques < $total', $controlador);
    test()->assertStringContainsString('$kingpinAEjes > $kingpinAlFinal', $controlador);
});

it('solo se exige la coherencia cuando se puede comprobar', function (): void {
    // Si a alguna de las dos fichas le faltan sus huecos no hay cadena contra
    // la que comparar. Negarse por no poder comprobar dejaría sin guardar la
    // única medida que alguien tiene.
    $controlador = fuenteDelConjunto('app/Http/Controllers/App/ComboSpacingController.php');

    test()->assertStringContainsString('if ($total !== null && $parachoques < $total)', $controlador);
});

it('cada medida del margen se nombra por sus dos extremos', function (): void {
    /*
    | «Kingpin» a secas es media medida: de la misma palabra salen el tiro
    | desde el eje de dirección, la distancia al grupo de ejes y la del final
    | de la cama, y son tres cifras distintas que caben en la misma casilla.
    | La columna se llamaba así y la etiqueta decía otra cosa.
    */
    foreach (['en', 'es'] as $idioma) {
        $d = json_decode((string) file_get_contents(Source::root()."/lang/{$idioma}/equipment.json"), true);

        expect($d['combos']['kingpin'] ?? null)->toBeNull("En {$idioma} queda una etiqueta «kingpin» a secas.");

        test()->assertStringContainsString(
            $idioma === 'en' ? 'rear of trailer' : 'final del remolque',
            (string) $d['combos']['kingpinToRear'],
            "En {$idioma} la medida no dice hasta dónde llega.",
        );
    }

    $migracion = fuenteDelConjunto('database/migrations/2026_09_27_100000_create_combo_spacings.php');
    test()->assertStringContainsString("'kingpin_to_rear_inches'", $migracion);
});
