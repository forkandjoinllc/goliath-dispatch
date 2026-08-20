<?php

declare(strict_types=1);

namespace App\Authorization;

/**
 * El catálogo de permisos.
 *
 * Portado de src/lib/permissions/catalog.ts. Junto con RoleMatrix es la única
 * declaración autorizada de quién puede hacer qué. El seed lo copia a las tablas
 * `permissions` y `role_permissions` para poder consultarlo con SQL, pero la
 * comprobación en tiempo de ejecución lee de aquí: una sola fuente, sin deriva.
 *
 * Las claves son `recurso:accion` o `recurso:sub:accion`. No las inventes al
 * vuelo — PermissionChecker rechaza cualquier clave que no esté en esta lista,
 * de modo que una errata falla en las pruebas y no en producción.
 */
final class Permissions
{
    /** @var array<string, string> clave => descripción en inglés */
    public const ALL = [
        /* ── Platform ────────────────────────────────────────────────────── */
        'platform:tenant:read' => 'View any tenant on the platform',
        'platform:tenant:create' => 'Create a tenant',
        'platform:tenant:suspend' => 'Suspend or reactivate a tenant',
        'platform:tenant:support_access' => 'Open an explicit support-access session into a tenant',
        'platform:plan:read' => 'View SaaS plans and subscription status',
        'platform:plan:manage' => 'Create and edit SaaS plans',
        'platform:health:read' => 'View platform health and usage',
        'platform:impersonate' => 'Impersonate a tenant user',

        /* ── Tenant administration ───────────────────────────────────────── */
        'tenant:settings:read' => 'View tenant settings',
        'tenant:settings:update' => 'Change tenant settings, branding and templates',
        'tenant:user:read' => 'View users in the tenant',
        'tenant:user:invite' => 'Invite a user',
        'tenant:user:update' => 'Edit a user, role or status',
        'tenant:user:suspend' => 'Suspend or reactivate a user',
        'tenant:impersonate' => 'Impersonate a user inside the tenant',
        'tenant:integration:read' => 'View integration connections',
        'tenant:integration:update' => 'Configure integration credentials',
        'tenant:billing:read' => 'View the tenant subscription and invoices from the platform',
        'tenant:billing:update' => 'Change the tenant subscription',

        /* ── Assignments ─────────────────────────────────────────────────── */
        'assignment:read' => 'View dispatcher assignments and groups',
        'assignment:manage' => 'Assign carriers, equipment, drivers and groups to dispatchers',
        'assignment:commission:update' => 'Set dispatcher commission percentages',

        /* ── Carriers & onboarding ───────────────────────────────────────── */
        'carrier:read' => 'View carriers',
        'carrier:create' => 'Create a carrier',
        'carrier:update' => 'Edit carrier company data',
        'carrier:delete' => 'Soft-delete a carrier',
        'carrier:fee:update' => 'Set the carrier dispatch fee percentage',
        'carrier:onboarding:read' => 'View onboarding status and checklist',
        'carrier:onboarding:submit' => 'Submit onboarding for review',
        'carrier:onboarding:review' => 'Move onboarding through review states',
        'carrier:onboarding:approve' => 'Approve or reject carrier onboarding',
        'carrier:verification:read' => 'View FMCSA verification results',
        'carrier:verification:run' => 'Trigger an FMCSA verification',
        'carrier:verification:override' => 'Manually override a failed verification with a reason',

        /* ── Documents ───────────────────────────────────────────────────── */
        'document:read' => 'View document metadata',
        'document:download' => 'Download the document file',
        'document:upload' => 'Upload a document or a new version',
        'document:review' => 'Approve or reject a document',
        'document:delete' => 'Soft-delete a document',

        /* ── Signatures ──────────────────────────────────────────────────── */
        'signature:template:read' => 'View signature templates',
        'signature:template:manage' => 'Create and version signature templates',
        'signature:request:create' => 'Send a signature request',
        'signature:request:read' => 'View signature requests and their status',
        'signature:sign' => 'Sign a document addressed to you',
        'signature:void' => 'Void a signature request',
        'signature:certificate:download' => 'Download the audit certificate',

        /* ── Equipment ───────────────────────────────────────────────────── */
        'equipment:read' => 'View trucks and trailers',
        'equipment:create' => 'Add a truck or trailer',
        'equipment:update' => 'Edit a truck or trailer',
        'equipment:status:update' => 'Change equipment status (active / out of service)',
        'equipment:verification:override' => 'Approve equipment despite a COI/VIN mismatch',
        'equipment:type:manage' => 'Add or edit trailer and equipment types',
        'equipment:media:upload' => 'Upload equipment photos and video',

        /* ── Drivers ─────────────────────────────────────────────────────── */
        'driver:read' => 'View drivers',
        'driver:create' => 'Add a driver',
        'driver:update' => 'Edit a driver',
        'driver:approve' => 'Approve a driver after licence review',
        'driver:self:update' => 'Edit your own driver profile and documents',

        /* ── Customers ───────────────────────────────────────────────────── */
        'customer:read' => 'View customers and contacts',
        'customer:create' => 'Create a customer',
        'customer:update' => 'Edit a customer or contact',
        'customer:duplicate:override' => 'Create a customer despite a duplicate warning',
        'customer:delete' => 'Soft-delete a customer',

        /* ── Loads ───────────────────────────────────────────────────────── */
        'load:read' => 'View loads',
        'load:create' => 'Create a load',
        'load:update' => 'Edit load details',
        'load:status:update' => 'Change a load status',
        'load:cancel' => 'Cancel a load',
        'load:duplicate' => 'Duplicate a load',
        'load:assign_resources' => 'Assign trucks, trailers and drivers to a load',
        'load:assign_carrier' => 'Assign the carrier to a load',
        'load:financials:read' => 'View load financial figures',
        'load:financials:update' => 'Edit load rates and fee percentages',
        'load:rateconf:respond' => 'Accept, reject or request changes to a rate confirmation',
        'load:document:upload' => 'Upload load documents (BOL, POD, receipts)',

        /* ── Routes, oversize, permits ───────────────────────────────────── */
        'route:calculate' => 'Calculate or recalculate a route',
        'oversize:evaluate' => 'Run an oversize / overweight evaluation',
        'oversize:validate' => 'Sign off on an oversize evaluation',
        'oversize:rule:manage' => 'Edit state oversize rules',
        'permit:read' => 'View permits and escorts',
        'permit:manage' => 'Create and edit permits and escorts',
        'permit:approve_ready' => 'Approve a load as permit-ready for dispatch',

        /* ── Tracking ────────────────────────────────────────────────────── */
        'tracking:read' => 'View tracking sessions and location history',
        'tracking:manage' => 'Start, stop and reconfigure tracking for a load',
        'tracking:consent' => 'Grant or revoke tracking consent for yourself',
        'tracking:link:create' => 'Create a public customer tracking link',
        'tracking:link:revoke' => 'Revoke a public tracking link',

        /* ── Messaging ───────────────────────────────────────────────────── */
        'message:read' => 'Read conversations you participate in',
        'message:send' => 'Send messages',
        'message:template:manage' => 'Manage message, email and SMS templates',
        'notification:preference:update' => 'Change your notification preferences',

        /* ── Financials ──────────────────────────────────────────────────── */
        'expense:read' => 'View expenses',
        'expense:submit' => 'Submit an expense and receipt',
        'expense:approve' => 'Approve or reject an expense',
        'expense:category:manage' => 'Manage expense categories and their treatment',
        'finance:read' => 'View financial records and margins',
        'finance:update' => 'Edit financial records',
        'invoice:read' => 'View invoices',
        'invoice:create' => 'Create or regenerate an invoice',
        'invoice:send' => 'Send an invoice',
        'invoice:status:update' => 'Change invoice status, void or write off',
        'invoice:pay' => 'Pay an invoice',
        'payment:record' => 'Record a manual payment',
        'payment:refund' => 'Refund a payment',
        'settlement:read' => 'View carrier settlements',
        'settlement:manage' => 'Create and issue carrier settlements',
        'factoring:read' => 'View factoring records',
        'factoring:manage' => 'Manage factoring companies and assignments',

        /* ── Reporting ───────────────────────────────────────────────────── */
        'report:read' => 'View reports and dashboards',
        'report:export' => 'Export a report',

        /* ── Audit, retention, leads ─────────────────────────────────────── */
        'audit:read' => 'View the audit trail',
        'retention:manage' => 'Run retention and archival actions',
        'legalhold:manage' => 'Apply and release legal holds',
        'lead:read' => 'View marketing leads and quote requests',
        'lead:update' => 'Update lead status and assignment',
    ];

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::ALL);
    }

    public static function exists(string $key): bool
    {
        return isset(self::ALL[$key]);
    }

    public static function describe(string $key): string
    {
        return self::ALL[$key] ?? throw new \InvalidArgumentException("Permiso desconocido: {$key}");
    }

    /** @return array{resource: string, action: string} */
    public static function parts(string $key): array
    {
        $segments = explode(':', $key);

        return ['resource' => $segments[0], 'action' => implode(':', array_slice($segments, 1))];
    }
}
