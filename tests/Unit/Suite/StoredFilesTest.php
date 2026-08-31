<?php

declare(strict_types=1);

/**
 * Ninguna columna del esquema que guarde un fichero puede quedar fuera del
 * inventario.
 *
 * Siete tablas apuntan al almacén, repartidas por cinco ficheros de DDL, y
 * hasta el lote 53 nadie tenía la lista entera. El efecto no fue teórico: la
 * purga de retención del lote 52 borraba filas de `document_versions` y
 * `message_attachments` sin tocar sus ficheros, porque quien la escribió no
 * tenía delante qué columnas apuntaban dónde. El sistema decía «purgado» y el
 * PDF seguía en el disco.
 *
 * Sin esta prueba, la siguiente tabla que guarde ficheros y no se registre
 * dejaría huérfanos para siempre y nadie se enteraría — que es exactamente lo
 * que acababa de pasar.
 *
 * `tests/Unit` no arranca la aplicación, así que la raíz sube tres niveles.
 */
function raizDelProyectoAlmacen(): string
{
    return dirname(__DIR__, 3);
}

/**
 * Las columnas del esquema que guardan una clave de almacenamiento.
 *
 * Se detectan por el NOMBRE —termina en `_storage_key` o es `storage_key`— y no
 * por una lista: si hubiera que enumerarlas aquí, esta prueba sería una copia de
 * la constante que vigila y las dos se equivocarían a la vez.
 *
 * @return array<string, list<string>>
 */
function columnasDeAlmacenEnElEsquema(): array
{
    $encontradas = [];

    foreach (glob(raizDelProyectoAlmacen().'/database/schema/0*.sql') ?: [] as $fichero) {
        $ddl = (string) file_get_contents($fichero);

        preg_match_all('/create table `?(\w+)`?\s*\((.+?)\n\) engine/is', $ddl, $tablas, PREG_SET_ORDER);

        foreach ($tablas as [$_, $tabla, $cuerpo]) {
            preg_match_all('/^\s+`?(\w*storage_key)`?\s/mi', $cuerpo, $columnas);

            if ($columnas[1] !== []) {
                $encontradas[$tabla] = array_values(array_unique($columnas[1]));
            }
        }
    }

    return $encontradas;
}

it('el inventario nombra exactamente las columnas que hay en el esquema', function () {
    $delEsquema = columnasDeAlmacenEnElEsquema();
    $delCodigo = App\Support\Storage\StoredFiles::COLUMNS;

    ksort($delEsquema);
    ksort($delCodigo);

    foreach ($delEsquema as $t => $c) {
        sort($c);
        $delEsquema[$t] = $c;
    }

    foreach ($delCodigo as $t => $c) {
        sort($c);
        $delCodigo[$t] = $c;
    }

    // Las dos direcciones. Que falte una es lo grave —sus ficheros quedan
    // huérfanos—; que sobre una también es un error, porque el barrido
    // consultaría una columna que ya no existe y reventaría.
    expect($delCodigo)->toBe($delEsquema, implode("\n", [
        'El inventario StoredFiles::COLUMNS no coincide con el esquema.',
        'En el esquema: '.json_encode($delEsquema, JSON_UNESCAPED_SLASHES),
        'En el código:  '.json_encode($delCodigo, JSON_UNESCAPED_SLASHES),
    ]));
});

it('toda tabla del inventario declara si lleva empresa', function () {
    // Al buscar huérfanos por empresa hay que saber cuáles no se pueden
    // atribuir a ninguna: el avatar de una persona que pertenece a tres
    // empresas no es de ninguna de las tres.
    $sinEmpresa = [];

    foreach (glob(raizDelProyectoAlmacen().'/database/schema/0*.sql') ?: [] as $fichero) {
        $ddl = (string) file_get_contents($fichero);

        foreach (array_keys(App\Support\Storage\StoredFiles::COLUMNS) as $tabla) {
            if (! preg_match('/create table `?'.preg_quote($tabla, '/').'`?\s*\((.+?)\n\) engine/is', $ddl, $m)) {
                continue;
            }

            if (! preg_match('/^\s+`?tenant_id`?\s/mi', $m[1])) {
                $sinEmpresa[] = $tabla;
            }
        }
    }

    sort($sinEmpresa);
    $declaradas = App\Support\Storage\StoredFiles::WITHOUT_TENANT;
    sort($declaradas);

    expect($declaradas)->toBe($sinEmpresa);
});
