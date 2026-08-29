<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Añade `lead.status_changed` y `lead.assigned` al vocabulario de la pista.
 *
 * El permiso `lead:update` se describe a sí mismo como «cambiar el estado y la
 * asignación de un prospecto». Hasta ahora ninguna pantalla ejercía ese
 * permiso, así que la falta de rastro no se notaba. Al construir la pantalla sí
 * se nota: mover un prospecto a «perdido» o pasárselo a otro comercial es
 * exactamente la clase de acto sobre el que después alguien pregunta «¿quién
 * hizo esto?», y las 57 acciones portadas no tienen ninguna que lo cubra.
 *
 * Como la de `driver.verified`, se hace con una migración y no reescribiendo
 * `database/schema/`: ese fichero es el registro de lo que se portó, y tocarlo
 * borraría la diferencia entre «venía así» y «lo añadimos nosotros».
 */
return new class extends Migration
{
    /** Las 57 anteriores, más las dos nuevas. */
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
        'driver.verified',

        // Nuevas.
        'lead.status_changed', 'lead.assigned',
    ];

    private const NUEVAS = ['lead.status_changed', 'lead.assigned'];

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
        // Volver atrás exige que no quede ninguna fila con las acciones nuevas,
        // y `audit_events` es de solo-añadir: no se pueden borrar. Si las hay,
        // esto falla a la cara en vez de dejar una restricción que la tabla ya
        // no cumple.
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
