<?php

declare(strict_types=1);

use App\Http\Controllers\App\DashboardController;
use App\Http\Controllers\App\CarrierController;
use App\Http\Controllers\App\CarrierOnboardingController;
use App\Http\Controllers\App\CustomerController;
use App\Http\Controllers\App\DocumentController;
use App\Http\Controllers\App\DriverController;
use App\Http\Controllers\App\EquipmentController;
use App\Http\Controllers\App\ExpenseController;
use App\Http\Controllers\App\FactoringController;
use App\Http\Controllers\App\InvoiceController;
use App\Http\Controllers\App\LoadAssignmentController;
use App\Http\Controllers\App\LoadController;
use App\Http\Controllers\App\LocaleController;
use App\Http\Controllers\App\SettlementController;
use App\Http\Controllers\App\UserController;
use App\Http\Controllers\Auth\InvitationController;
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
| Invitaciones
|
| Públicas: quien llega todavía no tiene sesión — es justo lo que viene a
| conseguir. El vale va en la URL porque llega por correo y no hay otro sitio
| donde ponerlo; en la base de datos solo está su sha256.
|
| Con límite porque el `show` es un oráculo: sin él se pueden probar vales a
| ritmo de máquina. Un vale caducado y uno inventado contestan lo mismo, así que
| lo único que queda por cortar es el ritmo.
*/
Route::middleware('throttle:10,60')->group(function (): void {
    Route::get('invitations/{token}', [InvitationController::class, 'show'])->name('invitations.show');
    Route::post('invitations/{token}', [InvitationController::class, 'store'])->name('invitations.accept');
});

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

    /*
    | Facturas
    |
    | Lo que la casa de despacho le cobra al TRANSPORTISTA: la tarifa de
    | despacho. Al cliente lo factura el transportista, no nosotros.
    |
    | Una factura emitida no se edita: se anula con motivo y se hace otra. Por
    | eso no hay `edit` ni `update` aquí — no es un olvido.
    */
    Route::get('invoices', [InvoiceController::class, 'index'])->name('invoices.index');
    Route::get('invoices/create', [InvoiceController::class, 'create'])->name('invoices.create');
    Route::post('invoices', [InvoiceController::class, 'store'])->name('invoices.store');
    Route::get('invoices/{invoice}', [InvoiceController::class, 'show'])->name('invoices.show');
    Route::post('invoices/{invoice}/send', [InvoiceController::class, 'send'])->name('invoices.send');
    Route::post('invoices/{invoice}/payments', [InvoiceController::class, 'pay'])->name('invoices.pay');
    Route::post('invoices/{invoice}/void', [InvoiceController::class, 'void'])->name('invoices.void');

    /*
    | Liquidaciones
    |
    | Lo que se le PAGA al transportista: sus cargas, menos la tarifa de
    | despacho que se le cobra, menos sus descuentos, más lo reembolsable. Las
    | cifras salen de la instantánea congelada, no de un cálculo nuevo.
    |
    | Tampoco hay `edit` ni `update`: una liquidación entregada se anula y se
    | hace otra.
    */
    Route::get('settlements', [SettlementController::class, 'index'])->name('settlements.index');
    Route::get('settlements/create', [SettlementController::class, 'create'])->name('settlements.create');
    Route::post('settlements', [SettlementController::class, 'store'])->name('settlements.store');
    Route::get('settlements/{settlement}', [SettlementController::class, 'show'])->name('settlements.show');
    Route::post('settlements/{settlement}/issue', [SettlementController::class, 'issue'])->name('settlements.issue');
    Route::post('settlements/{settlement}/pay', [SettlementController::class, 'pay'])->name('settlements.pay');
    Route::post('settlements/{settlement}/void', [SettlementController::class, 'void'])->name('settlements.void');

    /*
    | Gastos
    |
    | La mitad que le faltaba al cálculo del dinero: `LoadCalculator` ya buscaba
    | gastos aprobados por tratamiento, pero sin pantalla para darlos de alta los
    | cuatro cubos salían siempre en cero.
    |
    | Presentar y decidir son actos distintos con permisos distintos: un
    | conductor presenta, alguien con `expense:approve` decide.
    */
    Route::get('expenses', [ExpenseController::class, 'index'])->name('expenses.index');
    Route::get('expenses/create', [ExpenseController::class, 'create'])->name('expenses.create');
    Route::post('expenses', [ExpenseController::class, 'store'])->name('expenses.store');
    Route::post('expenses/{expense}/approve', [ExpenseController::class, 'approve'])->name('expenses.approve');
    Route::post('expenses/{expense}/reject', [ExpenseController::class, 'reject'])->name('expenses.reject');
    Route::post('expenses/{expense}/reimburse', [ExpenseController::class, 'reimburse'])->name('expenses.reimburse');

    /*
    | Usuarios de la empresa
    |
    | Lo que se lista son PERTENENCIAS, no cuentas: la misma persona puede
    | trabajar para dos casas de despacho. Por eso `destroy` retira la
    | pertenencia y jamás borra al usuario.
    |
    | Una invitación pendiente es una pertenencia en estado `invited`, así que
    | reenviarla y retirarla van por el id de la pertenencia y no por uno propio.
    */
    Route::get('users', [UserController::class, 'index'])->name('users.index');
    Route::post('users', [UserController::class, 'store'])->name('users.invite');
    Route::post('users/{membership}/resend', [UserController::class, 'resend'])->name('users.resend');
    Route::post('users/{membership}/role', [UserController::class, 'updateRole'])->name('users.role');
    Route::post('users/{membership}/suspend', [UserController::class, 'suspend'])->name('users.suspend');
    Route::delete('users/{membership}', [UserController::class, 'destroy'])->name('users.destroy');

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
