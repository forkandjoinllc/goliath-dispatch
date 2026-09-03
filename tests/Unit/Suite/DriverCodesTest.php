<?php

declare(strict_types=1);

use App\Support\Drivers\Cdl;
use Tests\Support\Source;

/**
 * Las letras de una licencia tienen que decir lo que significan.
 *
 * ## El defecto
 *
 * `drivers.cdl_class`, `drivers.endorsements` y `drivers.restrictions` están en
 * el esquema desde el primer día. La pantalla enseñaba:
 *
 *  - los endosos como seis botones cuadrados con una LETRA dentro, y en la
 *    ficha unidos por comas: «H, N, T»;
 *  - la clase como una letra suelta: «A»;
 *  - las restricciones en ningún sitio. La columna existía y el formulario las
 *    llevaba en sus datos, devolviéndolas tal cual al guardar, sin un solo
 *    control para ponerlas ni una línea para verlas.
 *
 * Debajo había una leyenda apretada que explicaba cinco de los seis endosos: se
 * dejaba fuera la S.
 *
 * Y la validación era `max:4`, o sea CUALQUIER cadena de cuatro caracteres. Se
 * podía guardar `ZZ`, y ningún diccionario sabe nombrar eso.
 *
 * ## De dónde salieron los nombres
 *
 * Del diccionario PORTADO `driver.json`, que traía las tres tablas completas y
 * traducidas a los dos idiomas desde el principio. Es exactamente lo que
 * `PortedDictionariesTest` pide que se haga antes de construir un dominio —leer
 * el portado— y que en `drivers` estaba pendiente.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código, como en los demás
 * guardianes de esta carpeta.
 */
function raizCodigos(): string
{
    return Source::root();
}

/* ── Cada letra tiene nombre, en los dos idiomas ─────────────────────────── */

it('cada código de licencia tiene nombre en los dos idiomas', function (): void {
    $tablas = [
        'cdlClass' => Cdl::CLASES,
        'endorsements' => Cdl::ENDOSOS,
        'restrictions' => Cdl::RESTRICCIONES,
    ];

    foreach (['en', 'es'] as $idioma) {
        $diccionario = json_decode(
            (string) file_get_contents(raizCodigos()."/lang/{$idioma}/drivers.json"), true
        );

        foreach ($tablas as $tabla => $codigos) {
            foreach ($codigos as $codigo) {
                $nombre = $diccionario[$tabla][$codigo] ?? null;

                expect($nombre)->not->toBeNull(
                    "Falta el nombre de «{$codigo}» en {$idioma}/drivers.json ({$tabla}). La pantalla "
                    .'volvería a enseñar una letra suelta que hay que descifrar.'
                );

                // Y que no sea la propia letra: «H» como nombre de «H» no
                // explica nada, y es lo que había antes de este lote.
                expect(trim((string) $nombre))->not->toBe($codigo);
            }
        }
    }
});

/* ── Ninguna pantalla pinta la letra sola ────────────────────────────────── */

it('la ficha no vuelve a unir los códigos por comas', function (): void {
    $pantalla = Source::compacta(raizCodigos().'/resources/js/pages/App/Drivers/Show.tsx');

    expect(str_contains($pantalla, 'driver.endorsements.join('))->toBeFalse(
        'La ficha volvió a enseñar «H, N, T». Un dato de cumplimiento que hay que descifrar no se '
        .'comprueba: se mira por encima.'
    );

    // La ficha compone la clave —`drivers.${espacio}.${codigo}`— así que la
    // aguja es el molde y el valor que se le mete, no la clave entera. Buscar
    // «drivers.endorsements.» no casaría nunca, y esta comprobación pasaría
    // siempre: es el fallo que el lote 69 encontró en cuatro guardianes.
    expect(str_contains($pantalla, 'drivers.${espacio}.'))->toBeTrue(
        'La ficha dejó de traducir los códigos de la licencia.'
    );

    foreach (['endorsements', 'restrictions'] as $tabla) {
        expect(str_contains($pantalla, "espacio=\"{$tabla}\""))->toBeTrue(
            "La ficha dejó de enseñar «{$tabla}»."
        );
    }

    expect(str_contains($pantalla, 'drivers.cdlClass.'))->toBeTrue(
        'La clase de licencia volvió a enseñarse como una letra suelta.'
    );
});

