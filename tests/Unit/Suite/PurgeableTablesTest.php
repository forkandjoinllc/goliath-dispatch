<?php

declare(strict_types=1);

/**
 * Ninguna tabla que el barrido purgue puede tener un disparador que prohíba el
 * DELETE.
 *
 * El esquema se contradice a sí mismo en este punto, y no es un descuido menor:
 * seis tablas llevan las columnas de retención —`archived_at`,
 * `purge_eligible_at`, `legal_hold`— y ADEMÁS un disparador `before delete` que
 * lanza `SIGNAL sqlstate '45000'`. Con unas columnas el esquema dice «puedes
 * purgar esto»; con un disparador dice «no puedes borrar esto jamás».
 *
 * Gana el disparador. Son libros de solo-añadir cuyo valor entero es que nadie
 * los pueda tocar, y un libro que se puede podar no demuestra nada.
 *
 * Sin esta prueba, la contradicción se descubriría del peor modo posible: un
 * barrido nocturno reventando con un error de MySQL a mitad de una transacción
 * y arrastrando con él lo que ya llevara hecho. Y se descubriría en el cliente
 * que primero acumulara cinco años de datos, no en el primero.
 *
 * Se lee el DDL de los disparadores, no una constante de PHP: una constante la
 * escribe la misma mano que escribe la lista, y las dos se equivocan a la vez.
 *
 * `tests/Unit` no arranca la aplicación, así que la raíz se calcula subiendo
 * tres niveles desde este fichero.
 */
function raizDelRepo(): string
{
    return dirname(__DIR__, 3);
}

/**
 * Las tablas con un disparador `before delete` que lanza SIGNAL, leídas del DDL.
 *
 * Un `before delete` que hace otra cosa —`trg_customers_cascade_delete_contacts`
 * borra los contactos del cliente— NO cuenta: ese no prohíbe nada, ayuda.
 * Distinguirlos es lo único con miga de esta prueba.
 *
 * @return list<string>
 */
function tablasQueProhibenBorrar(): array
{
    $prohibidas = [];

    foreach (glob(raizDelRepo().'/database/schema/9*.sql') ?: [] as $fichero) {
        $ddl = (string) file_get_contents($fichero);

        // Cada disparador va de `create trigger` a su `end;`.
        preg_match_all('/create trigger.+?\bend;/is', $ddl, $bloques);

        foreach ($bloques[0] as $bloque) {
            if (! preg_match('/before\s+delete\s+on\s+`?(\w+)`?/i', $bloque, $m)) {
                continue;
            }

            if (! preg_match('/signal\s+sqlstate/i', $bloque)) {
                // Un disparador de borrado en cascada, no una prohibición.
                continue;
            }

            $prohibidas[] = $m[1];
        }
    }

    return array_values(array_unique($prohibidas));
}

it('la lista de intocables coincide con lo que dicen los disparadores', function () {
    $delEsquema = tablasQueProhibenBorrar();
    $delCodigo = App\Support\Retention\Policy::NEVER_PURGE;

    sort($delEsquema);
    sort($delCodigo);

    // Se comprueban las dos direcciones a propósito.
    //
    // Que falte una es lo grave: el barrido intentaría purgarla y reventaría.
    // Que sobre una es leve pero también es un error — una tabla en la lista sin
    // disparador detrás significa que alguien quitó el disparador y nadie
    // actualizó la lista, y entonces la lista ya no explica por qué está.
    expect($delEsquema)->toBe($delCodigo, implode("\n", [
        'La lista Policy::NEVER_PURGE no coincide con los disparadores del esquema.',
        'En el esquema: '.implode(', ', $delEsquema),
        'En el código:  '.implode(', ', $delCodigo),
    ]));
});

it('ninguna tabla de la política que se puede purgar prohíbe borrar', function () {
    // La comprobación que de verdad protege el barrido nocturno.
    $prohibidas = tablasQueProhibenBorrar();
    $intrusas = [];

    foreach (array_keys(App\Support\Retention\Policy::ENTITIES) as $tabla) {
        $politica = new App\Support\Retention\Policy(24, 5, 7);

        if ($politica->canPurge($tabla) && in_array($tabla, $prohibidas, true)) {
            $intrusas[] = $tabla;
        }
    }

    expect($intrusas)->toBe([], 'El barrido purgaría tablas cuyo disparador lo prohíbe: '.implode(', ', $intrusas));
});

/**
 * Las tablas con un `before update` que prohíbe CUALQUIER cambio.
 *
 * La otra mitad de la misma contradicción, que este fichero no miraba.
 *
 * Distinguir es lo que tiene miga, otra vez: `financial_snapshots`,
 * `signature_records` y `stripe_events` también llevan `before update`, pero el
 * suyo va dentro de un `if` que mira columnas y deja pasar `archived_at`,
 * `purge_eligible_at` y `legal_hold` A PROPÓSITO — el DDL lo dice con todas las
 * letras: «so the archival job can do its work without needing to bypass the
 * guard». Esas no estorban. Las que lanzan sin condición, sí.
 *
 * @return list<string>
 */
function tablasQueProhibenActualizar(): array
{
    $prohibidas = [];

    foreach (glob(raizDelRepo().'/database/schema/9*.sql') ?: [] as $fichero) {
        preg_match_all('/create trigger.+?\bend;/is', (string) file_get_contents($fichero), $bloques);

        foreach ($bloques[0] as $bloque) {
            if (! preg_match('/before\s+update\s+on\s+`?(\w+)`?/i', $bloque, $m)) {
                continue;
            }

            if (! preg_match('/signal\s+sqlstate/i', $bloque)) {
                continue;
            }

            if (preg_match('/\bif\b/i', $bloque)) {
                // Condicional: mira columnas y deja pasar las de retención.
                continue;
            }

            $prohibidas[] = $m[1];
        }
    }

    return array_values(array_unique($prohibidas));
}

