<?php

declare(strict_types=1);

use App\Authorization\Actor;
use App\Authorization\AssignmentScope;
use App\Authorization\PermissionChecker;
use App\Enums\Locale;
use App\Enums\Role;
use App\Support\Navigation;

/*
| Sin base de datos: Navigation solo necesita un Actor y el comprobador de
| permisos, que son puros. Que se pueda probar así es la prueba de que el menú
| se decide donde debe.
|
| ADVERTENCIA: escritas sin poder ejecutarse (ver CarrierAccessTest). Los
| recuentos que afirman se observaron en la aplicación en marcha, entrando con
| cada uno de los seis roles de demostración.
*/

function navFor(Role $role, bool $superAdmin = false, ?string $tenantId = 'tenant-1'): array
{
    $actor = new Actor(
        userId: 'user-1',
        email: 'u@example.test',
        firstName: 'U',
        lastName: 'Ser',
        locale: Locale::Es,
        timezone: 'America/Chicago',
        isPlatformSuperAdmin: $superAdmin,
        tenantId: $tenantId,
        role: $role,
        assignments: new AssignmentScope,
    );

    return Navigation::for($actor, new PermissionChecker);
}

/** Todas las rutas del menú, aplanadas. */
function navHrefs(array $groups): array
{
    return collect($groups)->flatMap(fn (array $g) => collect($g['items'])->pluck('href'))->all();
}

it('el conductor no ve nada de finanzas salvo sus gastos', function () {
    $hrefs = navHrefs(navFor(Role::Driver));

    expect($hrefs)->toContain('/expenses')
        ->and($hrefs)->not->toContain('/invoices')
        ->and($hrefs)->not->toContain('/settlements')
        ->and($hrefs)->not->toContain('/factoring');
});

it('el conductor no ve nada de administración', function () {
    // Un grupo sin entradas visibles no se pinta: una cabecera «Administración»
    // vacía dice que existe algo que no se puede tocar.
    $groups = collect(navFor(Role::Driver))->pluck('key')->all();

    expect($groups)->not->toContain('administration')
        ->and($groups)->not->toContain('platform');
});

it('el transportista no ve clientes', function () {
    // Los clientes de la empresa de despacho no son asunto del transportista:
    // saber con quién trabaja su despachador es información comercial.
    expect(navHrefs(navFor(Role::Carrier)))->not->toContain('/customers');
});

it('el super admin de plataforma no ve datos operativos', function () {
    $hrefs = navHrefs(navFor(Role::PlatformSuperAdmin, superAdmin: true, tenantId: null));

    expect($hrefs)->toContain('/platform/tenants')
        ->and($hrefs)->not->toContain('/loads')
        ->and($hrefs)->not->toContain('/carriers')
        ->and($hrefs)->not->toContain('/customers');
});

it('el admin ve todos los grupos de la empresa pero ninguno de plataforma', function () {
    $groups = collect(navFor(Role::Admin))->pluck('key')->all();

    expect($groups)->toContain('operations', 'compliance', 'finance', 'insight', 'administration')
        ->and($groups)->not->toContain('platform');
});

it('cada entrada declara si su pantalla existe', function () {
    $items = collect(navFor(Role::Admin))->flatMap(fn (array $g) => $g['items']);

    // `ready` distingue lo construido de lo que todavía no. Enseñar la entrada
    // apagada es más honesto que ocultarla y más honesto que enlazarla.
    $ready = $items->where('ready', true)->pluck('href')->all();

    expect($ready)->toContain('/carriers', '/customers');

    // Y aquí llegó el día. Esta línea decía «que sigan existiendo entradas
    // apagadas», y ya no queda ninguna: con los mensajes construidos, el menú
    // del administrador está entero. La versión anterior nombraba '/loads' como
    // pendiente y se rompió sola cuando se construyó — clavar una ruta concreta
    // caduca por diseño, y clavar «hay pendientes» caduca también, solo que más
    // tarde.
    //
    // Lo que queda vigilado es lo que de verdad importa: que nadie añada una
    // entrada al menú sin decidir si está construida. Si esto falla nombrando
    // una entrada nueva, hay dos salidas honestas — construir la pantalla, o
    // dejarla apagada A PROPÓSITO y cambiar esta expectativa diciendo por qué.
    $apagadas = $items->where('ready', false)->pluck('href')->all();

    expect($apagadas)->toBe([], implode("\n", [
        'Entradas del menú sin pantalla: '.implode(', ', $apagadas),
        'O se construye, o se añade a Navigation::BUILT, o se cambia esta prueba con el motivo.',
    ]));
});

it('el transportista no ve el directorio de factoring', function () {
    // `factoring:read` SÍ se le concede al rol transportista, con alcance
    // Carrier, para que pueda ver SU asignación. Lo que no debe pasar es que el
    // menú le ponga un enlace al directorio de la casa de despacho: el
    // controlador solo puede contestarle con un 403, y un enlace que no lleva a
    // ningún sitio es peor que un enlace ausente.
    expect(navHrefs(navFor(Role::Carrier)))->not->toContain('/factoring');
});

it('administración y contabilidad sí lo ven', function () {
    expect(navHrefs(navFor(Role::Admin)))->toContain('/factoring')
        ->and(navHrefs(navFor(Role::Accounting)))->toContain('/factoring');
});
