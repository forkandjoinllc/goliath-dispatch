<?php

declare(strict_types=1);

use App\Http\Controllers\App\DashboardController;
use App\Http\Controllers\App\CarrierController;
use App\Http\Controllers\App\CarrierOnboardingController;
use App\Http\Controllers\App\CustomerController;
use App\Http\Controllers\App\LocaleController;
use App\Http\Controllers\Auth\SignupController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Autenticación y alta
|--------------------------------------------------------------------------
|
| Fortify registra por su cuenta /login, /logout, /forgot-password,
| /reset-password y /email/verify (ver config/fortify.php). Aquí van las rutas
| que NO son de Fortify.
|
| El alta de empresa es la primera: `Features::registration()` está desactivado
| a propósito porque darse de alta aquí no crea un usuario, crea una EMPRESA con
| su plan, su suscripción, sus ajustes y su primer administrador. Eso no cabe en
| el formulario de dos campos de Fortify.
|
*/

Route::get('signup', [SignupController::class, 'show'])->name('signup');

// Tres altas por hora y por IP. Es el endpoint más caro del sitio —siete filas
// y un correo— y por tanto el más rentable de automatizar.
Route::post('signup', [SignupController::class, 'store'])
    ->middleware('throttle:3,60')
    ->name('signup.store');

Route::get('signup/done', [SignupController::class, 'done'])->name('signup.done');

/*
|--------------------------------------------------------------------------
| Aplicación autenticada
|--------------------------------------------------------------------------
|
| Por ahora solo la pantalla de aterrizaje tras entrar. `verified` no se exige
| todavía: el correo de verificación va a un fichero de log mientras no haya
| credenciales de correo, y exigirlo dejaría fuera a todo el mundo. Se activa en
| cuanto el correo salga de verdad.
|
*/

Route::middleware(['auth'])->group(function (): void {
    Route::get('home', DashboardController::class)->name('home');
    Route::post('switch-tenant', [DashboardController::class, 'switchTenant'])->name('tenant.switch');
    Route::post('locale', LocaleController::class)->name('locale.update');

    /*
    | Transportistas
    |
    | `create` va ANTES de `{carrier}`: si no, Laravel casa /carriers/create con
    | la ruta de detalle y busca un transportista con id «create».
    */
    Route::get('carriers', [CarrierController::class, 'index'])->name('carriers.index');
    Route::get('carriers/create', [CarrierController::class, 'create'])->name('carriers.create');
    Route::post('carriers', [CarrierController::class, 'store'])->name('carriers.store');
    Route::get('carriers/{carrier}', [CarrierController::class, 'show'])->name('carriers.show');
    Route::get('carriers/{carrier}/edit', [CarrierController::class, 'edit'])->name('carriers.edit');
    Route::patch('carriers/{carrier}', [CarrierController::class, 'update'])->name('carriers.update');
    Route::delete('carriers/{carrier}', [CarrierController::class, 'destroy'])->name('carriers.destroy');

    Route::post('carriers/{carrier}/onboarding/{action}', [CarrierOnboardingController::class, 'transition'])
        ->name('carriers.onboarding.transition');
    Route::post('carriers/{carrier}/verification', [CarrierOnboardingController::class, 'verify'])
        ->name('carriers.verification.run');
    Route::post('carriers/{carrier}/verification/override', [CarrierOnboardingController::class, 'override'])
        ->name('carriers.verification.override');

    /*
    | Clientes
    |
    | Mismo orden que arriba y por lo mismo: `create` antes de `{customer}`.
    */
    Route::get('customers', [CustomerController::class, 'index'])->name('customers.index');
    Route::get('customers/create', [CustomerController::class, 'create'])->name('customers.create');
    Route::post('customers', [CustomerController::class, 'store'])->name('customers.store');
    Route::get('customers/{customer}', [CustomerController::class, 'show'])->name('customers.show');
    Route::get('customers/{customer}/edit', [CustomerController::class, 'edit'])->name('customers.edit');
    Route::patch('customers/{customer}', [CustomerController::class, 'update'])->name('customers.update');
    Route::delete('customers/{customer}', [CustomerController::class, 'destroy'])->name('customers.destroy');
});
