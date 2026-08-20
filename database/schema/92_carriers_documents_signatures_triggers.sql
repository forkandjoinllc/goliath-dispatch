-- ============================================================================
-- Goliath Dispatch — Carriers / Documents / Signatures domain
-- Triggers only.
--
-- No `DELIMITER` directives anywhere in this file: DELIMITER is a `mysql`
-- client command, not SQL, and does not exist over PDO. DB::unprepared()
-- sends this file's contents as-is via PDO::exec()/PDO::query(), which is
-- perfectly able to run a full `CREATE TRIGGER ... BEGIN ... END` block as
-- one statement without any client-side delimiter juggling.
-- ============================================================================

-- ── signature_audit_events: append-only ceremony log ──────────────────────
-- Rows are never updated or deleted, by design (see signature.ts comment:
-- "Append-only ceremony log. Rows are never updated or deleted."). Enforced
-- here, not just in the application, because the audit trail must survive a
-- bug or a compromised app credential.

create trigger trg_signature_audit_events_no_update
before update on signature_audit_events
for each row
begin
  signal sqlstate '45000'
    set message_text = 'signature_audit_events is append-only: rows cannot be updated';
end;

create trigger trg_signature_audit_events_no_delete
before delete on signature_audit_events
for each row
begin
  signal sqlstate '45000'
    set message_text = 'signature_audit_events is append-only: rows cannot be deleted';
end;

-- ── signature_records: tamper-evident, not fully immutable ────────────────
-- DELETE is refused outright. UPDATE is refused only when a tamper-relevant
-- column would change: integrity_seal, document_sha256, signature_sha256,
-- signer_legal_name, signed_at. Every other column — notably the retention
-- columns (archived_at, purge_eligible_at, legal_hold) — remains updatable so
-- the archival job can do its work without needing to bypass the guard.

create trigger trg_signature_records_no_delete
before delete on signature_records
for each row
begin
  signal sqlstate '45000'
    set message_text = 'signature_records cannot be deleted: it is the tamper-evident signing artifact';
end;

create trigger trg_signature_records_guard_update
before update on signature_records
for each row
begin
  if not (old.integrity_seal <=> new.integrity_seal)
     or not (old.document_sha256 <=> new.document_sha256)
     or not (old.signature_sha256 <=> new.signature_sha256)
     or not (old.signer_legal_name <=> new.signer_legal_name)
     or not (old.signed_at <=> new.signed_at)
  then
    signal sqlstate '45000'
      set message_text = 'signature_records is tamper-evident: seal/hash/signer/signed_at cannot be modified once written';
  end if;
end;
