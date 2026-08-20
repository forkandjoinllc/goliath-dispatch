<?php

declare(strict_types=1);

namespace App\Authorization;

use App\Enums\Role;
use App\Enums\Scope;

/**
 * Qué concede cada rol, y con qué ámbito.
 *
 * Portado de src/lib/permissions/catalog.ts. Un permiso que no aparece en la
 * matriz de un rol simplemente no se concede: la ausencia es la regla, no un
 * descuido. Esto es lo que hace la matriz revisable en un diff.
 */
final class RoleMatrix
{
    /**
     * Deliberadamente estrecho: los datos operativos de una empresa exigen
     * una sesión de soporte explícita (platform:tenant:support_access), que
     * produce un Actor con ámbito de empresa.
     */
    private const PLATFORM_SUPER_ADMIN = [
        'platform:tenant:read' => Scope::Platform,
        'platform:tenant:create' => Scope::Platform,
        'platform:tenant:suspend' => Scope::Platform,
        'platform:tenant:support_access' => Scope::Platform,
        'platform:plan:read' => Scope::Platform,
        'platform:plan:manage' => Scope::Platform,
        'platform:health:read' => Scope::Platform,
        'platform:impersonate' => Scope::Platform,
        'tenant:billing:read' => Scope::Platform,
        'tenant:billing:update' => Scope::Platform,
        'audit:read' => Scope::Platform,
    ];

