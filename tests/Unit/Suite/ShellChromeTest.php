<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * El armazón: el menú recogido y el tablero pegado a los bordes.
 *
 * ## El menú está recogido SIEMPRE
 *
 * No es el patrón de móvil aplicado a todo: es que el ancho de la pantalla se
 * lo lleva el trabajo. En el tablero de despacho, las dieciséis rem que ocupaba
 * el menú fijo son dieciséis rem de mapa.
 *
 * Tres cosas tienen que seguir siendo ciertas, y ninguna se ve sola:
 *
 *  - Que el cajón se **pinte siempre** aunque esté cerrado. Montarlo al abrir
 *    lo haría aparecer de golpe: una animación necesita un estado del que
 *    salir, y ese estado tiene que existir antes.
 *  - Que cerrado esté **fuera del recorrido del tabulador**. Un menú escondido
 *    por el que se puede tabular atrapa a quien navega con teclado en veinte
 *    enlaces que no ve.
 *  - Que el botón esté **delante del logo** y en todos los tamaños. Es el único
 *    camino para abrirlo: escondido en pantalla ancha, el menú no se abre.
 */
function fuenteDelArmazon(string $ruta): string
{
    return (string) file_get_contents(Source::root().'/'.$ruta);
}

it('el cajón se pinta siempre, también cerrado', function (): void {
    $armazon = fuenteDelArmazon('resources/js/layouts/AppLayout.tsx');

    // Ni `{navOpen ? <Sidebar/> : null}` ni `{navOpen && ...}`: eso lo monta al
    // abrir, y lo montado no se desliza.
    test()->assertStringNotContainsString('{navOpen ? (', $armazon);
    test()->assertStringContainsString('<Sidebar groups={shell.nav} />', $armazon);
});

it('entra deslizándose desde la izquierda', function (): void {
    $armazon = fuenteDelArmazon('resources/js/layouts/AppLayout.tsx');

    test()->assertStringContainsString('transition-transform', $armazon);
    test()->assertStringContainsString("navOpen ? 'translate-x-0 visible' : 'invisible -translate-x-full'", $armazon);
});

it('cerrado no se puede tabular por él', function (): void {
    // `invisible` lo saca del recorrido del tabulador. `opacity-0` no.
    $armazon = fuenteDelArmazon('resources/js/layouts/AppLayout.tsx');

    test()->assertStringContainsString('invisible -translate-x-full', $armazon);
    test()->assertStringContainsString('aria-hidden={!navOpen}', $armazon);
});

it('no queda ninguna columna fija que se coma el ancho', function (): void {
    $armazon = fuenteDelArmazon('resources/js/layouts/AppLayout.tsx');

    test()->assertStringNotContainsString('hidden w-64 shrink-0 lg:block', $armazon);
});

it('el botón del menú está delante del logo y en todos los tamaños', function (): void {
    $barra = fuenteDelArmazon('resources/js/components/App/Topbar.tsx');

    $boton = strpos($barra, 'aria-controls="app-nav"');
    $logo = strpos($barra, 'alt="Goliath Dispatch"');

    expect($boton)->not->toBeFalse('El botón del menú desapareció de la barra.');
    expect($logo)->not->toBeFalse('El logo no está en la barra superior.');
    expect($boton)->toBeLessThan($logo, 'El logo se puso delante del botón del menú.');

    // Y no se esconde en pantalla ancha: es el único camino para abrirlo.
    $trozo = substr($barra, $boton - 400, 600);
    test()->assertStringNotContainsString('lg:hidden', $trozo);
});

it('el logo no está dos veces', function (): void {
    // Se mudó del cajón a la barra. Con el menú recogido, el logo se iba con él
    // y la aplicación se quedaba sin nombre en pantalla; dejarlo en los dos
    // sitios lo pintaría dos veces al abrir.
    $cajon = fuenteDelArmazon('resources/js/components/App/Sidebar.tsx');

    test()->assertStringNotContainsString('logo-reversed', $cajon);
});

it('el menú dice cómo se cierra, en los dos idiomas', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/nav.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        expect($d['openMenu'] ?? null)->toBeString("Falta nav.openMenu en {$idioma}.");
        expect($d['closeMenu'] ?? null)->toBeString("Falta nav.closeMenu en {$idioma}.");
    }
});

it('el tablero pega sus columnas a los bordes y pone el mapa en medio', function (): void {
    $tablero = fuenteDelArmazon('resources/js/pages/App/Board.tsx');

    // Sin la caja centrada del armazón: si no, las columnas quedan flotando con
    // aire a los lados y el mapa pierde el ancho que vino a ocupar.
    test()->assertStringContainsString('bleed', $tablero);
    test()->assertStringContainsString('xl:grid-cols-[21rem_minmax(0,1fr)_19rem]', $tablero);

    // Separadas por una LÍNEA, no por aire: en una pantalla que se mira de
    // reojo, el borde es lo que dice dónde acaba una cosa y empieza otra.
    test()->assertStringContainsString('xl:border-r', $tablero);
    test()->assertStringContainsString('xl:border-l', $tablero);

    $armazon = fuenteDelArmazon('resources/js/layouts/AppLayout.tsx');

    test()->assertStringContainsString("bleed ? 'flex min-h-0 flex-1 flex-col' : 'mx-auto max-w-7xl'", $armazon);
});

it('cada columna se desplaza sola', function (): void {
    // Si la lista de cargas arrastrara la página entera, el mapa se iría hacia
    // arriba al bajar por las cargas — en la pantalla donde se mira el mapa
    // MIENTRAS se lee la lista.
    $tablero = fuenteDelArmazon('resources/js/pages/App/Board.tsx');

    test()->assertStringContainsString('overflow-y-auto', $tablero);
});
