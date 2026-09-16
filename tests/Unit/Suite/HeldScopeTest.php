<?php

declare(strict_types=1);

use App\Support\Documents\DocumentOwners;
use App\Support\Retention\HeldTogether;
use App\Support\Retention\Policy;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;
use function PHPUnit\Framework\assertArrayNotHasKey;
use function PHPUnit\Framework\assertContains;
use function PHPUnit\Framework\assertGreaterThan;
use function PHPUnit\Framework\assertSame;
use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * Un bloqueo legal alcanza lo que cuelga de la fila bloqueada.
 *
 * ## El defecto, que ya estaba escrito
 *
 * `Holds` describe su alcance `record` como «una carga concreta **y lo que
 * cuelga de ella**», y enumera qué: «los papeles, la conversación con el
 * transportista, las horas del viaje, la factura. Sin esto, la política de
 * retención hace su trabajo puntualmente y borra la prueba».
 *
 * `stamp()` marcaba una fila. Una. Todo lo demás seguía con `legal_hold = 0` y
 * el barrido lo purgaba en su fecha.
 *
 * La dirección contraria SÍ estaba resuelta —`CascadedFiles::heldParentIds()`,
 * un hijo bloqueado salva a su padre— y su cabecera dice la misma frase: «el
 * bloqueo protegía la fila y no protegía nada». Media escalera.
 *
 * ## Qué vigila este guardián
 *
 * Sobre todo, la tabla veintidós: que una tabla nueva de la política con
 * `load_id` no se quede fuera de la lista en silencio, que es como se queda
 * fuera todo.
 */
function raizAlcance(): string
{
    return Source::root();
}

/** El DDL entero, que es donde vive la verdad sobre las columnas. */
function ddlDelEsquema(): string
{
    static $ddl = null;

    if ($ddl === null) {
        $ddl = '';

        foreach (glob(raizAlcance().'/database/schema/0*.sql') ?: [] as $fichero) {
            $ddl .= (string) file_get_contents($fichero);
        }
    }

    return $ddl;
}

/** Las columnas declaradas de una tabla, leídas del `create table`. */
function columnasDeclaradas(string $tabla): array
{
    if (! preg_match('/^create table '.preg_quote($tabla, '/').'\s*\((.*?)^\) engine=/ms', ddlDelEsquema(), $m)) {
        return [];
    }

    preg_match_all('/^\s{2}`?([a-z_]+)`?\s+(?:char|varchar|tinyint|int|bigint|decimal|datetime|date|text|json|longtext|smallint)/mi', $m[1], $c);

    return $c[1];
}

it('cada arista declara una sola forma de engancharse', function (): void {
    foreach (HeldTogether::CUELGA as $padre => $aristas) {
        assertArrayHasKey($padre, Policy::ENTITIES, "«{$padre}» no es una tabla que la política barra");

        foreach ($aristas as $arista) {
            assertArrayHasKey('tabla', $arista);

            $formas = array_intersect_key($arista, ['por' => null, 'desde' => null]);

            assertSame(
                1,
                count($formas),
                "la arista {$padre} → {$arista['tabla']} tiene ".count($formas).' formas de engancharse, y tiene que tener una',
            );
        }
    }
});

it('las columnas de cada arista existen en el esquema', function (): void {
    // Una columna mal escrita no falla: `whereIn('load_ib', …)` reventaría, pero
    // `cuando` sobre una columna que no existe sí, y una tabla mal escrita
    // devolvería cero filas en silencio — un bloqueo que no bloquea nada, que
    // es exactamente el defecto.
    foreach (HeldTogether::CUELGA as $padre => $aristas) {
        foreach ($aristas as $arista) {
            $hija = $arista['tabla'];

            if (isset($arista['desde'])) {
                assertContains($arista['desde'], columnasDeclaradas($padre), "«{$padre}.{$arista['desde']}» no existe");

                continue;
            }

            $columnasHija = columnasDeclaradas($hija);

            assertContains($arista['por'], $columnasHija, "«{$hija}.{$arista['por']}» no existe");

            foreach (array_keys($arista['cuando'] ?? []) as $columna) {
                assertContains($columna, $columnasHija, "«{$hija}.{$columna}» no existe");
            }
        }
    }
});

