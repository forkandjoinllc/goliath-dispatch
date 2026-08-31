<?php

declare(strict_types=1);

use App\Http\Controllers\App\DashboardController;
use App\Http\Controllers\App\AssignmentController;
use App\Http\Controllers\App\AuditController;
use App\Http\Controllers\App\CarrierController;
use App\Http\Controllers\App\CarrierOnboardingController;
use App\Http\Controllers\App\CommissionController;
use App\Http\Controllers\App\CustomerController;
use App\Http\Controllers\App\DocumentController;
use App\Http\Controllers\App\DriverController;
use App\Http\Controllers\App\EquipmentController;
use App\Http\Controllers\App\ExpenseController;
use App\Http\Controllers\App\FactoringController;
use App\Http\Controllers\App\InvoiceController;
use App\Http\Controllers\App\LeadController;
use App\Http\Controllers\App\LoadAssignmentController;
use App\Http\Controllers\App\LoadController;
use App\Http\Controllers\App\LocaleController;
use App\Http\Controllers\App\NotificationController;
use App\Http\Controllers\App\PaymentController;
use App\Http\Controllers\Platform\PlanController;
use App\Http\Controllers\Platform\TenantController as PlatformTenantController;
use App\Http\Controllers\App\RateConfirmationController;
use App\Http\Controllers\App\ReportController;
use App\Http\Controllers\App\SettlementController;
use App\Http\Controllers\App\SignatureController;
use App\Http\Controllers\App\TenantSettingController;
use App\Http\Controllers\App\TrackingController;
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
    | Asignaciones de despachador
    |
    | Lo que hace funcionar el ámbito `assigned`: sin una fila aquí, un
    | despachador entra con todos sus permisos y ve las listas vacías.
    |
    | Retirar una asignación le pone fecha de fin en vez de borrarla, así que va
    | por POST y no por DELETE — no se está borrando nada.
    */
    Route::get('assignments', [AssignmentController::class, 'index'])->name('assignments.index');
    Route::post('assignments', [AssignmentController::class, 'store'])->name('assignments.store');
    Route::post('assignments/{assignment}/end', [AssignmentController::class, 'end'])->name('assignments.end');
    Route::post('assignments/commission', [AssignmentController::class, 'commission'])->name('assignments.commission');
    Route::post('assignment-groups', [AssignmentController::class, 'storeGroup'])->name('assignments.groups.store');
    Route::post('assignment-groups/{group}/toggle', [AssignmentController::class, 'toggleGroup'])->name('assignments.groups.toggle');
    Route::post('assignment-groups/{group}/members', [AssignmentController::class, 'addMember'])->name('assignments.groups.members.add');
    Route::delete('assignment-groups/{group}/members/{member}', [AssignmentController::class, 'removeMember'])->name('assignments.groups.members.remove');

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
    /*
    | Ajustes de la empresa
    |
    | La POLÍTICA con la que nacen las cargas y las facturas. Seis sitios leen
    | esta fila en vivo; hasta ahora solo se cambiaba entrando a MySQL.
    */
    /*
    | Informes
    |
    | Salen de lo FACTURADO y de las instantáneas congeladas, nunca de un
    | recálculo: un periodo cerrado tiene que decir siempre lo mismo.
    |
    | La exportación tiene permiso propio y deja rastro: sacar los números a un
    | fichero no es lo mismo que mirarlos en pantalla.
    */
    Route::get('reports', [ReportController::class, 'index'])->name('reports.index');
    Route::get('reports/export', [ReportController::class, 'export'])->name('reports.export');

    Route::get('settings', [TenantSettingController::class, 'edit'])->name('settings.edit');
    Route::patch('settings', [TenantSettingController::class, 'update'])->name('settings.update');

    /*
    | Plataforma
    |
    | Solo el super administrador. Todas las consultas de estos controladores
    | van `withoutTenant()`, que es saltarse el ámbito de empresa a propósito:
    | es el ÚNICO sitio del producto donde eso es lo correcto, y por eso cada
    | acción lleva su permiso `platform:*` delante.
    |
    | Suspender es la acción más grave que existe aquí —deja fuera a una empresa
    | entera— y por eso exige motivo y deja rastro. Que además signifique algo lo
    | hace EnsureTenantActive; sin ese middleware esto sería un cambio de
    | columna decorativo, que es justo lo que era.
    */
    Route::get('platform/tenants', [PlatformTenantController::class, 'index'])->name('platform.tenants.index');
    Route::get('platform/tenants/{tenant}', [PlatformTenantController::class, 'show'])->name('platform.tenants.show');
    Route::post('platform/tenants/{tenant}/suspension', [PlatformTenantController::class, 'suspend'])->name('platform.tenants.suspend');

    Route::get('platform/plans', [PlanController::class, 'index'])->name('platform.plans.index');
    Route::patch('platform/plans/{plan}', [PlanController::class, 'update'])->name('platform.plans.update');

    /*
    | Avisos
    |
    | Sin permiso propio, y no por olvido: un aviso está dirigido a una persona
    | concreta y no hay ningún rol al que le corresponda leer los de otra. La
    | frontera aquí es la identidad, no el permiso.
    |
    | No hay ruta de alta: los avisos los escribe el barrido o un suceso de la
    | aplicación. Uno que alguien pudiera crear a mano no sería un aviso, sería
    | un mensaje — y los mensajes son otro dominio.
    */
    Route::get('notifications', [NotificationController::class, 'index'])->name('notifications.index');
    Route::post('notifications/read-all', [NotificationController::class, 'readAll'])->name('notifications.readAll');
    Route::post('notifications/{notification}/read', [NotificationController::class, 'read'])->name('notifications.read');
    Route::post('notification-preferences', [NotificationController::class, 'savePreferences'])->name('notifications.preferences');

    /*
    | Prospectos
    |
    | Lo escriben tres formularios PÚBLICOS —contacto, presupuesto y alta de
    | transportista— y hasta ahora nadie podía leerlo. `tenant_id` lo pone el
    | dominio por el que entró el formulario, nunca el formulario: por eso aquí
    | no hay ruta de alta. Un prospecto que se pudiera crear a mano desde dentro
    | sería un prospecto sin origen.
    |
    | Tampoco hay ruta de borrado: «perdido» es un estado del embudo y conserva
    | de dónde vino y qué se hizo con él.
    */
    Route::get('leads', [LeadController::class, 'index'])->name('leads.index');
    Route::get('leads/{lead}', [LeadController::class, 'show'])->name('leads.show');
    Route::post('leads/{lead}/status', [LeadController::class, 'updateStatus'])->name('leads.status');
    Route::post('leads/{lead}/assign', [LeadController::class, 'assign'])->name('leads.assign');

    /*
    | Confirmación de tarifa
    |
    | Cuelga de la carga porque es de la carga. Emitir es POST y no PUT: cada
    | emisión crea un documento NUEVO, no una versión del anterior. Una
    | confirmación reemitida con otra tarifa es otro papel, y encadenarlas como
    | versiones haría que una aceptación apuntara a un documento cuyo contenido
    | vigente ya no es el que se aceptó.
    */
    Route::get('loads/{load}/rate-confirmation', [RateConfirmationController::class, 'show'])->name('loads.rateconf.show');
    Route::post('loads/{load}/rate-confirmation', [RateConfirmationController::class, 'issue'])->name('loads.rateconf.issue');
    Route::post('loads/{load}/rate-confirmation/decide', [RateConfirmationController::class, 'decide'])->name('loads.rateconf.decide');

    /*
    | Firmas
    |
    | Las plantillas van por su propia ruta y no bajo una solicitud porque son
    | de la casa, no de ninguna firma en concreto: se publican una vez y las
    | usan todas las solicitudes que vengan después.
    |
    | Publicar una versión es POST a `templates` y no PATCH sobre una plantilla
    | existente, y eso NO es un descuido: publicar escribe una fila nueva. El
    | texto de una versión ya firmada no se puede editar sin invalidar la huella
    | que viaja dentro de cada firma hecha sobre ella.
    |
    | Anular es POST y no DELETE por el mismo motivo que revocar un enlace de
    | rastreo: la solicitud no se borra, se le pone `voided_at` y se queda.
    */
    Route::get('signatures', [SignatureController::class, 'index'])->name('signatures.index');
    Route::get('signatures/templates', [SignatureController::class, 'templates'])->name('signatures.templates');
    Route::post('signatures/templates', [SignatureController::class, 'publishTemplate'])->name('signatures.templates.publish');
    Route::post('signatures/templates/install', [SignatureController::class, 'installTemplates'])->name('signatures.templates.install');
    Route::post('signatures/templates/{templateKey}/retire', [SignatureController::class, 'retireTemplate'])->name('signatures.templates.retire');
    Route::post('signatures/requests', [SignatureController::class, 'store'])->name('signatures.store');
    Route::get('signatures/{signatureRequest}', [SignatureController::class, 'show'])->name('signatures.show');
    Route::get('signatures/{signatureRequest}/certificate', [SignatureController::class, 'certificate'])->name('signatures.certificate');
    Route::post('signatures/{signatureRequest}/void', [SignatureController::class, 'void'])->name('signatures.void');

    /*
    | Seguimiento
    |
    | El tablero cuelga de la raíz porque se mira por sí solo —«qué está
    | rodando ahora»— mientras que todo lo demás cuelga de la carga, que es de
    | quien son las llamadas y los enlaces. Las dos rutas de llamada de control
    | son POST y no PATCH: ninguna modifica una llamada, una la crea y la otra
    | la cierra.
    |
    | Revocar es POST y no DELETE a propósito: el enlace no se borra. Se le
    | pone `revoked_at` y se queda, porque quién repartió qué enlace y hasta
    | cuándo estuvo vivo es justo lo que hay que poder contar después.
    */
    Route::get('tracking', [TrackingController::class, 'board'])->name('tracking.board');
    Route::get('loads/{load}/tracking', [TrackingController::class, 'show'])->name('tracking.show');
    Route::post('loads/{load}/check-calls', [TrackingController::class, 'storeCheckCall'])->name('tracking.checkCalls.store');
    Route::post('loads/{load}/check-calls/{checkCall}/complete', [TrackingController::class, 'completeCheckCall'])->name('tracking.checkCalls.complete');
    Route::post('loads/{load}/tracking-links', [TrackingController::class, 'storeLink'])->name('tracking.links.store');
    Route::post('loads/{load}/tracking-links/{link}/revoke', [TrackingController::class, 'revokeLink'])->name('tracking.links.revoke');

    /*
    | Pista de auditoría
    |
    | Solo lectura, y no por prudencia: `audit_events` tiene dos disparadores
    | que rechazan UPDATE y DELETE. Una ruta de escritura aquí no podría hacer
    | otra cosa que devolver un error de base de datos.
    |
    | No hay ruta de exportación. Sacar la pista a un fichero es una acción con
    | su propio permiso (`report:export`) y su propio rastro, y mezclarla con la
    | de mirar convertiría un permiso de lectura en uno de extracción.
    */
    Route::get('audit', [AuditController::class, 'index'])->name('audit.index');
    Route::get('audit/{event}', [AuditController::class, 'show'])->name('audit.show');

    Route::get('users', [UserController::class, 'index'])->name('users.index');
    Route::post('users', [UserController::class, 'store'])->name('users.invite');
    Route::post('users/{membership}/resend', [UserController::class, 'resend'])->name('users.resend');
    Route::post('users/{membership}/role', [UserController::class, 'updateRole'])->name('users.role');
    Route::post('users/{membership}/suspend', [UserController::class, 'suspend'])->name('users.suspend');
    Route::delete('users/{membership}', [UserController::class, 'destroy'])->name('users.destroy');

    /*
    | Cobros
    |
    | El alta de un cobro vive en la factura (`invoices/{invoice}/payments`),
    | que es donde se anota. Aquí está el LIBRO: lo que entró, por dónde y
    | cuándo, que es con lo que se cuadra contra el banco.
    |
    | No hay ruta para borrar un cobro. Si entró mal se reembolsa o se marca en
    | disputa — las dos cosas que de verdad le pasan al dinero.
    */
    /*
    | Comisiones del despachador
    |
    | Se DEVENGAN solas al facturar (ver CommissionLedger); aquí solo se miran y
    | se marcan pagadas. No hay ruta para crearlas a mano: una comisión que
    | alguien teclea no está respaldada por ninguna instantánea.
    */
    Route::get('commissions', [CommissionController::class, 'index'])->name('commissions.index');
    Route::post('commissions/pay', [CommissionController::class, 'pay'])->name('commissions.pay');

    Route::get('payments', [PaymentController::class, 'index'])->name('payments.index');
    Route::post('payments/{payment}/refund', [PaymentController::class, 'refund'])->name('payments.refund');
    Route::post('payments/{payment}/dispute', [PaymentController::class, 'dispute'])->name('payments.dispute');

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