    private const ADMIN = [
        'tenant:settings:read' => Scope::Tenant,
        'tenant:settings:update' => Scope::Tenant,
        'tenant:user:read' => Scope::Tenant,
        'tenant:user:invite' => Scope::Tenant,
        'tenant:user:update' => Scope::Tenant,
        'tenant:user:suspend' => Scope::Tenant,
        'tenant:impersonate' => Scope::Tenant,
        'tenant:integration:read' => Scope::Tenant,
        'tenant:integration:update' => Scope::Tenant,
        'tenant:billing:read' => Scope::Tenant,
        'tenant:billing:update' => Scope::Tenant,
        'assignment:read' => Scope::Tenant,
        'assignment:manage' => Scope::Tenant,
        'assignment:commission:update' => Scope::Tenant,
        'carrier:read' => Scope::Tenant,
        'carrier:create' => Scope::Tenant,
        'carrier:update' => Scope::Tenant,
        'carrier:delete' => Scope::Tenant,
        'carrier:fee:update' => Scope::Tenant,
        'carrier:onboarding:read' => Scope::Tenant,
        'carrier:onboarding:submit' => Scope::Tenant,
        'carrier:onboarding:review' => Scope::Tenant,
        'carrier:onboarding:approve' => Scope::Tenant,
        'carrier:verification:read' => Scope::Tenant,
        'carrier:verification:run' => Scope::Tenant,
        'carrier:verification:override' => Scope::Tenant,
        'document:read' => Scope::Tenant,
        'document:download' => Scope::Tenant,
        'document:upload' => Scope::Tenant,
        'document:review' => Scope::Tenant,
        'document:delete' => Scope::Tenant,
        'signature:template:read' => Scope::Tenant,
        'signature:template:manage' => Scope::Tenant,
        'signature:request:create' => Scope::Tenant,
        'signature:request:read' => Scope::Tenant,
        'signature:void' => Scope::Tenant,
        'signature:certificate:download' => Scope::Tenant,
        'equipment:read' => Scope::Tenant,
        'equipment:create' => Scope::Tenant,
        'equipment:update' => Scope::Tenant,
        'equipment:status:update' => Scope::Tenant,
        'equipment:verification:override' => Scope::Tenant,
        'equipment:type:manage' => Scope::Tenant,
        'equipment:media:upload' => Scope::Tenant,
        'driver:read' => Scope::Tenant,
        'driver:create' => Scope::Tenant,
        'driver:update' => Scope::Tenant,
        'driver:approve' => Scope::Tenant,
        'customer:read' => Scope::Tenant,
        'customer:create' => Scope::Tenant,
        'customer:update' => Scope::Tenant,
        'customer:duplicate:override' => Scope::Tenant,
        'customer:delete' => Scope::Tenant,
        'load:read' => Scope::Tenant,
        'load:create' => Scope::Tenant,
        'load:update' => Scope::Tenant,
        'load:status:update' => Scope::Tenant,
        'load:cancel' => Scope::Tenant,
        'load:duplicate' => Scope::Tenant,
        'load:assign_resources' => Scope::Tenant,
        'load:assign_carrier' => Scope::Tenant,
        'load:financials:read' => Scope::Tenant,
        'load:financials:update' => Scope::Tenant,
        'load:document:upload' => Scope::Tenant,
        'route:calculate' => Scope::Tenant,
        'oversize:evaluate' => Scope::Tenant,
        'oversize:validate' => Scope::Tenant,
        'oversize:rule:manage' => Scope::Tenant,
        'permit:read' => Scope::Tenant,
        'permit:manage' => Scope::Tenant,
        'permit:approve_ready' => Scope::Tenant,
        'tracking:read' => Scope::Tenant,
        'tracking:manage' => Scope::Tenant,
        'tracking:link:create' => Scope::Tenant,
        'tracking:link:revoke' => Scope::Tenant,
        'message:read' => Scope::Tenant,
        'message:send' => Scope::Tenant,
        'message:template:manage' => Scope::Tenant,
        'notification:preference:update' => Scope::Own,
        'expense:read' => Scope::Tenant,
        'expense:submit' => Scope::Tenant,
        'expense:approve' => Scope::Tenant,
        'expense:category:manage' => Scope::Tenant,
        'finance:read' => Scope::Tenant,
        'finance:update' => Scope::Tenant,
        'invoice:read' => Scope::Tenant,
        'invoice:create' => Scope::Tenant,
        'invoice:send' => Scope::Tenant,
        'invoice:status:update' => Scope::Tenant,
        'payment:record' => Scope::Tenant,
        'payment:refund' => Scope::Tenant,
        'settlement:read' => Scope::Tenant,
        'settlement:manage' => Scope::Tenant,
        'factoring:read' => Scope::Tenant,
        'factoring:manage' => Scope::Tenant,
        'report:read' => Scope::Tenant,
        'report:export' => Scope::Tenant,
        'audit:read' => Scope::Tenant,
        'retention:manage' => Scope::Tenant,
        'legalhold:manage' => Scope::Tenant,
        'lead:read' => Scope::Tenant,
        'lead:update' => Scope::Tenant,
    ];

