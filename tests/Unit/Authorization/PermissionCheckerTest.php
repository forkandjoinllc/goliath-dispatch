<?php

declare(strict_types=1);

use App\Authorization\Actor;
use App\Authorization\AssignmentScope;
use App\Authorization\Impersonation;
use App\Authorization\PermissionChecker;
use App\Authorization\PermissionEffect;
use App\Authorization\PermissionOverride;
use App\Authorization\Permissions;
use App\Authorization\ResourceContext;
use App\Authorization\RoleMatrix;
use App\Enums\Locale;
use App\Enums\Role;
use App\Enums\Scope;
use App\Exceptions\AuthorizationException;

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const USER = 'aaaaaaaa-0000-0000-0000-000000000001';
const CARRIER_1 = 'cccccccc-0000-0000-0000-000000000001';
const CARRIER_2 = 'cccccccc-0000-0000-0000-000000000002';

function checker(): PermissionChecker
{
    return new PermissionChecker;
}

function actor(
    ?Role $role = Role::Admin,
    ?string $tenantId = TENANT_A,
    array $overrides = [],
    AssignmentScope $assignments = new AssignmentScope,
    ?string $carrierId = null,
    ?string $driverId = null,
    bool $mfaRequired = false,
    bool $mfaSatisfied = false,
    bool $superAdmin = false,
): Actor {
    return new Actor(
        userId: USER,
        email: 'u@example.test',
        firstName: 'U',
        lastName: 'Ser',
        locale: Locale::En,
        timezone: 'America/New_York',
        isPlatformSuperAdmin: $superAdmin,
        tenantId: $tenantId,
        role: $role,
        carrierId: $carrierId,
        driverId: $driverId,
        assignments: $assignments,
        overrides: $overrides,
        mfaRequired: $mfaRequired,
        mfaSatisfied: $mfaSatisfied,
    );
}

/* ── Lo básico ──────────────────────────────────────────────────────────── */

it('deniega a quien no está autenticado', function () {
    expect(checker()->can(null, 'load:read'))->toBeDeniedWith('errors.unauthenticated');
});

it('rechaza una clave de permiso que no existe en el catálogo', function () {
    checker()->can(actor(), 'load:teleport');
})->throws(InvalidArgumentException::class, 'Permiso desconocido');

it('concede lo que la matriz del rol concede, con su ámbito', function () {
    expect(checker()->can(actor(Role::Admin), 'load:create'))
        ->toBeAllowed()->toHaveScope(Scope::Tenant);
});

it('deniega lo que la matriz del rol no menciona', function () {
    // La ausencia es la regla: accounting no puede crear cargas.
    expect(checker()->can(actor(Role::Accounting), 'load:create'))
        ->toBeDeniedWith('errors.permissionDenied');
});

/* ── Excepciones por usuario ────────────────────────────────────────────── */

it('una denegación explícita gana sobre la concesión del rol', function () {
    $a = actor(Role::Admin, overrides: [
        new PermissionOverride('load:create', PermissionEffect::Deny, Scope::Tenant),
    ]);
    expect(checker()->can($a, 'load:create'))->toBeDeniedWith('errors.permissionDenied');
});

it('una denegación explícita gana incluso sobre un super admin de plataforma', function () {
    $a = actor(Role::PlatformSuperAdmin, tenantId: null, overrides: [
        new PermissionOverride('platform:tenant:read', PermissionEffect::Deny, Scope::Platform),
    ], superAdmin: true);
    expect(checker()->can($a, 'platform:tenant:read'))->toBeDeniedWith('errors.permissionDenied');
});

it('una concesión explícita añade un permiso que el rol no tiene', function () {
    $a = actor(Role::Accounting, overrides: [
        new PermissionOverride('load:create', PermissionEffect::Grant, Scope::Tenant),
    ]);
    expect(checker()->can($a, 'load:create'))->toBeAllowed()->toHaveScope(Scope::Tenant);
});

it('cuando rol y excepción conceden lo mismo, gana el ámbito más ancho', function () {
    $a = actor(Role::Dispatcher, overrides: [
        new PermissionOverride('load:read', PermissionEffect::Grant, Scope::Tenant),
    ]);
    // El rol da 'assigned'; la excepción da 'tenant', que es más ancho.
    expect(checker()->can($a, 'load:read'))->toBeAllowed()->toHaveScope(Scope::Tenant);
});

/* ── La puerta del MFA ──────────────────────────────────────────────────── */

it('bloquea todo cuando el MFA es obligatorio y no se ha satisfecho', function () {
    $a = actor(Role::Admin, mfaRequired: true, mfaSatisfied: false);
    expect(checker()->can($a, 'load:read'))->toBeDeniedWith('errors.mfaRequired');
});

it('deja pasar cuando el MFA está satisfecho', function () {
    $a = actor(Role::Admin, mfaRequired: true, mfaSatisfied: true);
    expect(checker()->can($a, 'load:read'))->toBeAllowed();
});

