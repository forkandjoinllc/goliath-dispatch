-- ────────────────────────────────────────────────────────────────────────────
-- Immutability guarantees that Drizzle's schema DSL cannot express.
-- Every statement is idempotent so the file can be re-applied safely.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Append-only tables: reject UPDATE and DELETE at the database level, so a
--    bug (or a compromised application role) cannot rewrite history.
create or replace function goliath_reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Table % is append-only; % is not permitted', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

do $$
declare
  t text;
  append_only text[] := array[
    'audit_events',
    'signature_audit_events',
    'load_status_history',
    'financial_snapshots',
    'stripe_events'
  ];
begin
  foreach t in array append_only loop
    execute format('drop trigger if exists %I_append_only on %I', t, t);
    execute format(
      'create trigger %I_append_only before update or delete on %I
         for each row execute function goliath_reject_mutation()', t, t);
  end loop;
end;
$$;

-- stripe_events must still be markable as processed: allow UPDATE of the
-- processing columns only, by replacing its trigger with a narrower guard.
drop trigger if exists stripe_events_append_only on stripe_events;

create or replace function goliath_stripe_event_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'stripe_events rows may not be deleted'
      using errcode = 'restrict_violation';
  end if;
  if new.stripe_event_id is distinct from old.stripe_event_id
     or new.event_type is distinct from old.event_type
     or new.payload_digest is distinct from old.payload_digest then
    raise exception 'stripe_events identity columns are immutable'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists stripe_events_guard on stripe_events;
create trigger stripe_events_guard before update or delete on stripe_events
  for each row execute function goliath_stripe_event_guard();

-- financial_snapshots are versioned, never edited: keep the strict guard but
-- allow the retention columns to be maintained by the archival job.
drop trigger if exists financial_snapshots_append_only on financial_snapshots;

create or replace function goliath_financial_snapshot_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'financial_snapshots rows may not be deleted'
      using errcode = 'restrict_violation';
  end if;
  if new.load_id is distinct from old.load_id
     or new.version is distinct from old.version
     or new.customer_charge_cents is distinct from old.customer_charge_cents
     or new.carrier_gross_rate_cents is distinct from old.carrier_gross_rate_cents
     or new.commissionable_base_cents is distinct from old.commissionable_base_cents
     or new.dispatch_fee_amount_cents is distinct from old.dispatch_fee_amount_cents
     or new.net_carrier_settlement_cents is distinct from old.net_carrier_settlement_cents
     or new.gross_margin_cents is distinct from old.gross_margin_cents
     or new.dispatcher_commission_amount_cents is distinct from old.dispatcher_commission_amount_cents
  then
    raise exception 'financial_snapshots are immutable; write a new version instead'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists financial_snapshots_guard on financial_snapshots;
create trigger financial_snapshots_guard before update or delete on financial_snapshots
  for each row execute function goliath_financial_snapshot_guard();

-- signature_records: the sealed artifact may never be altered.
create or replace function goliath_signature_record_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'signature_records may not be deleted'
      using errcode = 'restrict_violation';
  end if;
  if new.integrity_seal is distinct from old.integrity_seal
     or new.document_sha256 is distinct from old.document_sha256
     or new.signature_sha256 is distinct from old.signature_sha256
     or new.signer_legal_name is distinct from old.signer_legal_name
     or new.signed_at is distinct from old.signed_at then
    raise exception 'signature_records are tamper-evident and immutable'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists signature_records_guard on signature_records;
create trigger signature_records_guard before update or delete on signature_records
  for each row execute function goliath_signature_record_guard();

-- 2. updated_at maintenance for every table that carries the column.
create or replace function goliath_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_name = c.table_name and t.table_schema = c.table_schema
    where c.table_schema = 'public'
      and c.column_name = 'updated_at'
      and t.table_type = 'BASE TABLE'
      and c.table_name not in ('audit_events', 'signature_audit_events', 'load_status_history')
  loop
    execute format('drop trigger if exists %I_touch_updated_at on %I', r.table_name, r.table_name);
    execute format(
      'create trigger %I_touch_updated_at before update on %I
         for each row execute function goliath_touch_updated_at()',
      r.table_name, r.table_name);
  end loop;
end;
$$;
