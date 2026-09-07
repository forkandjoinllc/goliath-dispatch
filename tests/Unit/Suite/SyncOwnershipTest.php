<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * Un id que llega del formulario no se mete en un WHERE tal cual.
 *
 * ## El defecto
 *
 * `LoadController::syncStops()` hacía esto:
 *
 *     DB::table('load_stops')->where('id', $stop['id'])->update($columns);
 *
 * Sin `load_id`, sin `tenant_id`, y con la validación pidiendo solo
 * `['nullable', 'string', 'size:36']`. `DB::table` no pasa por el ámbito global
 * de Eloquent, así que ahí no había nada que lo parara: cualquiera que pudiera
 * editar una carga podía mandar el id de una parada de OTRA empresa y
 * sobrescribirla. Se comprobó con dos empresas montadas.
 *
 * ## Por qué esto se puede vigilar
 *
 * Porque el proyecto ya lo hace bien en otros SIETE sitios. Todos los demás
 * `sync*` —`syncRequirements`, `syncContacts`, `syncLocations`,
 * `syncCarriers`, `syncFactoring`— resuelven la fila DENTRO del dueño y solo
 * entonces actualizan por el id ya resuelto:
 *
 *     $existente = DB::table('...')->where('tenant_id', ...)
 *         ->where('customer_id', ...)->where('id', $id)->first();
 *
 * `syncStops` era el único que se saltaba el paso. La regla existía; faltaba
 * quien la sujetara.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código.
 */
function raizSync(): string
{
    return Source::root();
}

/**
 * Todos los métodos `sync*` de los controladores, con su cuerpo.
 *
 * @return array<string, string> «Fichero::metodo» => cuerpo sin comentarios
 */
function metodosSync(): array
{
    $cuerpos = [];

    $iterador = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(raizSync().'/app/Http/Controllers', FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterador as $fichero) {
        if ($fichero->getExtension() !== 'php') {
            continue;
        }

        $codigo = Source::sinComentarios($fichero->getPathname());

        preg_match_all('/(?:private|protected|public) function (sync[A-Za-z]+)\(/', $codigo, $nombres, PREG_OFFSET_CAPTURE);

        foreach ($nombres[1] as $i => [$nombre, $_]) {
            $inicio = $nombres[0][$i][1];

            // Hasta la firma del método siguiente. Una ventana de tamaño fijo
            // acaba leyendo el método de al lado — ya mordió en otro lote.
            $fin = strlen($codigo);
            foreach (['/\n    (?:private|protected|public) function /'] as $patron) {
                if (preg_match($patron, $codigo, $m, PREG_OFFSET_CAPTURE, $inicio + 1)) {
                    $fin = $m[0][1];
                }
            }

            $cuerpos[basename($fichero->getPathname()).'::'.$nombre] = substr($codigo, $inicio, $fin - $inicio);
        }
    }

    return $cuerpos;
}

/* ── Ningún WHERE por id suelto sobre un id del formulario ───────────────── */

it('ningún sync escribe filtrando solo por un id que llega de fuera', function (): void {
    $malos = [];

    foreach (metodosSync() as $nombre => $cuerpo) {
        // Sentencias que ESCRIBEN y filtran por id.
        preg_match_all('/DB::table\(\'[a-z_]+\'\)((?:(?!;).)*);/s', $cuerpo, $sentencias);

        foreach ($sentencias[0] as $sentencia) {
            if (! str_contains($sentencia, '->update(') && ! str_contains($sentencia, '->delete(')) {
                continue;
            }

            if (! str_contains($sentencia, "where('id'")) {
                continue;
            }

            // La forma correcta: el id ya viene de una fila resuelta dentro del
            // dueño, y por eso se lee `$algo->id` y no `$peticion['id']`.
            if (preg_match('/where\(\'id\', \$[a-z]+->id\)/i', $sentencia) === 1) {
                continue;
            }

            $malos[] = $nombre.'  ->  '.trim(preg_replace('/\s+/', ' ', $sentencia));
        }
    }

    expect($malos)->toBe([], "Estos escriben filtrando por un id que no se ha resuelto dentro del dueño:\n".implode("\n", $malos));
});