it('el DDL contesta por todas las tablas de la política', function (): void {
    // Si `columnasDeclaradas()` devolviera vacío por un fallo de la expresión,
    // la comprobación de abajo pasaría SIEMPRE sin mirar nada. Es la forma en
    // que un guardián se vuelve decorativo sin que se note.
    foreach (array_keys(Policy::ENTITIES) as $tabla) {
        assertContains('tenant_id', columnasDeclaradas($tabla), "el DDL no contesta por «{$tabla}»");
        assertContains('legal_hold', columnasDeclaradas($tabla), "«{$tabla}» no tiene `legal_hold`: un bloqueo no puede marcarla");
    }
});

it('toda tabla de la política con `load_id` cuelga de la carga', function (): void {
    // LA TABLA VEINTIDÓS. Esta es la comprobación que importa: el esquema crece,
    // y una tabla nueva con `load_id` que no esté aquí se purga mientras hay un
    // pleito abierto sobre esa carga, sin que nada avise.
    $declaradas = array_column(HeldTogether::CUELGA['loads'], 'tabla');

    foreach (array_keys(Policy::ENTITIES) as $tabla) {
        if (! in_array('load_id', columnasDeclaradas($tabla), true)) {
            continue;
        }

        assertContains(
            $tabla,
            $declaradas,
            "«{$tabla}» tiene `load_id` y no cuelga de la carga: un bloqueo legal no la alcanza",
        );
    }
});

it('los papeles no se declaran dos veces', function (): void {
    // `DocumentOwners` ya dice qué tipo de dueño vive en qué tabla. Repetirlo
    // aquí sería la segunda lista que contesta la misma pregunta — la forma
    // exacta del defecto que este lote arregla.
    foreach (HeldTogether::CUELGA as $padre => $aristas) {
        foreach ($aristas as $arista) {
            if ($arista['tabla'] !== 'documents') {
                continue;
            }

            assertArrayNotHasKey(
                'owner_type',
                $arista['cuando'] ?? [],
                "«{$padre}» declara sus papeles a mano en vez de dejárselo a DocumentOwners",
            );
        }
    }
});

it('los papeles de una tabla salen de DocumentOwners', function (): void {
    $dePermisos = array_values(array_filter(
        HeldTogether::aristas('permits'),
        static fn (array $a): bool => $a['tabla'] === 'documents',
    ));

    $tipos = array_map(static fn (array $a): string => $a['cuando']['owner_type'], $dePermisos);

    sort($tipos);

    assertSame(['permit', 'route_survey'], $tipos);

    // Y la carga también tiene los suyos, que es lo que la cabecera llama «los
    // papeles».
    $deCargas = array_filter(
        HeldTogether::aristas('loads'),
        static fn (array $a): bool => $a['tabla'] === 'documents',
    );

    assertSame(['load'], array_values(array_map(
        static fn (array $a): string => $a['cuando']['owner_type'],
        $deCargas,
    )));

    // Todo tipo de dueño que exista tiene que salir por `tiposDeTabla` de
    // alguna tabla, o sus papeles no los alcanza ningún bloqueo.
    foreach (DocumentOwners::all() as $tipo) {
        $suyas = [];

        foreach (['carriers', 'drivers', 'trucks', 'trailers', 'loads', 'expenses', 'permits', 'escorts'] as $tabla) {
            $suyas = [...$suyas, ...DocumentOwners::tiposDeTabla($tabla)];
        }

        assertContains($tipo, $suyas, "el dueño «{$tipo}» no vive en ninguna tabla conocida");
    }
});