    /**
     * Solo lectura en operaciones, lectura y escritura en dinero. La ausencia
     * de load:create / load:update / load:assign_* ES la aplicación de "no
     * puede crear ni modificar cargas operativas".
     */
    private const ACCOUNTING = [
        'tenant:settings:read' => Scope::Tenant,
        'tenant:user:read' => Scope::Tenant,
        'tenant:billing:read' => Scope::Tenant,
        'tenant:billing:update' => Scope::Tenant,
        'assignment:read' => Scope::Tenant,
        'carrier:read' => Scope::Tenant,
        'carrier:onboarding:read' => Scope::Tenant,
        'carrier:onboarding:review' => Scope::Tenant,
        'carrier:onboarding:approve' => Scope::Tenant,
        'carrier:verification:read' => Scope::Tenant,
        'carrier:verification:override' => Scope::Tenant,
        'document:read' => Scope::Tenant,
        'document:download' => Scope::Tenant,
        'document:upload' => Scope::Tenant,
        'document:review' => Scope::Tenant,
        'signature:template:read' => Scope::Tenant,
        'signature:request:read' => Scope::Tenant,
        'signature:request:create' => Scope::Tenant,
        'signature:certificate:download' => Scope::Tenant,
        'equipment:read' => Scope::Tenant,
        'equipment:verification:override' => Scope::Tenant,
        'driver:read' => Scope::Tenant,
        'driver:approve' => Scope::Tenant,
        'customer:read' => Scope::Tenant,
        'load:read' => Scope::Tenant,
        'load:financials:read' => Scope::Tenant,
        'load:financials:update' => Scope::Tenant,
        'permit:read' => Scope::Tenant,
        'tracking:read' => Scope::Tenant,
        'message:read' => Scope::Tenant,
        'message:send' => Scope::Tenant,
        'notification:preference:update' => Scope::Own,
        'expense:read' => Scope::Tenant,
        'expense:submit' => Scope::Tenant,
        'expense:approve' => Scope::Tenant,
        'expense:category:manage' => Scope::Tenant,
        'finance:read' => Scope::Tenant,
        'finance:update' => Scope::Tenant,
        'invoice:read' => Scope::Tenant,
        'invoice:create' => Scope::Tenant,
        'invoice:send' => Scope::Tenant,
        'invoice:status:update' => Scope::Tenant,
        'payment:record' => Scope::Tenant,
        'payment:refund' => Scope::Tenant,
        'settlement:read' => Scope::Tenant,
        'settlement:manage' => Scope::Tenant,
        'factoring:read' => Scope::Tenant,
        'factoring:manage' => Scope::Tenant,
        'report:read' => Scope::Tenant,
        'report:export' => Scope::Tenant,
        'audit:read' => Scope::Tenant,
    ];

    /**
     * Ve únicamente lo que tiene asignado. Fíjate en que load:assign_resources
     * no está: se concede en tiempo de ejecución solo si el ajuste de empresa
     * allow_dispatcher_resource_assignment está activo. Ver resolve().
     */
    private const DISPATCHER = [
        'tenant:settings:read' => Scope::Tenant,
        'assignment:read' => Scope::Own,
        'carrier:read' => Scope::Assigned,
        'carrier:update' => Scope::Assigned,
        'carrier:onboarding:read' => Scope::Assigned,
        'carrier:onboarding:submit' => Scope::Assigned,
        'carrier:verification:read' => Scope::Assigned,
        'carrier:verification:run' => Scope::Assigned,
        'document:read' => Scope::Assigned,
        'document:download' => Scope::Assigned,
        'document:upload' => Scope::Assigned,
        'signature:request:read' => Scope::Assigned,
        'signature:request:create' => Scope::Assigned,
        'equipment:read' => Scope::Assigned,
        'equipment:create' => Scope::Assigned,
        'equipment:update' => Scope::Assigned,
        'equipment:media:upload' => Scope::Assigned,
        'driver:read' => Scope::Assigned,
        'driver:create' => Scope::Assigned,
        'driver:update' => Scope::Assigned,
        'driver:approve' => Scope::Assigned,
        'customer:read' => Scope::Tenant,
        'customer:create' => Scope::Tenant,
        'customer:update' => Scope::Tenant,
        'load:read' => Scope::Assigned,
        'load:create' => Scope::Tenant,
        'load:update' => Scope::Assigned,
        'load:status:update' => Scope::Assigned,
        'load:cancel' => Scope::Assigned,
        'load:duplicate' => Scope::Assigned,
        'load:financials:read' => Scope::Assigned,
        'load:document:upload' => Scope::Assigned,
        'route:calculate' => Scope::Assigned,
        'oversize:evaluate' => Scope::Assigned,
        'permit:read' => Scope::Assigned,
        'permit:manage' => Scope::Assigned,
        'tracking:read' => Scope::Assigned,
        'tracking:manage' => Scope::Assigned,
        'tracking:link:create' => Scope::Assigned,
        'tracking:link:revoke' => Scope::Assigned,
        'message:read' => Scope::Assigned,
        'message:send' => Scope::Assigned,
        'notification:preference:update' => Scope::Own,
        'expense:read' => Scope::Assigned,
        'expense:submit' => Scope::Assigned,
        'report:read' => Scope::Assigned,
        'report:export' => Scope::Assigned,
    ];

