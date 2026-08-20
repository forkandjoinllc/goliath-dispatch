-- ============================================================================
-- Goliath Dispatch — Equipment / Drivers / Customers domain
-- Foreign keys only. Applied after every domain's 0X_*_tables.sql (this file
-- lives in the 80-84 phase) so that FKs pointing at tables owned by other
-- domains (tenants, users, carriers, documents, equipment_types) always find
-- their target already created.
--
-- ON DELETE actions mirror the source Drizzle schema exactly:
--   * `.references(() => x.id, { onDelete: 'cascade' })`   -> on delete cascade
--   * `.references(() => x.id, { onDelete: 'set null' })`  -> on delete set null
--   * `.references(() => x.id)` with no option              -> on delete restrict
--     (Postgres' default is NO ACTION; MySQL's closest equivalent is RESTRICT.)
--
-- Columns that carry no `.references()` call in the source get no foreign
-- key here either — faithful to the source, not an omission:
--   * equipment_media.equipment_id, equipment_verifications.equipment_id —
--     polymorphic pointer into trucks or trailers depending on the sibling
--     equipment_type discriminator; a single FK cannot target two tables.
--   * equipment_verifications.coi_document_version_id — plain uuid, no
--     .references() call in the source.
--
-- ONE DEVIATION FROM "mirror onDelete exactly", forced by an InnoDB
-- limitation, not a choice: the source declares
-- customerContacts.customerId with { onDelete: 'cascade' }, but
-- customer_contacts.customer_id is also a base column of the STORED
-- generated column primary_contact_key (03_equipment_drivers_customers_
-- tables.sql). InnoDB refuses outright to create a CASCADE (or SET NULL)
-- foreign key on a column that feeds a generated column in the same table
-- — verified: `ERROR 1215 (HY000): Cannot add foreign key constraint` when
-- attempted, even though a plain DELETE removes the whole row rather than
-- modifying the column. fk_customer_contacts_customer is therefore declared
-- RESTRICT here, and the CASCADE semantics are reproduced faithfully via an
-- explicit `before delete on customers` trigger in
-- 93_equipment_drivers_customers_triggers.sql instead. Every other cascade
-- in this file is a plain, unaffected native FK.
--
-- Following this domain's own tenant-isolation precedent set by
-- carriers/documents/signatures (see port-notes-carriers-documents-signatures.md
-- "Foreign keys: simple, not compound, to match the source"): the source
-- uses single-column FKs to each parent's `id` only, never the compound
-- (tenant_id, id) pattern, so this file mirrors that. The mandatory
-- <table>_tenant_id_uq unique keys are still present on every table (added
-- in 03_equipment_drivers_customers_tables.sql).
-- ============================================================================

-- ── Trucks ─────────────────────────────────────────────────────────────────

alter table trucks
  add constraint fk_trucks_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_trucks_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_trucks_equipment_type
    foreign key (equipment_type_id) references equipment_types (id) on delete restrict;

-- ── Trailers ───────────────────────────────────────────────────────────────

alter table trailers
  add constraint fk_trailers_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_trailers_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_trailers_equipment_type
    foreign key (equipment_type_id) references equipment_types (id) on delete restrict;

-- ── Equipment media ────────────────────────────────────────────────────────

alter table equipment_media
  add constraint fk_equipment_media_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_equipment_media_uploaded_by_user
    foreign key (uploaded_by_user_id) references users (id) on delete restrict;

-- ── Equipment verifications ────────────────────────────────────────────────

alter table equipment_verifications
  add constraint fk_equipment_verifications_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_equipment_verifications_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_equipment_verifications_coi_document
    foreign key (coi_document_id) references documents (id) on delete set null,
  add constraint fk_equipment_verifications_overridden_by_user
    foreign key (overridden_by_user_id) references users (id) on delete restrict;

-- ── Drivers ────────────────────────────────────────────────────────────────

alter table drivers
  add constraint fk_drivers_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_drivers_user
    foreign key (user_id) references users (id) on delete set null,
  add constraint fk_drivers_verified_by_user
    foreign key (verified_by_user_id) references users (id) on delete restrict;

-- ── Driver <-> carrier relationships ───────────────────────────────────────

alter table driver_carrier_relationships
  add constraint fk_driver_carrier_relationships_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_driver_carrier_relationships_driver
    foreign key (driver_id) references drivers (id) on delete cascade,
  add constraint fk_driver_carrier_relationships_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_driver_carrier_relationships_approved_by_user
    foreign key (approved_by_user_id) references users (id) on delete restrict;

-- ── Customers ──────────────────────────────────────────────────────────────

alter table customers
  add constraint fk_customers_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_customers_duplicate_override_by_user
    foreign key (duplicate_override_by_user_id) references users (id) on delete restrict;

-- ── Customer locations ─────────────────────────────────────────────────────

alter table customer_locations
  add constraint fk_customer_locations_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_customer_locations_customer
    foreign key (customer_id) references customers (id) on delete cascade;

-- ── Customer contacts ──────────────────────────────────────────────────────

alter table customer_contacts
  add constraint fk_customer_contacts_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  -- RESTRICT, not CASCADE: see the note above the "Customer contacts"
  -- heading in this file's header comment. The equivalent cascade behaviour
  -- is provided by trg_customers_cascade_delete_contacts in
  -- 93_equipment_drivers_customers_triggers.sql.
  add constraint fk_customer_contacts_customer
    foreign key (customer_id) references customers (id) on delete restrict;

-- ── Customer contact <-> location join ─────────────────────────────────────

alter table customer_contact_locations
  add constraint fk_customer_contact_locations_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_customer_contact_locations_contact
    foreign key (contact_id) references customer_contacts (id) on delete cascade,
  add constraint fk_customer_contact_locations_location
    foreign key (location_id) references customer_locations (id) on delete cascade;
