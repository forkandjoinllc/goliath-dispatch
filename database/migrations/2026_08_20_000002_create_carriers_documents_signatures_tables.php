<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Carriers / Documents / Signatures domain.
 *
 * A thin wrapper around the hand-written SQL files in database/schema/. MySQL
 * has no transactional DDL, so a migration that fails partway leaves the
 * schema in a real, half-applied state — down() genuinely reverses it rather
 * than assuming the up() ran to completion.
 *
 * Tables (02_*), foreign keys (81_*) and triggers (92_*) are split into
 * separate files by design: several foreign keys here point at tables owned
 * by other domains (tenants, users), so all domains' *_tables.sql files must
 * be applied before any domain's *_foreign_keys.sql file. This migration
 * only ever needs to run its own three files, in order; the fixed numeric
 * ranges (0X for tables, 8X for foreign keys, 9X for triggers) are what let
 * five independently-written domain migrations interleave safely regardless
 * of which Laravel migration batch order they land in.
 */
return new class extends Migration
{
    /**
     * Triggers this domain owns, in an order safe for both create (up) and
     * drop (down, reversed) — table dependency doesn't matter here since
     * triggers attach to a single table each, but listing them once avoids
     * repeating the same names in two places.
     *
     * @var list<string>
     */
    private array $triggers = [
        'trg_signature_audit_events_no_update',
        'trg_signature_audit_events_no_delete',
        'trg_signature_records_no_delete',
        'trg_signature_records_guard_update',
    ];

    /**
     * Tables this domain owns, in dependency order (parents before children)
     * so down() can drop them in reverse order without tripping a foreign
     * key from another still-present child row.
     *
     * @var list<string>
     */
    private array $tables = [
        'carriers',
        'carrier_users',
        'carrier_onboardings',
        'carrier_onboarding_events',
        'dispatcher_profiles',
        'carrier_dispatcher_assignments',
        'dispatcher_groups',
        'group_members',
        'dispatcher_resource_assignments',
        'fmcsa_verifications',
        'factoring_companies',
        'factoring_assignments',
        'documents',
        'document_versions',
        'document_reviews',
        'document_expirations',
        'document_access_logs',
        'signature_templates',
        'signature_requests',
        'signature_records',
        'signature_audit_events',
    ];

    public function up(): void
    {
        DB::unprepared(file_get_contents(database_path('schema/02_carriers_documents_signatures_tables.sql')));
        DB::unprepared(file_get_contents(database_path('schema/81_carriers_documents_signatures_foreign_keys.sql')));
        DB::unprepared(file_get_contents(database_path('schema/92_carriers_documents_signatures_triggers.sql')));
    }

    public function down(): void
    {
        // Triggers first: they reference table/column names that are about
        // to disappear, and DROP TRIGGER is harmless even if a prior run
        // never got this far.
        foreach ($this->triggers as $trigger) {
            DB::unprepared("drop trigger if exists {$trigger}");
        }

        // Foreign keys are dropped implicitly by DROP TABLE, but we still
        // need child tables gone before parent tables to satisfy any FK from
        // this domain into itself (e.g. document_versions -> documents)
        // regardless of how far up() got before failing.
        DB::statement('set foreign_key_checks = 0');
        foreach (array_reverse($this->tables) as $table) {
            DB::unprepared("drop table if exists {$table}");
        }
        DB::statement('set foreign_key_checks = 1');
    }
};
