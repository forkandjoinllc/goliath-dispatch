-- ============================================================================
-- Goliath Dispatch — Finance / Messaging / Tracking domain
-- Triggers only.
--
-- Two tables in this domain get a tamper-evident guard, and both follow the
-- same shape already used for signature_records
-- (92_carriers_documents_signatures_triggers.sql): DELETE refused outright,
-- UPDATE refused only when a specific set of protected columns would
-- change, everything else stays freely updatable. Neither is the simpler
-- "fully append-only" pattern used for audit_events/signature_audit_events/
-- load_status_history, because both financial_snapshots and stripe_events
-- have columns that legitimately change after the row is first written
-- (retention columns on financial_snapshots; webhook processing state on
-- stripe_events) — a blanket "no UPDATE ever" trigger would break the
-- archival job and webhook idempotency recording respectively.
--
-- No `DELIMITER` directives anywhere in this file: DELIMITER is a `mysql`
-- client command, not SQL, and does not exist over PDO. DB::unprepared()
-- sends this file's contents as-is via PDO::exec()/PDO::query(), which is
-- perfectly able to run a full `CREATE TRIGGER ... BEGIN ... END` block as
-- one statement without any client-side delimiter juggling.
-- ============================================================================

-- ── financial_snapshots: immutable calculation ledger ──────────────────────
-- This is the ledger that makes historical money reproducible after fee
-- percentages change. DELETE is refused outright. UPDATE is refused only if
-- load_id, version, or any computed money column changes:
-- customer_charge_cents, carrier_gross_rate_cents, commissionable_base_cents,
-- dispatch_fee_amount_cents, net_carrier_settlement_cents,
-- gross_margin_cents, dispatcher_commission_amount_cents. Every other
-- column — notably the retention columns (archived_at, purge_eligible_at,
-- legal_hold) — remains updatable so the archival job can do its work
-- without needing to bypass the guard.

create trigger trg_financial_snapshots_no_delete
before delete on financial_snapshots
for each row
begin
  signal sqlstate '45000'
    set message_text = 'financial_snapshots cannot be deleted: it is the immutable calculation ledger';
end;

create trigger trg_financial_snapshots_guard_update
before update on financial_snapshots
for each row
begin
  if not (old.load_id <=> new.load_id)
     or not (old.version <=> new.version)
     or not (old.customer_charge_cents <=> new.customer_charge_cents)
     or not (old.carrier_gross_rate_cents <=> new.carrier_gross_rate_cents)
     or not (old.commissionable_base_cents <=> new.commissionable_base_cents)
     or not (old.dispatch_fee_amount_cents <=> new.dispatch_fee_amount_cents)
     or not (old.net_carrier_settlement_cents <=> new.net_carrier_settlement_cents)
     or not (old.gross_margin_cents <=> new.gross_margin_cents)
     or not (old.dispatcher_commission_amount_cents <=> new.dispatcher_commission_amount_cents)
  then
    signal sqlstate '45000'
      set message_text = 'financial_snapshots is immutable: load/version/computed money columns cannot change';
  end if;
end;

-- ── stripe_events: tamper-evident webhook ledger ───────────────────────────
-- DELETE is refused outright. UPDATE is refused if stripe_event_id,
-- event_type or payload_digest change — but the processing columns
-- (processing_status, processed_at, attempts, error_message) remain
-- updatable, because that is how webhook idempotency is recorded: a
-- retried delivery advances the same row's processing state rather than
-- inserting a duplicate. stripe_events_event_id_uq
-- (05_finance_messaging_tracking_tables.sql) is the idempotency guarantee
-- itself; this trigger protects the identity of the event once recorded.

create trigger trg_stripe_events_no_delete
before delete on stripe_events
for each row
begin
  signal sqlstate '45000'
    set message_text = 'stripe_events cannot be deleted: it is the webhook idempotency ledger';
end;

create trigger trg_stripe_events_guard_update
before update on stripe_events
for each row
begin
  if not (old.stripe_event_id <=> new.stripe_event_id)
     or not (old.event_type <=> new.event_type)
     or not (old.payload_digest <=> new.payload_digest)
  then
    signal sqlstate '45000'
      set message_text = 'stripe_events is tamper-evident: event id/type/digest cannot change once written';
  end if;
end;