it('la denegación explícita se evalúa antes del MFA', function () {
    // Importa el orden: una denegación debe ganar aunque el MFA también bloquee,
    // porque el motivo que se registra debe ser el permiso, no el segundo factor.
    $a = actor(Role::Admin, overrides: [
        new PermissionOverride('load:read', PermissionEffect::Deny, Scope::Tenant),
    ], mfaRequired: true, mfaSatisfied: false);
    expect(checker()->can($a, 'load:read'))->toBeDeniedWith('errors.permissionDenied');
});

/* ── La frontera de empresa ─────────────────────────────────────────────── */

it('rechaza un recurso de otra empresa aunque el permiso exista', function () {
    $d = checker()->can(actor(Role::Admin), 'load:read', new ResourceContext(tenantId: TENANT_B));
    expect($d)->toBeDeniedWith('errors.outOfScope');
});

it('acepta un recurso de la propia empresa', function () {
    $d = checker()->can(actor(Role::Admin), 'load:read', new ResourceContext(tenantId: TENANT_A));
    expect($d)->toBeAllowed()->toHaveScope(Scope::Tenant);
});

it('el ámbito de plataforma cruza la frontera de empresa a propósito', function () {
    $a = actor(Role::PlatformSuperAdmin, tenantId: null, superAdmin: true);
    $d = checker()->can($a, 'platform:tenant:read', new ResourceContext(tenantId: TENANT_B));
    expect($d)->toBeAllowed()->toHaveScope(Scope::Platform);
});

/* ── Ámbito 'assigned' ──────────────────────────────────────────────────── */

it('el despachador ve el transportista que tiene asignado', function () {
    $a = actor(Role::Dispatcher, assignments: new AssignmentScope(carrierIds: [CARRIER_1]));
    $d = checker()->can($a, 'carrier:read', new ResourceContext(tenantId: TENANT_A, carrierId: CARRIER_1));
    expect($d)->toBeAllowed()->toHaveScope(Scope::Assigned);
});

it('el despachador no ve un transportista que no tiene asignado', function () {
    $a = actor(Role::Dispatcher, assignments: new AssignmentScope(carrierIds: [CARRIER_1]));
    $d = checker()->can($a, 'carrier:read', new ResourceContext(tenantId: TENANT_A, carrierId: CARRIER_2));
    expect($d)->toBeDeniedWith('errors.outOfScope');
});

it('un recurso sin ningún hecho de ámbito no puede demostrarse asignado', function () {
    $a = actor(Role::Dispatcher, assignments: new AssignmentScope(carrierIds: [CARRIER_1]));
    $d = checker()->can($a, 'carrier:read', new ResourceContext(tenantId: TENANT_A));
    expect($d)->toBeDeniedWith('errors.outOfScope');
});

/* ── Ámbito 'carrier' ───────────────────────────────────────────────────── */

it('el transportista ve lo suyo y nada más', function () {
    $a = actor(Role::Carrier, carrierId: CARRIER_1);
    expect(checker()->can($a, 'load:read', new ResourceContext(tenantId: TENANT_A, carrierId: CARRIER_1)))
        ->toBeAllowed()->toHaveScope(Scope::Carrier);
    expect(checker()->can($a, 'load:read', new ResourceContext(tenantId: TENANT_A, carrierId: CARRIER_2)))
        ->toBeDeniedWith('errors.outOfScope');
});

/* ── Ámbito 'own' ───────────────────────────────────────────────────────── */

it('el conductor ve su propio perfil', function () {
    $a = actor(Role::Driver, driverId: 'dddddddd-0000-0000-0000-000000000001');
    $d = checker()->can($a, 'driver:read', new ResourceContext(
        tenantId: TENANT_A, driverId: 'dddddddd-0000-0000-0000-000000000001',
    ));
    expect($d)->toBeAllowed()->toHaveScope(Scope::Own);
});

it('el conductor no ve el perfil de otro conductor', function () {
    $a = actor(Role::Driver, driverId: 'dddddddd-0000-0000-0000-000000000001');
    $d = checker()->can($a, 'driver:read', new ResourceContext(
        tenantId: TENANT_A, driverId: 'dddddddd-0000-0000-0000-000000000009',
    ));
    expect($d)->toBeDeniedWith('errors.outOfScope');
});

/* ── Reglas del negocio expresadas como ausencias ───────────────────────── */

it('accounting no puede crear ni modificar cargas operativas', function () {
    $a = actor(Role::Accounting);
    foreach (['load:create', 'load:update', 'load:assign_resources', 'load:assign_carrier'] as $p) {
        expect(checker()->can($a, $p))->toBeDeniedWith('errors.permissionDenied');
    }
});

it('accounting sí puede con el dinero', function () {
    $a = actor(Role::Accounting);
    foreach (['finance:update', 'invoice:create', 'payment:refund', 'settlement:manage'] as $p) {
        expect(checker()->can($a, $p))->toBeAllowed();
    }
});

it('el conductor nunca cambia el estado de una carga', function () {
    expect(checker()->can(actor(Role::Driver), 'load:status:update'))
        ->toBeDeniedWith('errors.permissionDenied');
});

