<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Finance / Messaging / Tracking domain.
 *
 * A thin wrapper around the hand-written SQL files in database/schema/. MySQL
 * has no transactional DDL, so a migration that fails partway leaves the
 * schema in a real, half-applied state — down() genuinely reverses it rather
 * than assuming the up() ran to completion.
 *
 * Tables (05_*), foreign keys (84_*) and triggers (95_*) are split into
 * separate files by design: several foreign keys here point at tables owned
 * by other domains (tenants, users, carriers, factoring_companies,
 * documents, drivers, trucks, loads), so all domains' *_tables.sql files
 * must be applied before any domain's *_foreign_keys.sql file. This
 * migration only ever needs to run its own three files, in order; the fixed
 * numeric ranges (0X for tables, 8X for foreign keys, 9X for triggers) are
 * what let five independently-written domain migrations interleave safely
 * regardless of which Laravel migration batch order they land in.
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
        'trg_financial_snapshots_no_delete',
        'trg_financial_snapshots_guard_update',
        'trg_stripe_events_no_delete',
        'trg_stripe_events_guard_update',
    ];

    /**
     * Tables this domain owns, in dependency order (parents before children)
     * so down() can drop them in reverse order without tripping a foreign
     * key from another still-present child row within this domain (e.g.
     * dispatcher_commissions -> financial_snapshots, invoice_line_items ->
     * invoices, payments -> invoices, payment_attempts -> payments,
     * carrier_settlement_lines -> carrier_settlements,
     * conversation_participants/messages -> conversations,
     * message_attachments -> messages, tracking_events -> tracking_sessions).
     *
     * @var list<string>
     */
    private array $tables = [
        'expense_categories',
        'expenses',
        'financial_snapshots',
        'dispatcher_commissions',
        'invoices',
        'invoice_line_items',
        'payments',
        'payment_attempts',
        'stripe_events',
        'carrier_settlements',
        'carrier_settlement_lines',
        'conversations',
        'conversation_participants',
        'messages',
        'message_attachments',
        'notification_templates',
        'notification_preferences',
        'notifications',
        'integration_connections',
        'tracking_sessions',
        'tracking_events',
        'public_tracking_links',
    ];

    public function up(): void
    {
        DB::unprepared(file_get_contents(database_path('schema/05_finance_messaging_tracking_tables.sql')));
        DB::unprepared(file_get_contents(database_path('schema/84_finance_messaging_tracking_foreign_keys.sql')));
        DB::unprepared(file_get_contents(database_path('schema/95_finance_messaging_tracking_triggers.sql')));
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
        // this domain into itself (e.g. dispatcher_commissions ->
        // financial_snapshots) regardless of how far up() got before failing.
        DB::statement('set foreign_key_checks = 0');
        foreach (array_reverse($this->tables) as $table) {
            DB::unprepared("drop table if exists {$table}");
        }
        DB::statement('set foreign_key_checks = 1');
    }
};