it('marcar el bloqueo pasa por el alcance y no por una sola fila', function (): void {
    $fuente = Source::compacta(raizAlcance().'/app/Support/Retention/Holds.php');

    assertStringContainsString('HeldTogether::alcance(', $fuente);

    // El `update` de la raíz sigue existiendo —hay que marcar la fila— pero ya
    // no es lo único que pasa. Si alguien quita el recorrido, esto cae.
    assertStringContainsString("\$scopeType==='record'?[(string)\$entityId]", $fuente);
});

it('el recorrido no marca fuera de la política', function (): void {
    // `legal_hold` existe en treinta tablas y la política barre veintiuna.
    // Marcar en las otras nueve no protege de nada —no se purgan— y deja una
    // columna escrita que nadie lee, que es de donde venía el defecto anterior.
    $fuente = Source::compacta(raizAlcance().'/app/Support/Retention/HeldTogether.php');

    assertStringContainsString('isset(Policy::ENTITIES[$hija])', $fuente);
});

it('el barrido sigue preguntando a la columna fila por fila', function (): void {
    // El recorrido de arriba solo sirve si la purga mira `legal_hold`. Si
    // alguien la cambia por una consulta a `legal_holds`, este lote deja de
    // hacer algo y conviene enterarse.
    $fuente = Source::compacta(raizAlcance().'/app/Support/Retention/Sweeper.php');

    assertStringContainsString("where('legal_hold',0)", $fuente);
    assertStringContainsString("where('legal_hold',1)", $fuente);
});

it('la otra dirección sigue cubierta', function (): void {
    // Un hijo bloqueado salva a su padre del borrado en cascada. Es la mitad
    // que ya existía, y las dos tienen que estar.
    $fuente = Source::compacta(raizAlcance().'/app/Support/Retention/Sweeper.php');

    assertStringContainsString('CascadedFiles::heldParentIds(', $fuente);
    assertStringNotContainsString('heldParentIds()', $fuente);
});

it('la pantalla dice qué alcanza cada alcance', function (): void {
    // «Un registro concreto» describía lo que el código HACÍA y no lo que la
    // cabecera prometía. Ahora alcanza lo que cuelga, y quien aplica un bloqueo
    // por una reclamación tiene que poder saber si la factura entra sin leer el
    // código.
    $pantalla = (string) file_get_contents(raizAlcance().'/resources/js/pages/App/Retention/Index.tsx');
    $pantalla = (string) preg_replace('#/\*.*?\*/#s', '', $pantalla);

    assertStringContainsString('retention.scope.hint.${form.data.scope_type}', $pantalla);

    foreach (['es', 'en'] as $idioma) {
        $scope = json_decode(
            (string) file_get_contents(raizAlcance()."/lang/{$idioma}/retention.json"),
            true,
        )['scope'];

        foreach (['tenant', 'entity_type', 'record'] as $alcance) {
            assertArrayHasKey($alcance, $scope['hint'], "falta la explicación de «{$alcance}» en {$idioma}");
            assertGreaterThan(40, strlen($scope['hint'][$alcance]), "la explicación de «{$alcance}» en {$idioma} no dice nada");
        }
    }

    // Y la etiqueta del alcance por registro ya no dice solo «un registro».
    $es = json_decode((string) file_get_contents(raizAlcance().'/lang/es/retention.json'), true);
    assertStringContainsString('cuelga', $es['scope']['record']);
});

it('las tablas alcanzadas no incluyen la raíz', function (): void {
    // Un ciclo en el esquema —`documents` → `document_versions` →
    // `documents`— recorrería sin fin. El registro de visitados lo corta, y
    // esto fija que existe.
    $fuente = Source::compacta(raizAlcance().'/app/Support/Retention/HeldTogether.php');

    assertStringContainsString('$vistos[$hija][$id]', $fuente);
    assertStringContainsString('array_fill_keys($ids,true)', $fuente);
});
