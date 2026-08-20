<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Executes the tenancy & auth domain's SQL files in the fixed,
     * cross-domain order: all tables (01-05), then all foreign keys (80-84),
     * then all triggers (91-95). DB::unprepared() sends each file to the
     * server as-is over PDO, which is why those files contain no DELIMITER
     * directives — DELIMITER is a `mysql` CLI-only convention.
     */
    public function up(): void
    {
        foreach (['01_tenancy_auth_tables', '80_tenancy_auth_foreign_keys', '91_tenancy_auth_triggers'] as $file) {
            DB::unprepared(file_get_contents(database_path("schema/{$file}.sql")));
        }
    }

    /**
     * MySQL has no transactional DDL, so a migration that fails partway
     * through leaves a real, half-applied schema. down() must be able to
     * clean up from any of those partial states, not just from a fully
     * applied one — so triggers and tables are dropped defensively
     * (IF EXISTS) rather than assuming everything in up() actually landed.
     *
     * Tables are dropped in reverse dependency order (children before the
     * parents their foreign keys point at) so this works even though the
     * foreign keys themselves may already be gone.
     */
    public function down(): void
    {
        DB::unprepared('drop trigger if exists `audit_events_no_update`;');
        DB::unprepared('drop trigger if exists `audit_events_no_delete`;');

        $tablesInDropOrder = [
            // Children first...
            'impersonation_sessions',
            'quote_requests',
            'sessions',
            'verification_tokens',
            'consent_records',
            'user_permission_overrides',
            'user_tenant_memberships',
            'role_permissions',
            'mfa_configurations',
            'leads',
            'audit_events',
            'export_jobs',
            'legal_holds',
            'retention_jobs',
            'job_queue',
            'idempotency_keys',
            'tenant_subscriptions',
            'equipment_types',
            'tenant_settings',
            'tenant_branding',
            'permissions',
            'saas_plans',
            'login_attempts',
            'rate_limit_buckets',
            // ...then the two root tables everything else points at.
            'users',
            'tenants',
        ];

        foreach ($tablesInDropOrder as $table) {
            DB::unprepared("drop table if exists `{$table}`;");
        }
    }
};