it('el transportista no puede fijar su propia comisión de despacho', function () {
    expect(checker()->can(actor(Role::Carrier, carrierId: CARRIER_1), 'carrier:fee:update'))
        ->toBeDeniedWith('errors.permissionDenied');
});

it('el super admin de plataforma no llega a los datos operativos sin sesión de soporte', function () {
    $a = actor(Role::PlatformSuperAdmin, tenantId: null, superAdmin: true);
    foreach (['load:read', 'carrier:read', 'document:download', 'invoice:read'] as $p) {
        expect(checker()->can($a, $p))->toBeDeniedWith('errors.permissionDenied');
    }
});

/* ── La excepción configurable por empresa ──────────────────────────────── */

it('el despachador no asigna recursos si la empresa no lo permite', function () {
    $a = actor(Role::Dispatcher, assignments: new AssignmentScope(carrierIds: [CARRIER_1]));
    expect(checker()->can($a, 'load:assign_resources', null, ['allow_dispatcher_resource_assignment' => false]))
        ->toBeDeniedWith('errors.permissionDenied');
    expect(checker()->can($a, 'load:assign_resources', null, null))
        ->toBeDeniedWith('errors.permissionDenied');
});

it('el despachador asigna recursos si la empresa lo activa, con ámbito assigned', function () {
    $a = actor(Role::Dispatcher, assignments: new AssignmentScope(carrierIds: [CARRIER_1]));
    expect(checker()->can($a, 'load:assign_resources', null, ['allow_dispatcher_resource_assignment' => true]))
        ->toBeAllowed()->toHaveScope(Scope::Assigned);
});

it('el ajuste de empresa no afecta a ningún otro rol', function () {
    $policy = ['allow_dispatcher_resource_assignment' => true];
    expect(checker()->can(actor(Role::Driver), 'load:assign_resources', null, $policy))
        ->toBeDeniedWith('errors.permissionDenied');
    expect(checker()->can(actor(Role::Carrier, carrierId: CARRIER_1), 'load:assign_resources', null, $policy))
        ->toBeDeniedWith('errors.permissionDenied');
});

/* ── authorize() y canAny() ─────────────────────────────────────────────── */

it('authorize devuelve el ámbito cuando permite', function () {
    expect(checker()->authorize(actor(Role::Admin), 'load:read'))->toBe(Scope::Tenant);
});

it('authorize lanza 401 sin actor y 403 con actor', function () {
    expect(fn () => checker()->authorize(null, 'load:read'))
        ->toThrow(AuthorizationException::class);
    try {
        checker()->authorize(null, 'load:read');
    } catch (AuthorizationException $e) {
        expect($e->status)->toBe(401);
    }
    try {
        checker()->authorize(actor(Role::Driver), 'load:status:update');
    } catch (AuthorizationException $e) {
        expect($e->status)->toBe(403);
        expect($e->permission)->toBe('load:status:update');
    }
});

it('canAny basta con uno', function () {
    $a = actor(Role::Driver);
    expect(checker()->canAny($a, ['load:status:update', 'load:read']))->toBeTrue();
    expect(checker()->canAny($a, ['load:status:update', 'invoice:create']))->toBeFalse();
});

/* ── Integridad del catálogo ────────────────────────────────────────────── */

it('toda clave de la matriz existe en el catálogo', function () {
    foreach (Role::cases() as $role) {
        foreach (array_keys(RoleMatrix::for($role)) as $key) {
            expect(Permissions::exists($key))->toBeTrue("{$role->value} concede {$key}, que no está en el catálogo");
        }
    }
});

it('todo permiso del catálogo lo concede al menos un rol', function () {
    $granted = [];
    foreach (Role::cases() as $role) {
        $granted += RoleMatrix::for($role);
    }
    // Un permiso que nadie tiene es código muerto o un agujero.
    $orphans = array_diff(Permissions::keys(), array_keys($granted));
    expect($orphans)->toBe([], 'Permisos que ningún rol concede: '.implode(', ', $orphans));
});

it('las claves siguen el formato recurso:accion', function () {
    foreach (Permissions::keys() as $key) {
        expect($key)->toMatch('/^[a-z][a-z_]*(:[a-z][a-z_]*){1,2}$/');
        $parts = Permissions::parts($key);
        expect($parts['resource'])->not->toBeEmpty();
        expect($parts['action'])->not->toBeEmpty();
    }
});

/* ── Suplantación ───────────────────────────────────────────────────────── */

it('la auditoría atribuye la acción a quien está realmente a los mandos', function () {
    $impersonated = new Actor(
        userId: 'victim-0000-0000-0000-000000000001',
        email: 'v@example.test', firstName: 'V', lastName: 'Ictim',
        locale: Locale::En, timezone: 'America/New_York', isPlatformSuperAdmin: false,
        tenantId: TENANT_A, role: Role::Dispatcher,
        impersonation: new Impersonation(USER, 'sess-1', 'ticket #42'),
    );
    expect($impersonated->auditUserId())->toBe(USER);
    expect($impersonated->userId)->toBe('victim-0000-0000-0000-000000000001');
    expect($impersonated->isImpersonating())->toBeTrue();
});
