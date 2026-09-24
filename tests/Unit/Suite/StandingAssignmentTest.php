<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * El equipo habitual de un conductor, y las dos preguntas que contesta.
 *
 * «¿Con qué anda Eduardo?» y «¿quién lleva el 101?» son la misma fila leída por
 * los dos extremos, y las dos las hace el tablero — una por columna.
 *
 * ## Lo que este guardián sujeta
 *
 * Que el solapamiento se comprueba en UN sitio. MySQL no sabe expresarlo —no
 * hay tipo rango ni restricción de exclusión— así que no hay red debajo: el día
 * que un controlador escriba la fila sin pasar por `choques()`, la base la
 * acepta y el tablero enseña el mismo camión con dos conductores.
 */
function fuenteDeLaAsignacion(string $ruta): string
{
    return Source::sinComentarios(Source::root().'/'.$ruta);
}

it('el solapamiento se comprueba en un solo sitio', function (): void {
    $soporte = fuenteDeLaAsignacion('app/Support/Fleet/StandingAssignment.php');

    // Las dos reglas, con su nombre, para que el mensaje pueda decir cuál es.
    test()->assertStringContainsString("'driverBusy'", $soporte);
    test()->assertStringContainsString("'truckBusy'", $soporte);

    // Y quien guarda una asignación no puede saltárselas: `crear()` las
    // pregunta y se niega a escribir si chocan.
    test()->assertStringContainsString('$choques = self::choques(', $soporte);
    test()->assertStringContainsString("if (\$choques !== []) {\n            return \$choques;\n        }", $soporte);
});

it('nadie más escribe en la tabla sin preguntar', function (): void {
    // Leerla la lee quien quiera. Lo que no puede hacer nadie más es
    // ESCRIBIRLA: un `insert` suelto en otro controlador dejaría el mismo
    // camión con dos conductores sin que nada fallara, porque MySQL no sabe
    // rechazar un solapamiento.
    //
    // Se mira la consulta, no el fichero: `DriverController` lee la tabla para
    // saber qué camiones ofrecer, y tiene `->update(` de otras tablas a
    // montones. Contar por fichero lo señalaría a él y no al defecto.
    $raiz = Source::root().'/app';
    $escriben = [];

    $iterador = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raiz));

    foreach ($iterador as $fichero) {
        if (! $fichero->isFile() || $fichero->getExtension() !== 'php') {
            continue;
        }

        $codigo = Source::compacta((string) $fichero->getPathname());
        $trozos = explode("DB::table('driver_equipment_assignments')", $codigo);
        array_shift($trozos);

        foreach ($trozos as $trozo) {
            // Hasta el final de ESA consulta.
            $consulta = explode(';', $trozo, 2)[0] ?? '';

            if (preg_match('/->(insert|update|delete)\(/', $consulta) === 1) {
                $escriben[] = substr((string) $fichero->getPathname(), strlen(Source::root()) + 1);

                break;
            }
        }
    }

    sort($escriben);

    // UNO y nada más: el soporte. Los controladores le piden que escriba, y por
    // eso no pueden saltarse la comprobación. Un segundo escritor tiene que
    // declararse aquí y decir cómo comprueba el solapamiento.
    expect($escriben)->toBe(['app/Support/Fleet/StandingAssignment.php']);
});

it('el historial no se borra', function (): void {
    // Una carga de marzo se mira con el camión que se llevó en marzo. Terminar
    // es poner fecha de fin, no quitar la fila.
    $soporte = fuenteDeLaAsignacion('app/Support/Fleet/StandingAssignment.php');

    test()->assertStringContainsString("'ends_on' => max(\$hoy, \$inicio)", $soporte);
    test()->assertStringNotContainsString('->delete()', $soporte);
});

it('el remolque puede faltar y el camión no', function (): void {
    // En una flota los remolques se sueltan y se recogen; una asignación sin
    // camión no asigna nada.
    $controlador = fuenteDeLaAsignacion('app/Http/Controllers/App/DriverEquipmentController.php');

    test()->assertStringContainsString("'truck_id' => ['required'", $controlador);
    test()->assertStringContainsString("'trailer_id' => ['nullable'", $controlador);
});

it('la columna de conductores lee el equipo habitual, no la carga', function (): void {
    // La pregunta de esa columna es «¿con qué anda?», que se contesta igual
    // esté o no llevando algo hoy.
    $tablero = fuenteDeLaAsignacion('app/Http/Controllers/App/BoardController.php');

    test()->assertStringContainsString('StandingAssignment::deConductores(', $tablero);
});

it('la tarjeta de la carga lee lo que de verdad se despachó', function (): void {
    // Y no el equipo habitual: el día que el camión de siempre está en el
    // taller, la carga tiene que enseñar el que fue.
    $tablero = fuenteDeLaAsignacion('app/Http/Controllers/App/BoardController.php');

    test()->assertStringContainsString("->from('load_assignments as la')", $tablero);
    test()->assertStringContainsString("DB::table('load_assignments as a')", $tablero);
});

it('las dos pantallas de conductores alcanzan a los mismos', function (): void {
    // La lista y el tablero. La que se desviara sería la del tablero, que es la
    // que se mira todo el día: enseñaría a un conductor de otro transportista
    // mientras la lista no lo enseña, y nadie sabría cuál tiene razón.
    foreach ([
        'app/Http/Controllers/App/DriverController.php',
        'app/Http/Controllers/App/BoardController.php',
    ] as $ruta) {
        test()->assertStringContainsString(
            'DriverScope::apply(',
            fuenteDeLaAsignacion($ruta),
            "`{$ruta}` alcanza los conductores por su cuenta.",
        );
    }
});

it('el permiso sobre un conductor se pide con el mismo contexto', function (): void {
    // `ResourceContext` toma cuatro identificadores del mismo tipo: ponerlos en
    // otro orden no falla, deniega por «fuera de alcance» y no dice por qué.
    foreach ([
        'app/Http/Controllers/App/DriverController.php',
        'app/Http/Controllers/App/DriverEquipmentController.php',
    ] as $ruta) {
        test()->assertStringContainsString('DriverScope::contexto(', fuenteDeLaAsignacion($ruta));
    }
});

it('el prerrellenado no pisa ni se salta la puerta', function (): void {
    $cargas = fuenteDeLaAsignacion('app/Http/Controllers/App/LoadAssignmentController.php');

    // No pisa: mira si ya hay algo puesto.
    test()->assertStringContainsString('$ocupado', $cargas);
    // Y no se salta la puerta: la misma que pasaría puesto a mano.
    test()->assertStringContainsString('$this->checkResource($model, $tipo, $id) !== null', $cargas);
});