it('la lista de tablas que no admiten escritura coincide con los disparadores', function () {
    // EL FALLO QUE ESTO CIERRA. `Sweeper::archive()` hace un `update` por cada
    // tabla de la política y `Holds` marca `legal_hold` en todas. Mientras
    // `signature_audit_events` estuvo vacía no se notó —un `update` que no toca
    // ninguna fila no dispara el disparador—, y en cuanto hubo una fila:
    //
    //  - levantar CUALQUIER bloqueo legal reventaba;
    //  - y el barrido nocturno reventaba en cuanto una fila pasaba de la
    //    ventana activa, o sea a los dos años, a mitad de la transacción.
    //
    // Este fichero llevaba desde el principio comprobando la mitad del DELETE.
    $delEsquema = array_values(array_intersect(
        tablasQueProhibenActualizar(),
        array_keys(App\Support\Retention\Policy::ENTITIES),
    ));
    $delCodigo = App\Support\Retention\Policy::NEVER_UPDATE;

    sort($delEsquema);
    sort($delCodigo);

    expect($delEsquema)->toBe($delCodigo, implode("\n", [
        'Policy::NEVER_UPDATE no coincide con los disparadores del esquema.',
        'En el esquema: '.implode(', ', $delEsquema),
        'En el código:  '.implode(', ', $delCodigo),
    ]));
});

it('lo que no se puede marcar tampoco se puede borrar', function () {
    // El invariante que hace honesto saltárselas. Si una tabla no admite que le
    // escriban `legal_hold` Y ADEMÁS se purga, entonces el bloqueo legal sobre
    // ella es una promesa vacía: el barrido la borraría sin poder consultar
    // nada. Saltársela solo es correcto porque nunca se borra.
    $sinMarcar = App\Support\Retention\Policy::NEVER_UPDATE;
    $sinBorrar = App\Support\Retention\Policy::NEVER_PURGE;

    expect(array_values(array_diff($sinMarcar, $sinBorrar)))->toBe(
        [],
        'Hay tablas que no se pueden marcar y sí se purgan: el bloqueo legal no las protege.',
    );
});

it('el barrido y los bloqueos se saltan lo que no admite escritura', function () {
    $barrido = Tests\Support\Source::compacta(raizDelRepo().'/app/Support/Retention/Sweeper.php');
    $bloqueos = Tests\Support\Source::compacta(raizDelRepo().'/app/Support/Retention/Holds.php');

    expect(substr_count($barrido, 'Policy::canMark('))->toBeGreaterThanOrEqual(1);

    // Tres sitios en `Holds`: la limpieza de `rebuild`, las tablas raíz y lo
    // que cuelga. Dejarse uno revienta igual.
    expect(substr_count($bloqueos, 'Policy::canMark('))->toBe(3);
});

it('el estado que escribe el barrido está en el CHECK de retention_jobs', function () {
    // El barrido escribía `completed` y el CHECK admite `succeeded`. Un literal
    // que el esquema no admite no da error de tipos ni de análisis estático: da
    // una fila que no entra, y el sitio donde se descubriría sería el primer
    // barrido nocturno de un cliente. Es el mismo tropiezo que el `pod` del
    // lote 50, y por eso se comprueba igual: leyendo el DDL.
    $ddl = (string) file_get_contents(raizDelRepo().'/database/schema/01_tenancy_auth_tables.sql');

    expect(preg_match(
        '/constraint\s+`?retention_jobs_status_chk`?\s+check\s*\(\s*`?status`?\s+in\s*\((.+?)\)\s*\)/is',
        $ddl,
        $m,
    ))->toBe(1);

    preg_match_all("/'([^']+)'/", $m[1], $admitidos);

    $codigo = (string) file_get_contents(raizDelRepo().'/app/Support/Retention/Sweeper.php');
    preg_match_all("/'status'\s*=>\s*'([\w]+)'/", $codigo, $escritos);

    $intrusos = array_values(array_diff(array_unique($escritos[1]), $admitidos[1]));

    expect($intrusos)->toBe([], 'Estados que el CHECK de retention_jobs no admite: '.implode(', ', $intrusos));
});

it('toda tabla de la política existe en el esquema y sabe archivarse', function () {
    // Una tabla en la política sin `archived_at` no se puede archivar, y el
    // barrido la contaría como candidata y no haría nada con ella — un
    // «procesados: 0» eterno que nadie sabría interpretar.
    $ddl = '';

    foreach (glob(raizDelRepo().'/database/schema/0*.sql') ?: [] as $fichero) {
        $ddl .= (string) file_get_contents($fichero);
    }

    $faltan = [];

    foreach (array_keys(App\Support\Retention\Policy::ENTITIES) as $tabla) {
        if (! preg_match('/create table `?'.preg_quote($tabla, '/').'`?\s*\((.+?)\n\) engine/is', $ddl, $m)) {
            $faltan[] = $tabla.' (no existe)';

            continue;
        }

        foreach (['archived_at', 'purge_eligible_at', 'legal_hold'] as $columna) {
            if (! str_contains($m[1], $columna)) {
                $faltan[] = $tabla.' (sin '.$columna.')';
            }
        }
    }

    expect($faltan)->toBe([], "Tablas de la política que no pueden retenerse:\n".implode("\n", $faltan));
});
