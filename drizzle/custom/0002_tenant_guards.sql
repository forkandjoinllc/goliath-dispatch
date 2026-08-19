-- ────────────────────────────────────────────────────────────────────────────
-- Tenant-isolation defence in depth.
--
-- The application layer already refuses to build a query without a tenant
-- predicate (src/db/tenant-db.ts). These constraints make a cross-tenant write
-- fail at the database even if that layer were bypassed.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Composite unique keys that let child tables reference (tenant_id, id) of
--    their parent, so a child can never point at another tenant's parent row.
do $$
declare
  p record;
begin
  for p in
    select unnest(array[
      'carriers','customers','loads','drivers','trucks','trailers',
      'documents','invoices','dispatcher_groups','equipment_types'
    ]) as table_name
  loop
    begin
      execute format(
        'alter table %I add constraint %I unique (tenant_id, id)',
        p.table_name, p.table_name || '_tenant_id_uq');
    exception when duplicate_table or duplicate_object then
      null;
    end;
  end loop;
end;
$$;

-- 2. Tenant-consistency triggers for the highest-risk child relationships.
create or replace function goliath_assert_tenant_matches() returns trigger
language plpgsql as $$
declare
  parent_table text := tg_argv[0];
  parent_column text := tg_argv[1];
  parent_tenant uuid;
  child_parent_id uuid;
begin
  execute format('select ($1).%I', parent_column) into child_parent_id using new;
  if child_parent_id is null then
    return new;
  end if;
  execute format('select tenant_id from %I where id = $1', parent_table)
    into parent_tenant using child_parent_id;
  if parent_tenant is null then
    return new;
  end if;
  if parent_tenant <> new.tenant_id then
    raise exception
      'Cross-tenant reference rejected: %.% points at tenant % but the row belongs to tenant %',
      tg_table_name, parent_column, parent_tenant, new.tenant_id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$$;

do $$
declare
  m record;
begin
  for m in
    select * from (values
      ('trucks',                      'carriers',  'carrier_id'),
      ('trailers',                    'carriers',  'carrier_id'),
      ('carrier_users',               'carriers',  'carrier_id'),
      ('driver_carrier_relationships','carriers',  'carrier_id'),
      ('driver_carrier_relationships','drivers',   'driver_id'),
      ('loads',                       'carriers',  'carrier_id'),
      ('loads',                       'customers', 'customer_id'),
      ('load_stops',                  'loads',     'load_id'),
      ('load_assignments',            'loads',     'load_id'),
      ('load_assignments',            'trucks',    'truck_id'),
      ('load_assignments',            'trailers',  'trailer_id'),
      ('load_assignments',            'drivers',   'driver_id'),
      ('load_documents',              'loads',     'load_id'),
      ('load_documents',              'documents', 'document_id'),
      ('customer_contacts',           'customers', 'customer_id'),
      ('customer_locations',          'customers', 'customer_id'),
      ('invoices',                    'carriers',  'carrier_id'),
      ('invoices',                    'loads',     'load_id'),
      ('invoice_line_items',          'invoices',  'invoice_id'),
      ('payments',                    'invoices',  'invoice_id'),
      ('expenses',                    'loads',     'load_id'),
      ('financial_snapshots',         'loads',     'load_id'),
      ('permits',                     'loads',     'load_id'),
      ('escorts',                     'loads',     'load_id'),
      ('routes',                      'loads',     'load_id'),
      ('tracking_sessions',           'loads',     'load_id'),
      ('public_tracking_links',       'loads',     'load_id'),
      ('document_versions',           'documents', 'document_id')
    ) as v(child_table, parent_table, parent_column)
  loop
    execute format('drop trigger if exists %I on %I',
      m.child_table || '_' || m.parent_column || '_tenant_guard', m.child_table);
    execute format(
      'create trigger %I before insert or update on %I
         for each row execute function goliath_assert_tenant_matches(%L, %L)',
      m.child_table || '_' || m.parent_column || '_tenant_guard',
      m.child_table, m.parent_table, m.parent_column);
  end loop;
end;
$$;

-- 3. Money must never be negative where it is definitionally non-negative.
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('loads',              'customer_charge_cents'),
      ('loads',              'carrier_gross_rate_cents'),
      ('expenses',           'amount_cents'),
      ('invoices',           'total_cents'),
      ('invoices',           'amount_paid_cents'),
      ('payments',           'amount_cents'),
      ('permits',            'cost_cents'),
      ('escorts',            'cost_cents')
    ) as v(tbl, col)
  loop
    begin
      execute format('alter table %I add constraint %I check (%I >= 0)',
        c.tbl, c.tbl || '_' || c.col || '_nonneg', c.col);
    exception when duplicate_object or duplicate_table then
      null;
    end;
  end loop;
end;
$$;

-- 4. Basis points stay within 0–10000 (0–100%).
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('loads',               'carrier_dispatch_fee_bps'),
      ('loads',               'dispatcher_commission_bps'),
      ('carriers',            'dispatch_fee_bps'),
      ('dispatcher_profiles', 'commission_bps')
    ) as v(tbl, col)
  loop
    begin
      execute format('alter table %I add constraint %I check (%I between 0 and 10000)',
        c.tbl, c.tbl || '_' || c.col || '_range', c.col);
    exception when duplicate_object or duplicate_table then
      null;
    end;
  end loop;
end;
$$;
