<?php

declare(strict_types=1);

use App\Support\Links\CrossLink;
use App\Support\Navigation;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;
use function PHPUnit\Framework\assertContains;
use function PHPUnit\Framework\assertSame;
use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * Un enlace de ficha a ficha, o ninguno.
 *
 * ## El defecto
 *
 * La ficha de una carga pintaba el nombre del cliente como enlace. El
 * transportista y el conductor llegan a esa ficha con normalidad —los dos
 * tienen `load:read`— y ninguno tiene `customer:read`: pulsaban y aterrizaban en
 * «Acceso denegado». Cuatro sitios con la misma forma.
 *
 * ## La regla estaba escrita dos veces
 *
 * `Navigation`, sobre el menú: «un enlace que no lleva a ningún sitio es peor
 * que un enlace ausente — el usuario no sabe si le falta un permiso o si algo
 * está roto». Y `DocumentController::owner()`, que manda `href => null` a
 * propósito: «Sin enlace se lee que no lo hay; con uno roto, que la pantalla
 * está mal».
 *
 * Las dos piezas hacen lo correcto para lo suyo. Entre ellas quedaron los
 * enlaces de ficha a ficha.
 */
function raizEnlaces(): string
{
    return Source::root();
}

/** Igual que en los otros guardianes de pantalla: sin comentarios. */
function tsxSinComentarios(string $ruta): string
{
    $texto = (string) file_get_contents(raizEnlaces().'/'.$ruta);
    $texto = (string) preg_replace('#/\*.*?\*/#s', '', $texto);

    return (string) preg_replace('#^\s*//.*$#m', '', $texto);
}

it('cada destino exige el mismo permiso que su entrada de menú', function (): void {
    // Son la misma pregunta —«¿puede este actor abrir esta pantalla?»— y dos
    // listas que la contestan por separado acaban contestando distinto.
    $delMenu = [];

    foreach (Navigation::rutasYPermisos() as $ruta => $permisos) {
        $delMenu[$ruta] = $permisos;
    }

    $esperado = [
        'customer' => 'customers',
        'carrier' => 'carriers',
        'driver' => 'drivers',
        'load' => 'loads',
        'truck' => 'equipment/trucks',
        'trailer' => 'equipment/trucks',
    ];

    foreach (CrossLink::DESTINOS as $destino => [$permiso, $plantilla]) {
        assertArrayHasKey($destino, $esperado, "el destino «{$destino}» no está emparejado con su pantalla");

        $ruta = $esperado[$destino];

        assertArrayHasKey($ruta, $delMenu, "el menú ya no tiene «{$ruta}»");

        // `toContain` con un segundo argumento busca una SEGUNDA aguja, no
        // escribe un mensaje. Es el error que más vueltas me ha costado.
        assertContains(
            $permiso,
            $delMenu[$ruta],
            "«{$destino}» pide «{$permiso}» y el menú de «{$ruta}» pide otra cosa",
        );

        // Y la plantilla lleva un hueco y solo uno: construir la ruta en cada
        // pantalla es como acabaron conviviendo dos formas de la de equipos.
        assertSame(1, substr_count($plantilla, '%s'), "la plantilla de «{$destino}» no tiene un solo hueco");
    }
});

it('lo que no resuelve está declarado', function (): void {
    // Se comprueba el permiso, no el alcance sobre esa fila. Una deuda escrita
    // es una deuda que se paga; una que solo vive en la cabeza de quien la
    // contrajo, no.
    assertArrayHasKey('assigned', CrossLink::SIN_AMBITO);

    foreach (CrossLink::SIN_AMBITO as $clave => $motivo) {
        expect(strlen($motivo))->toBeGreaterThan(120, "la deuda «{$clave}» no explica nada");
    }
});

it('sin id y sin permiso no hay enlace', function (): void {
    $fuente = Source::compacta(raizEnlaces().'/app/Support/Links/CrossLink.php');

    // Null y no cadena vacía: la pantalla pregunta `href ? <Link> : <span>` y
    // un vacío se colaría como enlace a la raíz del sitio.
    expect($fuente)->toContain("\$id===null||(string)\$id===''");
    expect($fuente)->toContain('returnnull;');
    expect($fuente)->toContain('$checker->can($actor,$permiso,null,$policy)->allowed');
});

it('los tres controladores mandan el enlace y no lo inventa la pantalla', function (): void {
    foreach ([
        ['app/Http/Controllers/App/LoadController.php', "CrossLink::para(\$checker,\$actor,'customer',\$customer->id,\$policy)"],
        ['app/Http/Controllers/App/LoadController.php', "CrossLink::para(\$checker,\$actor,'carrier',\$carrier->id,\$policy)"],
        ['app/Http/Controllers/App/DriverController.php', "CrossLink::para(\$checker,\$actor,'carrier',\$r->id,\$policy)"],
        ['app/Http/Controllers/App/EquipmentController.php', "CrossLink::para(\$checker,\$actor,'carrier',\$g('carrier_id'),\$policy)"],
    ] as [$ruta, $aguja]) {
        assertStringContainsString($aguja, Source::compacta(raizEnlaces().'/'.$ruta), "falta en {$ruta}");
    }
});

it('ninguna de las tres pantallas construye ya la ruta a mano', function (): void {
    foreach ([
        'resources/js/pages/App/Loads/Show.tsx',
        'resources/js/pages/App/Drivers/Show.tsx',
        'resources/js/pages/App/Equipment/Show.tsx',
    ] as $ruta) {
        $pantalla = tsxSinComentarios($ruta);

        // Las dos rutas que llevaban a «Acceso denegado». La de edición de la
        // propia ficha —`/drivers/${id}/edit`— sigue construyéndose a mano y
        // está bien: esa pantalla se ofrece con `can.update`, que el servidor
        // ya calculó.
        assertStringNotContainsString('href={`/customers/${', $pantalla, "{$ruta} vuelve a inventar la ruta al cliente");
        assertStringNotContainsString('href={`/carriers/${', $pantalla, "{$ruta} vuelve a inventar la ruta al transportista");
    }

    // Y el nombre se sigue viendo cuando no hay enlace: quitar el enlace no
    // puede quitar el dato.
    $ficha = tsxSinComentarios('resources/js/pages/App/Loads/Show.tsx');

    assertStringContainsString('<span className="text-sm text-steel-700">{load.customer.name}</span>', $ficha);
    assertStringContainsString('<span className="font-medium text-carbon">{load.carrier.name}</span>', $ficha);
});
