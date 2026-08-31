<?php

declare(strict_types=1);

/**
 * Ningún ajuste que la empresa pueda EDITAR puede quedarse sin que nadie lo lea.
 *
 * Es el fallo más caro de este proyecto y el que más veces ha aparecido: una
 * pantalla que afirma algo que no es verdad. Un botón roto se nota; una frase
 * falsa se cree.
 *
 * El caso que lo motivó: `tenant_settings.require_oversize_admin_validation` se
 * editaba con la etiqueta «las cargas sobredimensionadas necesitan validación de
 * un administrador», se guardaba, y NADIE lo leía. Alguien lo encendía, creía
 * tener un segundo par de ojos sobre la parte del sistema donde la gente se hace
 * daño, y el despacho se comportaba exactamente igual. Estuvo así desde el
 * primer día y lo encontró un barrido a mano, no una prueba.
 *
 * ## Qué cuenta como «leer»
 *
 * Que la columna aparezca en `app/` fuera del controlador de ajustes y de su
 * modelo. El controlador la escribe y el modelo la declara: ninguno de los dos
 * la USA. Cualquier otro sitio sí — una puerta, un barrido, un generador.
 *
 * No se comprueba que el uso sea correcto, y no se puede: eso lo prueban las
 * pruebas de cada dominio. Lo que esto atrapa es el caso categórico —CERO
 * lectores— que es el que se cuela sin que nadie lo note.
 *
 * `tests/Unit` no arranca la aplicación: la raíz sube tres niveles.
 */
function raizAjustes(): string
{
    return dirname(__DIR__, 3);
}

/**
 * Las columnas que el controlador de ajustes deja EDITAR.
 *
 * Se leen de sus reglas de validación y no de una lista: una lista escrita a
 * mano describe el formulario de hoy y calla el de mañana, que es exactamente
 * cómo se coló el que motivó esta prueba.
 *
 * @return list<string>
 */
function ajustesEditables(): array
{
    $codigo = (string) file_get_contents(
        raizAjustes().'/app/Http/Controllers/App/TenantSettingController.php'
    );

    preg_match_all("/^\s+'([a-z_]+)' => \[/m", $codigo, $m);

    // Las columnas de `tenant_settings`, para descartar las reglas que validan
    // otra cosa (un formulario puede llevar campos que no son de esta tabla).
    $ddl = (string) file_get_contents(raizAjustes().'/database/schema/01_tenancy_auth_tables.sql');

    preg_match('/create table `tenant_settings`\s*\((.+?)\n\) engine/is', $ddl, $tabla);

    preg_match_all('/^\s+`(\w+)`\s/m', $tabla[1], $columnas);

    return array_values(array_intersect(array_unique($m[1]), $columnas[1]));
}

/**
 * El código de un fichero SIN sus comentarios.
 *
 * Sin esto, este guardián no guarda nada, y lo comprobé de la peor manera: al
 * intentar que fallara a propósito, no falló. El comentario que explica un
 * ajuste MENCIONA su columna, así que `str_contains` la encontraba y daba el
 * ajuste por leído aunque nadie lo consultara.
 *
 * Es la tercera vez que un guardián mío tropieza con sus propios comentarios
 * —lote 49, lote 54, y este— y la regla ya está escrita: **un guardián se
 * verifica saboteando el código que protege.** Uno que pasa cuando el fallo
 * está presente es peor que no tenerlo, porque además tranquiliza.
 */
function codigoSinComentarios(string $ruta): string
{
    $fuente = (string) file_get_contents($ruta);

    // `token_get_all` distingue de verdad un comentario de una cadena que
    // contiene `//`. Una expresión regular sobre las líneas se equivocaría con
    // la primera URL que apareciera en el código.
    $codigo = '';

    foreach (token_get_all($fuente) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }

        $codigo .= is_array($token) ? $token[1] : $token;
    }

    return $codigo;
}

/**
 * ¿Lee alguien esta columna, fuera de donde se guarda y se declara?
 */
function alguienLee(string $columna): bool
{
    $excluidos = [
        'app/Http/Controllers/App/TenantSettingController.php',
        'app/Models/TenantSetting.php',
    ];

    $iterador = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(raizAjustes().'/app')
    );

    foreach ($iterador as $fichero) {
        if ($fichero->getExtension() !== 'php') {
            continue;
        }

        $relativo = str_replace(raizAjustes().'/', '', $fichero->getPathname());

        if (in_array($relativo, $excluidos, true)) {
            continue;
        }

        if (str_contains(codigoSinComentarios($fichero->getPathname()), $columna)) {
            return true;
        }
    }

    return false;
}

it('todo ajuste editable tiene a alguien que lo lea', function () {
    $editables = ajustesEditables();

    expect($editables)->not->toBeEmpty('La expresión ya no encuentra reglas: el guardián dejó de guardar.');

    $inertes = array_values(array_filter($editables, fn (string $c): bool => ! alguienLee($c)));

    expect($inertes)->toBe([], implode("\n", [
        'Ajustes que la empresa puede editar y que no lee NADIE:',
        ...$inertes,
        '',
        'O se usan, o se quitan del formulario. Un interruptor que no hace nada',
        'es peor que un interruptor ausente: quien lo enciende cree que hizo algo.',
    ]));
});