it('ningún sync borra de verdad una tabla con borrado blando', function (): void {
    // `load_stops` tiene deleted_at, deleted_by y deletion_reason, y las trece
    // lecturas del proyecto las filtran. Este método hacía un DELETE crudo.
    $malos = [];

    foreach (metodosSync() as $nombre => $cuerpo) {
        if (preg_match('/->delete\(\)/', $cuerpo) === 1) {
            $malos[] = $nombre;
        }
    }

    expect($malos)->toBe([], 'Estos borran de verdad: '.implode(', ', $malos));
});

/* ── Y lo que syncStops hace ahora, en concreto ──────────────────────────── */

it('syncStops resuelve la parada dentro de la carga', function (): void {
    $cuerpo = metodosSync()['LoadController.php::syncStops'] ?? '';

    expect($cuerpo)->not->toBe('');

    // LA SENTENCIA DE BÚSQUEDA, no el método entero. Mirando el método, las
    // agujas casaban con el UPDATE de borrado blando del final —que también
    // lleva tenant_id y load_id— y el sabotaje que le quitaba el load_id a la
    // búsqueda pasaba en verde.
    $inicio = strpos($cuerpo, '$existente = $id === null ? null : DB::table');
    expect($inicio)->toBeInt('cambió la forma de la búsqueda y esto dejó de mirar nada');

    $fin = strpos($cuerpo, ';', $inicio);
    $busqueda = substr($cuerpo, $inicio, $fin - $inicio);

    expect($busqueda)->toContain("->where('tenant_id', \$load->tenant_id)")
        ->and($busqueda)->toContain("->where('load_id', \$load->id)")
        ->and($busqueda)->toContain("->where('id', \$id)")
        ->and($busqueda)->toContain("->whereNull('deleted_at')")
        // Y un id que no resuelve NO se convierte en una parada nueva: eso
        // taparía el intento.
        ->and($cuerpo)->toContain('ValidationException::withMessages');
});

it('syncStops quita en blando, con quién y por qué', function (): void {
    $cuerpo = metodosSync()['LoadController.php::syncStops'] ?? '';

    expect($cuerpo)->toContain("'deleted_at' => \$ahora,")
        ->and($cuerpo)->toContain("'deleted_by' => \$actor->auditUserId(),")
        ->and($cuerpo)->toContain("'deletion_reason' => 'stop_removed_on_load_edit',");
});

it('syncStops ordena por la clave antes de numerar', function (): void {
    // `$request->validate()` no devuelve el array en el orden de envío: lo monta
    // regla por regla. Sin ksort, una parada nueva puesta la primera se
    // guardaba la última.
    $cuerpo = metodosSync()['LoadController.php::syncStops'] ?? '';

    $orden = strpos($cuerpo, 'ksort($stops);');
    $bucle = strpos($cuerpo, 'foreach (array_values($stops)');

    expect($orden)->toBeInt()->and($bucle)->toBeInt();
    test()->assertLessThan($bucle, $orden, 'ksort tiene que ir ANTES del bucle que numera.');
});

it('syncStops aparta los números de orden antes de reasignarlos', function (): void {
    // UNIQUE (load_id, live_sequence): intercambiar dos paradas choca consigo
    // mismo si no se apartan primero.
    $cuerpo = metodosSync()['LoadController.php::syncStops'] ?? '';

    expect($cuerpo)->toContain('self::DESPLAZAMIENTO_ORDEN');
});

it('el error señala la posición que mandó el formulario', function (): void {
    $cuerpo = metodosSync()['LoadController.php::syncStops'] ?? '';

    // `$posiciones[$index]` y no `$index`: con el array reordenado por la
    // validación, el segundo señala una fila inocente.
    expect($cuerpo)->toContain("'stops.'.(\$posiciones[\$index] ?? \$index).'.id'");
});

/* ── El esquema deja que el borrado blando funcione ──────────────────────── */

it('el índice único de las paradas mira solo las vivas', function (): void {
    // Sin esto, una parada quitada se queda con su número ocupado PARA SIEMPRE,
    // y borrar de verdad vuelve a ser el único camino que funciona.
    $migracion = raizSync().'/database/migrations/2026_09_13_100000_load_stops_live_sequence.php';

    expect(file_exists($migracion))->toBeTrue();

    $codigo = Source::sinComentarios($migracion);

    expect($codigo)->toContain('add column `live_sequence`')
        ->and($codigo)->toContain('case when `deleted_at` is null then `sequence` end')
        ->and($codigo)->toContain('drop index `load_stops_load_sequence_uq`')
        ->and($codigo)->toContain('(`load_id`, `live_sequence`)');
});
