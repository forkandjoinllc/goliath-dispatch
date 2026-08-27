<?php

declare(strict_types=1);

use App\Http\Controllers\App\DashboardController;
use App\Http\Controllers\App\CarrierController;
use App\Http\Controllers\App\CarrierOnboardingController;
use App\Http\Controllers\App\CustomerController;
use App\Http\Controllers\App\DocumentController;
use App\Http\Controllers\App\DriverController;
use App\Http\Controllers\App\EquipmentController;
use App\Http\Controllers\App\FactoringController;
use App\Http\Controllers\App\LoadAssignmentController;
use App\Http\Controllers\App\LoadController;
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

    /*
    | Cargas
    |
    | La transición lleva la acción en la RUTA y no en el cuerpo. Así cada paso
    | tiene su propia URL —/loads/{id}/status/dispatched— y aparece tal cual en
    | el registro del servidor. Con la acción en el cuerpo, el registro solo
    | diría «POST /loads/{id}/status» y averiguar quién despachó qué exigiría
    | cruzar dos fuentes.
    */
    Route::get('loads', [LoadController::class, 'index'])->name('loads.index');
    Route::get('loads/create', [LoadController::class, 'create'])->name('loads.create');
    Route::post('loads', [LoadController::class, 'store'])->name('loads.store');
    Route::get('loads/{load}', [LoadController::class, 'show'])->name('loads.show');
    Route::get('loads/{load}/edit', [LoadController::class, 'edit'])->name('loads.edit');
    Route::patch('loads/{load}', [LoadController::class, 'update'])->name('loads.update');
    Route::post('loads/{load}/status/{action}', [LoadController::class, 'transition'])
        ->name('loads.transition');

    /*
    | Asignación. Permisos propios (load:assign_carrier, load:assign_resources)
    | y reglas propias, así que controlador aparte.
    */
    Route::post('loads/{load}/carrier', [LoadAssignmentController::class, 'carrier'])
        ->name('loads.assign.carrier');
    Route::post('loads/{load}/resources', [LoadAssignmentController::class, 'resource'])
        ->name('loads.assign.resource');
    Route::delete('loads/{load}/resources/{assignment}', [LoadAssignmentController::class, 'unassign'])
        ->name('loads.assign.remove');

    /*
    | Conductores
    */
    Route::get('drivers', [DriverController::class, 'index'])->name('drivers.index');
    Route::get('drivers/create', [DriverController::class, 'create'])->name('drivers.create');
    Route::post('drivers', [DriverController::class, 'store'])->name('drivers.store');
    Route::get('drivers/{driver}', [DriverController::class, 'show'])->name('drivers.show');
    Route::get('drivers/{driver}/edit', [DriverController::class, 'edit'])->name('drivers.edit');
    Route::patch('drivers/{driver}', [DriverController::class, 'update'])->name('drivers.update');
    Route::post('drivers/{driver}/verification', [DriverController::class, 'verify'])
        ->name('drivers.verify');

    /*
    | Equipos: camiones y remolques
    |
    | El tipo va en la URL y está restringido con `whereIn`, así que una ruta
    | inventada no llega siquiera al controlador. El controlador lo comprueba
    | otra vez de todas formas — la ruta puede cambiar y esa comprobación acaba
    | construyendo un nombre de tabla.
    */
    /*
    | Documentos
    |
    | La descarga NO devuelve el fichero: devuelve una redirección a una URL
    | firmada y temporal, y deja constancia de quién la pidió. El fichero vive
    | fuera de public/ y la ruta que lo sirve exige la firma.
    */
    /*
    | Factoring
    |
    | Un directorio, no una pasarela: la plataforma no habla con ninguna API de
    | factoring ni mueve dinero por aquí. Sirve para saber a quién llamar y para
    | qué, y qué transportistas trabajan con quién.
    |
    | `create` va antes de `{factoring}` por lo de siempre.
    */
    Route::get('factoring', [FactoringController::class, 'index'])->name('factoring.index');
    Route::get('factoring/create', [FactoringController::class, 'create'])->name('factoring.create');
    Route::post('factoring', [FactoringController::class, 'store'])->name('factoring.store');
    Route::get('factoring/{factoring}', [FactoringController::class, 'show'])->name('factoring.show');
    Route::get('factoring/{factoring}/edit', [FactoringController::class, 'edit'])->name('factoring.edit');
    Route::patch('factoring/{factoring}', [FactoringController::class, 'update'])->name('factoring.update');
    Route::delete('factoring/{factoring}', [FactoringController::class, 'destroy'])->name('factoring.destroy');

    Route::get('documents', [DocumentController::class, 'index'])->name('documents.index');
    Route::get('documents/upload', [DocumentController::class, 'create'])->name('documents.create');
    Route::post('documents', [DocumentController::class, 'store'])->name('documents.store');
    Route::get('documents/{document}', [DocumentController::class, 'show'])->name('documents.show');
    Route::post('documents/{document}/review', [DocumentController::class, 'review'])->name('documents.review');
    Route::get('documents/{document}/download', [DocumentController::class, 'download'])->name('documents.download');

    Route::prefix('equipment/{type}')
        ->whereIn('type', ['trucks', 'trailers'])
        ->group(function (): void {
            Route::get('/', [EquipmentController::class, 'index'])->name('equipment.index');
            Route::get('create', [EquipmentController::class, 'create'])->name('equipment.create');
            Route::post('/', [EquipmentController::class, 'store'])->name('equipment.store');
            Route::get('{unit}', [EquipmentController::class, 'show'])->name('equipment.show');
            Route::get('{unit}/edit', [EquipmentController::class, 'edit'])->name('equipment.edit');
            Route::patch('{unit}', [EquipmentController::class, 'update'])->name('equipment.update');
            Route::post('{unit}/status', [EquipmentController::class, 'status'])->name('equipment.status');
        });
});

/*
|--------------------------------------------------------------------------
| El fichero de un documento
|--------------------------------------------------------------------------
|
| Fuera del grupo `auth` a propósito, y con `signed`: la firma ES la credencial.
| Es lo que permite que el enlace funcione en una pestaña nueva, en el visor de
| PDF del navegador o en el móvil del conductor sin arrastrar la sesión.
|
| Caduca en minutos (ver LocalDocumentStore::temporaryUrl) y solo se genera
| después de comprobar el permiso y de registrar el acceso. Cuando el
| almacenamiento sea S3, esta ruta deja de usarse: la firmará S3.
|
| Nunca se sirve un fichero por su ruta en disco: la clave llega en base64
| dentro de la firma, así que cambiarla invalida la firma entera.
|
*/
Route::get('documents/file/{key}', [App\Http\Controllers\App\DocumentFileController::class, '__invoke'])
    ->middleware('signed')
    ->name('documents.file');
