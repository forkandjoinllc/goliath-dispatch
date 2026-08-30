<?php

declare(strict_types=1);

use App\Http\Controllers\Marketing\CarrierSignupController;
use App\Http\Controllers\Marketing\LeadController;
use App\Http\Controllers\Marketing\PageController;
use App\Http\Controllers\Public\SignatureController as PublicSignatureController;
use App\Http\Controllers\Public\TrackingController as PublicTrackingController;
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

/*
|--------------------------------------------------------------------------
| Rastreo público
|--------------------------------------------------------------------------
|
| Sin sesión: el enlace se le manda a un cliente que no tiene cuenta y que puede
| abrirlo desde cualquier parte.
|
| CON prefijo de idioma, al revés que los formularios públicos, y por un motivo
| concreto: al formulario llega alguien que ya está navegando y trae su idioma
| en la cabecera o en la cookie; este enlace lo abre alguien que llega desde un
| correo, sin contexto ninguno, y acabaría leyendo lo que diga el navegador de
| su oficina. Quien reparte el enlace sabe en qué idioma habla su cliente, así
| que el idioma va en la URL que se le entrega. La forma sin prefijo se queda
| viva porque los enlaces ya repartidos la usan, y ahí sí negocia la cabecera.
|
| El límite es por IP y deliberadamente holgado para una persona y estrecho para
| una máquina: el token son 48 caracteres al azar y adivinarlo es inviable, pero
| esto corta de raíz que alguien lo intente a ritmo de máquina.
*/
Route::middleware('throttle:30,1')->get('t/{token}', PublicTrackingController::class)
    ->name('public.tracking');

foreach (Locales::all() as $code) {
    Route::middleware('throttle:30,1')
        ->prefix($code)
        ->get('t/{token}', PublicTrackingController::class)
        ->name("public.tracking.{$code}");
}

/*
|--------------------------------------------------------------------------
| Ceremonia de firma
|--------------------------------------------------------------------------
|
| Sin sesión, como el rastreo público, y con la misma regla de prefijo de
| idioma: quien abre el enlace llega desde un correo, sin cookie que diga en qué
| idioma habla. Aquí importa más todavía — el idioma en que se manda un acuerdo
| lo decidió quien lo mandó, y la solicitud lo lleva guardado en `locale`.
|
| El límite es más estrecho que el del rastreo porque estas rutas ESCRIBEN, y
| una de ellas sella un registro que no se puede deshacer.
*/
Route::middleware('throttle:20,1')->group(function (): void {
    Route::get('s/{token}', [PublicSignatureController::class, 'show'])->name('public.signature');
    Route::post('s/{token}/sign', [PublicSignatureController::class, 'sign'])->name('public.signature.sign');
    Route::post('s/{token}/decline', [PublicSignatureController::class, 'decline'])->name('public.signature.decline');

    foreach (Locales::all() as $code) {
        Route::prefix($code)->group(function () use ($code): void {
            Route::get('s/{token}', [PublicSignatureController::class, 'show'])->name("public.signature.{$code}");
            Route::post('s/{token}/sign', [PublicSignatureController::class, 'sign'])->name("public.signature.sign.{$code}");
            Route::post('s/{token}/decline', [PublicSignatureController::class, 'decline'])->name("public.signature.decline.{$code}");
        });
    }
});

require __DIR__.'/auth.php';
