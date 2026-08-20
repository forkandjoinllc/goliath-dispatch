-- ────────────────────────────────────────────────────────────────────────────
-- Tenancy & Auth domain — triggers.
--
-- Only `audit_events` is append-only in this domain. The source's other
-- append-only tables (signature_audit_events, load_status_history,
-- financial_snapshots) and the narrower stripe_events guard belong to other
-- engineers' domains and are NOT created here.
--
-- Postgres used one plpgsql function applied in a loop over a table list
-- (drizzle/custom/0001_audit_immutability.sql). MySQL triggers cannot run
-- dynamic SQL, so each guarded table gets its own explicit BEFORE UPDATE /
-- BEFORE DELETE pair; the guarantee is identical, just spelled out per table.
--
-- No DELIMITER directives: this file is executed via DB::unprepared(), which
-- sends it to the server exactly as written over PDO. DELIMITER is a `mysql`
-- CLI-only convention and has no meaning over the wire protocol; the MySQL
-- server parser itself already understands that the semicolons inside a
-- CREATE TRIGGER ... BEGIN ... END body belong to the routine, not to the
-- top-level statement stream.
--
-- MySQL's native `on update current_timestamp(3)` column clause (declared in
-- 01_tenancy_auth_tables.sql) already covers what Postgres needed a
-- goliath_touch_updated_at trigger for, so no equivalent trigger is needed
-- here.
-- ────────────────────────────────────────────────────────────────────────────

create trigger `audit_events_no_update`
before update on `audit_events`
for each row
begin
  signal sqlstate '45000'
    set message_text = 'audit_events is append-only; UPDATE is not permitted';
end;

create trigger `audit_events_no_delete`
before delete on `audit_events`
for each row
begin
  signal sqlstate '45000'
    set message_text = 'audit_events is append-only; DELETE is not permitted';
end;
