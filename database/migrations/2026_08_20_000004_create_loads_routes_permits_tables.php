<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Loads / Routes / Permits domain.
 *
 * A thin wrapper around the hand-written SQL files in database/schema/. MySQL
 * has no transactional DDL, so a migration that fails partway leaves the
 * schema in a real, half-applied state — down() genuinely reverses it rather
 * than assuming the up() ran to completion.
 *
 * Tables (04_*), foreign keys (83_*) and triggers (94_*) are split into
 * separate files by design: several foreign keys here point at tables owned
 * by other domains (tenants, users, carriers, documents, document_versions,
 * customers, customer_contacts, customer_locations, drivers, trucks,
 * trailers, equipment_types), so all domains' *_tables.sql files must be
 * applied before any domain's *_foreign_keys.sql file. This migration only
 * ever needs to run its own three files, in order; the fixed numeric ranges
 * (0X for tables, 8X for foreign keys, 9X for triggers) are what let five
 * independently-written domain migrations interleave safely regardless of
 * which Laravel migration batch order they land in.
 */
return new class extends Migration
{
    /**
     * Triggers this domain owns, in an order safe for both create (up) and
     * drop (down, reversed).
     *
     * @var list<string>
     */
    private array $triggers = [
        'trg_load_status_history_no_update',
        'trg_load_status_history_no_delete',
    ];

    /**
     * Tables this domain owns, in dependency order (parents before children)
     * so down() can drop them in reverse order without tripping a foreign
     * key from another still-present child row within this domain (e.g.
     * load_documents -> load_stops, oversize_evaluations -> routes).
     *
     * @var list<string>
     */
    private array $tables = [
        'loads',
        'load_stops',
        'load_assignments',
        'load_status_history',
        'load_documents',
        'rate_confirmation_acceptances',
        'check_calls',
        'routes',
        'route_states',
        'oversize_rules',
        'oversize_evaluations',
        'permits',
        'escorts',
    ];

    public function up(): void
    {
        DB::unprepared(file_get_contents(database_path('schema/04_loads_routes_permits_tables.sql')));
        DB::unprepared(file_get_contents(database_path('schema/83_loads_routes_permits_foreign_keys.sql')));
        DB::unprepared(file_get_contents(database_path('schema/94_loads_routes_permits_triggers.sql')));
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
        // this domain into itself (e.g. load_stops -> loads) regardless of
        // how far up() got before failing.
        DB::statement('set foreign_key_checks = 0');
        foreach (array_reverse($this->tables) as $table) {
            DB::unprepared("drop table if exists {$table}");
        }
        DB::statement('set foreign_key_checks = 1');
    }
};