    private const CARRIER = [
        'carrier:read' => Scope::Carrier,
        'carrier:update' => Scope::Carrier,
        'carrier:onboarding:read' => Scope::Carrier,
        'carrier:onboarding:submit' => Scope::Carrier,
        'carrier:verification:read' => Scope::Carrier,
        'tenant:user:read' => Scope::Carrier,
        'tenant:user:invite' => Scope::Carrier,
        'document:read' => Scope::Carrier,
        'document:download' => Scope::Carrier,
        'document:upload' => Scope::Carrier,
        'signature:request:read' => Scope::Carrier,
        'signature:sign' => Scope::Own,
        'signature:certificate:download' => Scope::Carrier,
        'equipment:read' => Scope::Carrier,
        'equipment:create' => Scope::Carrier,
        'equipment:update' => Scope::Carrier,
        'equipment:media:upload' => Scope::Carrier,
        'driver:read' => Scope::Carrier,
        'driver:create' => Scope::Carrier,
        'driver:update' => Scope::Carrier,
        'driver:approve' => Scope::Carrier,
        'load:read' => Scope::Carrier,
        'load:financials:read' => Scope::Carrier,
        'load:rateconf:respond' => Scope::Carrier,
        'load:document:upload' => Scope::Carrier,
        'permit:read' => Scope::Carrier,
        'tracking:read' => Scope::Carrier,
        'message:read' => Scope::Carrier,
        'message:send' => Scope::Carrier,
        'notification:preference:update' => Scope::Own,
        'expense:read' => Scope::Carrier,
        'expense:submit' => Scope::Carrier,
        'invoice:read' => Scope::Carrier,
        'invoice:pay' => Scope::Carrier,
        'settlement:read' => Scope::Carrier,
        'factoring:read' => Scope::Carrier,
        'report:read' => Scope::Carrier,
    ];

    /**
     * Un conductor nunca cambia el estado de una carga directamente: el
     * permiso sencillamente no existe para él.
     */
    private const DRIVER = [
        'load:read' => Scope::Own,
        'load:document:upload' => Scope::Own,
        'driver:self:update' => Scope::Own,
        'driver:read' => Scope::Own,
        'equipment:read' => Scope::Own,
        'document:read' => Scope::Own,
        'document:download' => Scope::Own,
        'document:upload' => Scope::Own,
        'message:read' => Scope::Own,
        'message:send' => Scope::Own,
        'notification:preference:update' => Scope::Own,
        'tracking:consent' => Scope::Own,
        'tracking:read' => Scope::Own,
        'expense:submit' => Scope::Own,
        'permit:read' => Scope::Own,
    ];

    /** @return array<string, Scope> */
    public static function for(Role $role): array
    {
        return match ($role) {
            Role::PlatformSuperAdmin => self::PLATFORM_SUPER_ADMIN,
            Role::Admin => self::ADMIN,
            Role::Accounting => self::ACCOUNTING,
            Role::Dispatcher => self::DISPATCHER,
            Role::Carrier => self::CARRIER,
            Role::Driver => self::DRIVER,
        };
    }

    /**
     * Concesiones configurables por la empresa.
     *
     * Mantenerlo como una función explícita, en vez de repartir `if ($settings->x)`
     * por el código, deja la excepción visible en un solo sitio y comprobable por
     * separado.
     *
     * @param  array{allow_dispatcher_resource_assignment?: bool}|null  $settings
     * @return array<string, Scope>
     */
    public static function resolve(Role $role, ?array $settings = null): array
    {
        if ($role !== Role::Dispatcher) {
            return self::for($role);
        }

        if (! ($settings['allow_dispatcher_resource_assignment'] ?? false)) {
            return self::DISPATCHER;
        }

        return self::DISPATCHER + ['load:assign_resources' => Scope::Assigned];
    }
}
