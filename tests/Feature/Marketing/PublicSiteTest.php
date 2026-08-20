<?php

declare(strict_types=1);

use App\Enums\Locale;
use App\Support\Locales;
use App\Support\Marketing\Site;

it('la raíz redirige al idioma negociado', function () {
    $this->get('/')->assertRedirect('/en');
    $this->withHeader('Accept-Language', 'es-MX,es;q=0.9')->get('/')->assertRedirect('/es');
    // El factor q manda sobre el orden de aparición.
    $this->withHeader('Accept-Language', 'en;q=0.4, es;q=0.9')->get('/')->assertRedirect('/es');
});

it('sirve las once rutas en los dos idiomas', function (string $locale, string $route) {
    $this->get(Site::path(Locale::from($locale), $route))
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->component('Marketing/'.ucfirst(Site::dictionaryKey($route)))
            ->where('locale', $locale)
            ->where('route', $route)
        );
})->with(function () {
    foreach (Locales::all() as $locale) {
        foreach (Site::ROUTES as $route) {
            yield "{$locale} {$route}" => [$locale, $route];
        }
    }
});

it('el prefijo de la URL manda sobre la cookie', function () {
    // Si la cookie pudiera cambiar lo que sirve una URL, dos personas abriendo el
    // mismo enlace verían páginas distintas.
    $this->withCookie(Locales::COOKIE, 'es')
        ->get('/en/services')
        ->assertInertia(fn ($page) => $page->where('locale', 'en'));
});

it('el prefijo manda también sobre Accept-Language', function () {
    $this->withHeader('Accept-Language', 'es')
        ->get('/en/services')
        ->assertInertia(fn ($page) => $page->where('locale', 'en'));
});

it('una ruta que no existe da 404', function () {
    $this->get('/en/no-existe')->assertNotFound();
    $this->get('/fr/services')->assertNotFound();
});

it('cada página trae su SEO con canonical y hreflang', function () {
    $this->get('/es/heavy-haul')->assertInertia(fn ($page) => $page
        ->where('seo.canonical', Site::url('/es/heavy-haul'))
        ->where('seo.alternates.en-US', Site::url('/en/heavy-haul'))
        ->where('seo.alternates.es-US', Site::url('/es/heavy-haul'))
        ->where('seo.alternates.x-default', Site::url('/en/heavy-haul'))
    );
});

it('el título y la descripción de SEO vienen traducidos, no como claves', function (string $locale) {
    foreach (Site::ROUTES as $route) {
        $this->get(Site::path(Locale::from($locale), $route))
            ->assertInertia(function ($page) use ($route) {
                $title = $page->toArray()['props']['seo']['title'];
                $description = $page->toArray()['props']['seo']['description'];
                expect($title)->not->toStartWith('marketing.', "SEO sin traducir en {$route}");
                expect($description)->not->toStartWith('marketing.', "descripción sin traducir en {$route}");
                expect(mb_strlen($description))->toBeGreaterThan(50);
            });
    }
})->with(['en', 'es']);

it('el conmutador apunta a la MISMA página en el otro idioma', function () {
    $this->get('/en/for-carriers')->assertInertia(fn ($page) => $page
        ->where('alternate.locale', 'es')
        ->where('alternate.href', '/es/for-carriers')
        ->where('alternate.label', 'Español')
    );

    $this->get('/es/for-carriers')->assertInertia(fn ($page) => $page
        ->where('alternate.locale', 'en')
        ->where('alternate.href', '/en/for-carriers')
        ->where('alternate.label', 'English')
    );
});

it('la navegación llega resuelta con hrefs del idioma correcto', function () {
    $this->get('/es')->assertInertia(function ($page) {
        $nav = $page->toArray()['props']['nav'];
        expect($nav['primary'])->toHaveCount(count(Site::PRIMARY_NAV));
        foreach ($nav['primary'] as $link) {
            expect($link['href'])->toStartWith('/es/');
        }
        expect($nav['home'])->toBe('/es');
    });
});

it('solo viajan los espacios de diccionario que la página pidió', function () {
    $this->get('/en')->assertInertia(function ($page) {
        $keys = array_keys($page->toArray()['props']['dictionary']);
        sort($keys);
        // common, nav, errors (siempre) + marketing, validation (esta página).
        expect($keys)->toBe(['common', 'errors', 'marketing', 'nav', 'validation']);
        // Y NO los 22: son 3.374 claves, unos 190 KB, y aquí hacen falta cinco
        // espacios.
        expect($keys)->not->toContain('finance');
        expect($keys)->not->toContain('load');
    });
});
