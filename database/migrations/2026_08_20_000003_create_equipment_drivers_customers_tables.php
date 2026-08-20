<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Equipment / Drivers / Customers domain.
 *
 * A thin wrapper around the hand-written SQL files in database/schema/. MySQL
 * has no transactional DDL, so a migration that fails partway leaves the
 * schema in a real, half-applied state — down() genuinely reverses it rather
 * than assuming the up() ran to completion.
 *
 * Tables (03_*), foreign keys (82_*) and triggers (93_*) are split into
 * separate files by design: several foreign keys here point at tables owned
 * by other domains (tenants, users, carriers, documents, equipment_types),
 * so all domains' *_tables.sql files must be applied before any domain's
 * *_foreign_keys.sql file. This migration only ever needs to run its own
 * three files, in order; the fixed numeric ranges (0X for tables, 8X for
 * foreign keys, 9X for triggers) are what let five independently-written
 * domain migrations interleave safely regardless of which Laravel migration
 * batch order they land in.
 */
return new class extends Migration
{
    /**
     * Triggers this domain owns. None of these ten tables are append-only or
     * tamper-evident in the source; the single trigger here exists only to
     * work around an InnoDB limitation (CASCADE foreign keys are rejected on
     * a column that feeds a generated column in the same table — see
     * 93_equipment_drivers_customers_triggers.sql), not a business rule.
     *
     * @var list<string>
     */
    private array $triggers = [
        'trg_customers_cascade_delete_contacts',
    ];

    /**
     * Tables this domain owns, in dependency order (parents before children)
     * so down() can drop them in reverse order without tripping a foreign
     * key from another still-present child row.
     *
     * @var list<string>
     */
    private array $tables = [
        'trucks',
        'trailers',
        'equipment_media',
        'equipment_verifications',
        'drivers',
        'driver_carrier_relationships',
        'customers',
        'customer_locations',
        'customer_contacts',
        'customer_contact_locations',
    ];

    public function up(): void
    {
        DB::unprepared(file_get_contents(database_path('schema/03_equipment_drivers_customers_tables.sql')));
        DB::unprepared(file_get_contents(database_path('schema/82_equipment_drivers_customers_foreign_keys.sql')));
        DB::unprepared(file_get_contents(database_path('schema/93_equipment_drivers_customers_triggers.sql')));
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
        // this domain into itself (e.g. driver_carrier_relationships ->
        // drivers, customer_contact_locations -> customer_contacts) regardless
        // of how far up() got before failing.
        DB::statement('set foreign_key_checks = 0');
        foreach (array_reverse($this->tables) as $table) {
            DB::unprepared("drop table if exists {$table}");
        }
        DB::statement('set foreign_key_checks = 1');
    }
};
