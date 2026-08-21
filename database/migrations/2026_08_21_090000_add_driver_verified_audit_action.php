<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Añade `driver.verified` al vocabulario de la pista de auditoría.
 *
 * El vocabulario portado enumera 56 acciones y ninguna cubre «alguien revisó la
 * licencia de un conductor y anotó el resultado». Tiene `verification.override`,
 * que es otra cosa —anular una verificación automática—, y
 * `onboarding.status_changed`, que es de transportistas.
 *
 * No auditarlo no era una opción: revisar la cualificación de un conductor es
 * exactamente el acto por el que pregunta un inspector, y el permiso
 * `driver:approve` existe justo para concederlo. Un acto con permiso propio y
 * sin rastro es un agujero.
 *
 * Se añade con una migración y no tocando `database/schema/01_...sql` a
 * propósito: ese fichero es el registro de lo que se portó, y reescribirlo
 * borraría la diferencia entre «venía así» y «lo añadimos nosotros».
 */
return new class extends Migration
{
    /** Las 56 acciones portadas, más la nueva. */
    private const ACTIONS = [
        'auth.login', 'auth.login_failed', 'auth.logout', 'auth.password_reset_requested',
        'auth.password_reset_completed', 'auth.email_verified', 'auth.mfa_enrolled',
        'auth.mfa_challenge_failed', 'auth.session_revoked', 'auth.account_locked',
        'impersonation.started', 'impersonation.ended', 'permission.changed', 'role.changed',
        'tenant.created', 'tenant.updated', 'tenant.suspended', 'tenant.reactivated',
        'tenant.accessed', 'document.viewed', 'document.downloaded', 'document.uploaded',
        'document.approved', 'document.rejected', 'document.deleted', 'verification.override',
        'onboarding.status_changed', 'load.created', 'load.status_changed',
        'load.assignment_changed', 'load.cancelled', 'load.duplicated', 'financial.changed',
        'expense.approved', 'expense.rejected', 'invoice.created', 'invoice.sent',
        'invoice.status_changed', 'payment.recorded', 'payment.failed', 'payment.refunded',
        'signature.requested', 'signature.viewed', 'signature.signed', 'signature.declined',
        'signature.voided', 'export.created', 'export.downloaded', 'retention.archived',
        'retention.purged', 'legal_hold.applied', 'legal_hold.released', 'settings.updated',
        'integration.updated', 'tracking.consent_changed', 'security.rate_limited',

        // Nueva.
        'driver.verified',
    ];

    public function up(): void
    {
        // MySQL no sabe modificar un CHECK: hay que tirarlo y volver a ponerlo.
        // No es peligroso —no hay datos que puedan violarlo, porque el conjunto
        // solo crece— pero sí lo sería al revés.
        DB::statement('alter table audit_events drop check audit_events_action_chk');

        $list = implode(', ', array_map(
            static fn (string $a): string => "'".$a."'",
            self::ACTIONS,
        ));

        DB::statement("alter table audit_events add constraint audit_events_action_chk check (action in ({$list}))");
    }

    public function down(): void
    {
        // Volver atrás exige que no exista ninguna fila con la acción nueva, y
        // `audit_events` es de solo-añadir: no se pueden borrar. Si las hay,
        // esto falla a la cara en vez de dejar una restricción que la tabla ya
        // no cumple.
        DB::statement('alter table audit_events drop check audit_events_action_chk');

        $list = implode(', ', array_map(
            static fn (string $a): string => "'".$a."'",
            array_filter(self::ACTIONS, static fn (string $a): bool => $a !== 'driver.verified'),
        ));

        DB::statement("alter table audit_events add constraint audit_events_action_chk check (action in ({$list}))");
    }
};
