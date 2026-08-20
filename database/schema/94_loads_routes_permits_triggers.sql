-- ============================================================================
-- Goliath Dispatch — Loads / Routes / Permits domain
-- Triggers only.
--
-- No `DELIMITER` directives anywhere in this file: DELIMITER is a `mysql`
-- client command, not SQL, and does not exist over PDO. DB::unprepared()
-- sends this file's contents as-is via PDO::exec()/PDO::query(), which is
-- perfectly able to run a full `CREATE TRIGGER ... BEGIN ... END` block as
-- one statement without any client-side delimiter juggling.
-- ============================================================================

-- ── load_status_history: append-only audit trail ───────────────────────────
-- Rows are never updated or deleted, by design — this is what lets the audit
-- trail distinguish a dispatcher's action from a tracking-provider ingest
-- with confidence, even under a compromised app credential. Same pattern as
-- audit_events (91_tenancy_auth_triggers.sql) and signature_audit_events
-- (92_carriers_documents_signatures_triggers.sql): one explicit
-- before update / before delete pair per table, since MySQL triggers cannot
-- run dynamic SQL the way the single Postgres plpgsql function did.
--
-- Note on the two `carrier_locked_at` / carrier-immutability rule: that rule
-- ("a load's carrier cannot change once assigned; correction requires
-- cancelling or duplicating") is deliberately NOT enforced by a trigger here.
-- It is application logic, not a schema-level invariant — see
-- docs/port-notes-loads-routes-permits.md for the reasoning.

create trigger trg_load_status_history_no_update
before update on load_status_history
for each row
begin
  signal sqlstate '45000'
    set message_text = 'load_status_history is append-only: rows cannot be updated';
end;

create trigger trg_load_status_history_no_delete
before delete on load_status_history
for each row
begin
  signal sqlstate '45000'
    set message_text = 'load_status_history is append-only: rows cannot be deleted';
end;
