<?php

declare(strict_types=1);

use App\Http\Controllers\App\DashboardController;
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
});
