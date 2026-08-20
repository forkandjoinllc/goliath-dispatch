<?php

declare(strict_types=1);

use App\Http\Controllers\Marketing\CarrierSignupController;
use App\Http\Controllers\Marketing\LeadController;
use App\Http\Controllers\Marketing\PageController;
use App\Support\Locales;
use App\Support\Marketing\Site;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Sitio público
|--------------------------------------------------------------------------
|
| Todo el sitio público vive bajo un prefijo de idioma: /en/... y /es/...
| La raíz redirige al idioma negociado.
|
| Por qué prefijo obligatorio y no un `/services` que cambia según la cookie: una
| URL debe servir siempre el mismo contenido. Si la cookie decidiera, dos
| personas abriendo el mismo enlace verían páginas distintas y un buscador
| indexaría una de las dos versiones al azar.
|
*/

Route::get('/', function () {
    $locale = Locales::negotiate(request()->header('Accept-Language'));

    // 302 y no 301: la negociación depende de quien pide, y un 301 se queda
    // cacheado en el navegador y en los intermediarios. Alguien que cambia el
    // idioma de su navegador debe poder aterrizar en el otro.
    return redirect(Site::path($locale), 302);
})->name('root');

foreach (Locales::all() as $code) {
    Route::prefix($code)->group(function () use ($code): void {
        Route::get('/', PageController::class)->name("marketing.{$code}.home");

        foreach (Site::ROUTES as $route) {
            if ($route === 'home') {
                continue;
            }

            Route::get($route, PageController::class)
                ->defaults('route', $route)
                ->name("marketing.{$code}.".Site::dictionaryKey($route));
        }
    });
}

/*
|--------------------------------------------------------------------------
| Formularios públicos
|--------------------------------------------------------------------------
|
| Sin prefijo de idioma: el idioma del envío sale del contexto de la petición
| (cookie, cabecera o el referente de la página), no de la URL de destino.
| Duplicar cada endpoint por idioma no aportaría nada y doblaría la superficie.
|
| El límite es por IP y deliberadamente bajo: seis envíos por hora es más de lo
| que hace nadie honestamente y mucho menos de lo que intenta un bot. Las otras
| dos defensas (campo trampa y sello firmado) van dentro de la petición.
|
*/

Route::middleware('throttle:6,60')->group(function (): void {
    Route::post('leads', [LeadController::class, 'storeLead'])->name('marketing.leads.store');
    Route::post('quote-requests', [LeadController::class, 'storeQuote'])->name('marketing.quotes.store');
    Route::post('carrier-signup', CarrierSignupController::class)->name('marketing.carrierSignup.store');
});

require __DIR__.'/auth.php';
