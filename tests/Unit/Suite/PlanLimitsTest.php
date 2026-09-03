<?php

declare(strict_types=1);

use App\Support\Plans\Limits;
use Tests\Support\Source;

/**
 * Todo tope que la pantalla VENDE tiene que tener quien lo cuente y quien lo
 * aplique.
 *
 * Hermana de tests/Unit/Suite/InertSettingsTest.php y por el mismo motivo: una
 * pantalla que afirma algo que no es verdad. Allí era un ajuste que se editaba y
 * nadie leía; aquí es un número que se COBRA y nadie aplicaba.
 *
 * `saas_plans` trae `max_users`, `max_carriers` y `max_loads_per_month` desde el
 * primer día. La pantalla de suscripción los enseña con todas las letras —«hasta
 * 5 usuarios, 15 transportistas, 150 cargas al mes»— y hasta el lote 56 no los
 * leía nadie: se podían crear los que fuera en el plan más pequeño. Falla en las
 * dos direcciones, y esa es la parte que lo hace peor que un defecto normal:
 * quien paga el plan grande tampoco recibe nada a cambio de la diferencia.
 *
 * ## Qué comprueba
 *
 * 1. Que toda columna `max_*` del esquema esté en `Limits::COLUMNS`. Una columna
 *    nueva que se venda y no aparezca en ese mapa es el mismo defecto otra vez.
 * 2. Que cada recurso tenga al menos un sitio en `app/` —fuera de Limits— que
 *    llame a `Limits::isFull` con él. Contar sin aplicar es lo que ya había.
 *
 * No se comprueba que la aplicación sea CORRECTA: eso lo prueban
 * tests/Feature/Plans/. Lo que esto atrapa es el caso categórico, cero
 * aplicadores, que es el que se cuela sin que nadie lo note.
 *
 * `tests/Unit` no arranca la aplicación: la raíz sube tres niveles.
 */
function raizTopes(): string
{
    return dirname(__DIR__, 3);
}

/**
 * Las columnas de tope que el esquema define.
 *
 * Del DDL y no de una lista escrita a mano, por la misma razón de siempre: una
 * lista describe el esquema del día que se escribió.
 *
 * @return list<string>
 */
function columnasDeTope(): array
{
    $ddl = (string) file_get_contents(raizTopes().'/database/schema/01_tenancy_auth_tables.sql');

    preg_match('/create table `saas_plans`\s*\((.+?)\n\) engine/is', $ddl, $tabla);

    preg_match_all('/^\s+`(max_\w+)`\s/m', $tabla[1], $columnas);

    return array_values(array_unique($columnas[1]));
}

/**
 * El código de un fichero SIN sus comentarios.
 *
 * Tres guardianes míos han pasado con el fallo puesto por encontrar en sus
 * propios comentarios justo lo que buscaban (lotes 49, 54 y 55). Este nace ya
 * filtrando, y se verificó saboteando: quitando la llamada de LoadController,
 * falla.
 */
function codigoDeTopesSinComentarios(string $ruta): string
{
    // El cuerpo vivía copiado en quince ficheros. Ver Tests\Support\Source:
    // no quitaba los espacios, y por eso varias agujas de esta carpeta no
    // podían casar con nada.
    return Source::sinComentarios($ruta);
}

/**
 * Los ficheros de `app/` que aplican topes, con sus comentarios quitados.
 *
 * @return list<string>
 */
function aplicadoresDeTopes(): array
{
    $excluidos = ['app/Support/Plans/Limits.php'];
    $fuentes = [];

    $iterador = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(raizTopes().'/app')
    );

    foreach ($iterador as $fichero) {
        if ($fichero->getExtension() !== 'php') {
            continue;
        }

        $relativo = str_replace(raizTopes().'/', '', $fichero->getPathname());

        if (in_array($relativo, $excluidos, true)) {
            continue;
        }

        $fuentes[] = codigoDeTopesSinComentarios($fichero->getPathname());
    }

    return $fuentes;
}

it('mapea toda columna de tope del esquema', function (): void {
    $delEsquema = columnasDeTope();
    $mapeadas = array_values(Limits::COLUMNS);

    sort($delEsquema);
    sort($mapeadas);

    expect($delEsquema)->not->toBeEmpty()
        ->and($mapeadas)->toBe(
            $delEsquema,
            'Hay una columna `max_*` en saas_plans que Limits::COLUMNS no conoce. '
            .'Si se vende en la pantalla de suscripción y nadie la lee, es el defecto que esta prueba existe para cerrar.'
        );
});

it('aplica cada tope en algún sitio de la aplicación', function (): void {
    $fuentes = aplicadoresDeTopes();

    foreach (array_keys(Limits::COLUMNS) as $recurso) {
        $constante = match ($recurso) {
            Limits::USERS => 'Limits::USERS',
            Limits::CARRIERS => 'Limits::CARRIERS',
            Limits::LOADS => 'Limits::LOADS',
        };

        $aplicado = false;

        foreach ($fuentes as $codigo) {
            if (str_contains($codigo, 'isFull') && str_contains($codigo, $constante)) {
                $aplicado = true;
                break;
            }
        }

        expect($aplicado)->toBeTrue(
            "El tope `{$recurso}` se cuenta y se enseña, y no lo aplica nadie. "
            .'Un tope que solo se cuenta es exactamente lo que había antes del lote 56.'
        );
    }
});
