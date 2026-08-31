<?php

declare(strict_types=1);

/**
 * Ningún literal de tipo de documento puede quedar fuera del CHECK del esquema.
 *
 * `documents.document_type` y `load_documents.document_type` son `varchar(30)`
 * con un CHECK que enumera los valores admitidos. Un literal del código que no
 * esté en esa lista no da error de compilación, ni de tipos, ni de análisis
 * estático. Da algo peor: una comparación que NUNCA es cierta.
 *
 *     ->where('d.document_type', 'proof_of_delivery')   // el CHECK dice 'pod'
 *
 * Esa línea vivió meses en la puerta de `pod_received`. No fallaba: bloqueaba
 * siempre, porque ninguna fila podía tener ese valor. El estado con el que se
 * factura una carga era inalcanzable en producción, y la suite estaba verde
 * —las pruebas que la tocaban escribían el mismo literal equivocado, así que
 * confirmaban el error en vez de encontrarlo—.
 *
 * De ahí que esta prueba lea el CHECK del DDL y no una constante de PHP: una
 * constante la escribe la misma mano que escribe el literal, y las dos se
 * equivocan a la vez. El esquema es la única fuente que no se puede convencer.
 *
 * `tests/Unit` no arranca la aplicación, así que la raíz se calcula subiendo
 * tres niveles desde este fichero en vez de con `base_path()`.
 */
function raizDelProyecto(): string
{
    return dirname(__DIR__, 3);
}

/**
 * Los valores del CHECK de una columna `document_type`, leídos del DDL.
 *
 * @return list<string>
 */
function tiposAdmitidosPor(string $ficheroDdl, string $constraint): array
{
    $ddl = (string) file_get_contents(raizDelProyecto().'/database/schema/'.$ficheroDdl);

    $encontrado = preg_match(
        '/constraint\s+'.preg_quote($constraint, '/').'\s+check\s*\(\s*document_type\s+in\s*\((.+?)\)\s*\)/is',
        $ddl,
        $coincidencias,
    );

    expect($encontrado)->toBe(1, "No se encontró el CHECK {$constraint} en {$ficheroDdl}.");

    preg_match_all("/'([^']+)'/", $coincidencias[1], $valores);

    return array_values(array_unique($valores[1]));
}

/**
 * Los literales de tipo de documento que escribe el código de la aplicación.
 *
 * Solo las dos formas que de verdad comparan contra la columna. Una expresión
 * más laxa recogería `stop_id`, `owner_type` o cualquier `title`, y un guardián
 * con falsos positivos se acaba desactivando — y entonces no guarda nada.
 *
 * @return array<string, string> literal => fichero donde aparece
 */
function literalesDeTipoEnElCodigo(): array
{
    $encontrados = [];

    foreach ([raizDelProyecto().'/app'] as $raiz) {
        $iterador = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raiz));

        foreach ($iterador as $fichero) {
            if ($fichero->getExtension() !== 'php') {
                continue;
            }

            $codigo = (string) file_get_contents($fichero->getPathname());
            $relativo = str_replace(raizDelProyecto().'/', '', $fichero->getPathname());

            // ->where('...document_type', 'valor')  y  ->where('...document_type', '=', 'valor')
            preg_match_all(
                "/->(?:where|orWhere)\(\s*'[\w.]*document_type'\s*,\s*(?:'=',\s*)?'([\w]+)'\s*\)/",
                $codigo,
                $comparaciones,
            );

            // 'document_type' => 'valor'   (los INSERT y UPDATE)
            preg_match_all(
                "/'document_type'\s*=>\s*'([\w]+)'/",
                $codigo,
                $asignaciones,
            );

            foreach ([...$comparaciones[1], ...$asignaciones[1]] as $literal) {
                $encontrados[$literal] ??= $relativo;
            }
        }
    }

    return $encontrados;
}

it('el CHECK de documents y el de load_documents dicen lo mismo', function () {
    // Son dos columnas y dos CHECK, en dos ficheros de esquema distintos. Si se
    // separan, un tipo válido para el documento deja de serlo para el enlace y
    // el INSERT del enlace revienta a mitad de una transacción.
    $documentos = tiposAdmitidosPor('02_carriers_documents_signatures_tables.sql', 'chk_documents_document_type');
    $enlaces = tiposAdmitidosPor('04_loads_routes_permits_tables.sql', 'chk_load_documents_document_type');

    sort($documentos);
    sort($enlaces);

    expect($enlaces)->toBe($documentos);
});

it('todo tipo del catálogo existe en el esquema', function () {
    $admitidos = tiposAdmitidosPor('02_carriers_documents_signatures_tables.sql', 'chk_documents_document_type');

    $reflexion = new ReflectionClass(App\Support\Documents\DocumentTypes::class);
    /** @var array<string, array{0: string, 1: bool}> $catalogo */
    $catalogo = $reflexion->getConstant('CATALOG');

    $intrusos = array_values(array_diff(array_keys($catalogo), $admitidos));

    expect($intrusos)->toBe([], 'Tipos del catálogo que el CHECK del esquema no admite: '.implode(', ', $intrusos));
});

it('ningún literal del código queda fuera del CHECK', function () {
    $admitidos = tiposAdmitidosPor('02_carriers_documents_signatures_tables.sql', 'chk_documents_document_type');

    $intrusos = [];

    foreach (literalesDeTipoEnElCodigo() as $literal => $fichero) {
        if (! in_array($literal, $admitidos, true)) {
            $intrusos[] = "'{$literal}' => {$fichero}";
        }
    }

    expect($intrusos)->toBe([], "Literales que ninguna fila puede tener nunca:\n".implode("\n", $intrusos));
});
