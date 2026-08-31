<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Añade `equipment.verified`.
 *
 * Verificar una unidad y ANULAR su verificación no son el mismo hecho, y hasta
 * ahora solo existía la segunda (`verification.override`). Usar esa para las dos
 * dejaría la bitácora diciendo que se anuló algo cada vez que alguien confirmó
 * que el VIN estaba en la póliza: mentiría justo en la pantalla que existe para
 * que dentro de un año se pueda saber qué pasó.
 *
 * Como `driver.verified`, `lead.*` y las dos de mensajes: con migración y sin
 * tocar `database/schema/`, que es el registro de lo que se portó.
 */
return new class extends Migration
{
    /** Las anteriores, más la nueva. */
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
        'driver.verified', 'lead.status_changed', 'lead.assigned',

        // Nuevas.
        'message.participant_added', 'message.participant_removed',

        // Nueva del lote 57.
        'equipment.verified',
    ];

    private const NUEVAS = ['equipment.verified'];

    public function up(): void
    {
        // Reanudable: si la restricción ya nombra las acciones nuevas, esta
        // migración ya corrió aunque no se registrara. Un `drop check` a ciegas
        // sobre una restricción que no está es un error fatal, y MySQL no
        // acepta `drop check if exists`.
        if ($this->constraintCovers(self::NUEVAS[0])) {
            return;
        }

        $this->replaceConstraint(self::ACTIONS);
    }

    public function down(): void
    {
        $this->replaceConstraint(array_values(array_filter(
            self::ACTIONS,
            static fn (string $a): bool => ! in_array($a, self::NUEVAS, true),
        )));
    }

    private function constraintCovers(string $accion): bool
    {
        $fila = DB::selectOne(
            'select CHECK_CLAUSE as clause from information_schema.CHECK_CONSTRAINTS
             where CONSTRAINT_SCHEMA = database() and CONSTRAINT_NAME = ?',
            ['audit_events_action_chk'],
        );

        return $fila !== null && str_contains((string) $fila->clause, $accion);
    }

    /** @param  list<string>  $acciones */
    private function replaceConstraint(array $acciones): void
    {
        // MySQL no sabe modificar un CHECK: hay que tirarlo y volver a ponerlo.
        if ($this->constraintExists()) {
            DB::statement('alter table audit_events drop check audit_events_action_chk');
        }

        $lista = implode(', ', array_map(
            static fn (string $a): string => "'".$a."'",
            $acciones,
        ));

        DB::statement("alter table audit_events add constraint audit_events_action_chk check (action in ({$lista}))");
    }

    private function constraintExists(): bool
    {
        return DB::selectOne(
            'select 1 as x from information_schema.CHECK_CONSTRAINTS
             where CONSTRAINT_SCHEMA = database() and CONSTRAINT_NAME = ?',
            ['audit_events_action_chk'],
        ) !== null;
    }
};