it('la ficha enseña las restricciones', function (): void {
    $pantalla = Source::compacta(raizCodigos().'/resources/js/pages/App/Drivers/Show.tsx');

    // Estaban en la columna, en la respuesta y en el diccionario —con rótulo
    // escrito— y no salían en ninguna pantalla. Una restricción dice lo que un
    // conductor NO puede conducir.
    expect(str_contains($pantalla, 'driver.restrictions'))->toBeTrue(
        'Las restricciones volvieron a ser invisibles.'
    );
});

it('el formulario deja poner restricciones, no solo devolverlas', function (): void {
    $pantalla = Source::compacta(raizCodigos().'/resources/js/pages/App/Drivers/Form.tsx');

    expect(str_contains($pantalla, 'codes.restrictions'))->toBeTrue(
        'El formulario volvió a llevar las restricciones en sus datos sin un control para ponerlas: las '
        .'recibía del servidor y se las devolvía intactas, para siempre.'
    );
});

/* ── Una sola lista, no tres ─────────────────────────────────────────────── */

it('la pantalla no lleva su propia lista de códigos', function (): void {
    $pantalla = Source::compacta(raizCodigos().'/resources/js/pages/App/Drivers/Form.tsx');

    // Había una constante `ENDORSEMENTS` en el TSX con un comentario que decía
    // «son cinco y no cambian» encima de una lista de SEIS, mientras la
    // validación del servidor admitía cualquier cosa de cuatro caracteres.
    expect(str_contains($pantalla, 'constENDORSEMENTS='))->toBeFalse(
        'Volvió la lista de endosos escrita en la pantalla. Con la lista en un sitio y la validación en '
        .'otro, las dos acaban diciendo cosas distintas.'
    );

    expect(str_contains($pantalla, 'codes.endorsements'))->toBeTrue();
});

it('el servidor valida contra el vocabulario y no contra una longitud', function (): void {
    $codigo = Source::compacta(raizCodigos().'/app/Http/Controllers/App/DriverController.php');

    foreach (["'endorsements.*'=>['string','max:4']", "'restrictions.*'=>['string','max:4']"] as $aguja) {
        expect(str_contains($codigo, $aguja))->toBeFalse(
            'Volvió la validación por longitud. Admite cualquier cadena de cuatro caracteres: se guarda '
            .'«ZZ» y la ficha enseña una letra que no significa nada.'
        );
    }

    expect(str_contains($codigo, 'Rule::in(Cdl::ENDOSOS)'))->toBeTrue();
    expect(str_contains($codigo, 'Rule::in(Cdl::RESTRICCIONES)'))->toBeTrue();
    expect(str_contains($codigo, 'Rule::in(Cdl::CLASES)'))->toBeTrue();
});

/* ── El demo enseña el caso ──────────────────────────────────────────────── */

it('el sembrador pone endosos y restricciones de verdad', function (): void {
    $codigo = Source::compacta(raizCodigos().'/database/seeders/DemoDataSeeder.php');

    // Las dos columnas se sembraban vacías porque no se veían. Un demo con
    // todos los conductores sin un solo endoso enseña una flota que no existe.
    expect(str_contains($codigo, "'endorsements'=>json_encode(\$r['endorsements'])"))->toBeTrue(
        'El sembrador volvió a dejar los endosos vacíos.'
    );

    expect(str_contains($codigo, "'restrictions'=>json_encode(\$r['restrictions'])"))->toBeTrue(
        'El sembrador volvió a dejar las restricciones vacías.'
    );
});
