-- ============================================================================
-- Goliath Dispatch — Equipment / Drivers / Customers domain
-- Triggers.
--
-- None of the ten tables in this domain are append-only (no audit_events-
-- style ledger) or tamper-evident (no signature_records-style guarded
-- update) in the source (src/db/schema/equipment.ts, driver.ts, customer.ts)
-- — neither of the two trigger families documented in docs/mysql-port.md
-- applies here.
--
-- One trigger exists for a different reason entirely: an InnoDB limitation,
-- not a business rule.
--
-- No `DELIMITER` directives: this file is executed via DB::unprepared(),
-- which sends it to the server exactly as written over PDO — DELIMITER is a
-- `mysql` CLI-only convention and has no meaning over the wire protocol.
-- ============================================================================

-- ── customers -> customer_contacts: cascade delete, worked around ─────────
-- The source declares customerContacts.customerId with
-- { onDelete: 'cascade' }. customer_contacts.customer_id is also a base
-- column of the STORED generated column primary_contact_key (see
-- 03_equipment_drivers_customers_tables.sql), and InnoDB refuses to create a
-- CASCADE (or SET NULL) foreign key on a column that feeds a generated
-- column in the same table — verified: attempting it raises
-- `ERROR 1215 (HY000): Cannot add foreign key constraint`, even though a
-- plain DELETE removes the whole row rather than modifying the column.
--
-- fk_customer_contacts_customer is therefore RESTRICT
-- (82_equipment_drivers_customers_foreign_keys.sql), and this trigger
-- reproduces the source's cascade semantics explicitly: it removes the
-- customer's contacts *before* the customer row itself is deleted, so the
-- RESTRICT check that fires during the customers DELETE finds no remaining
-- child rows and does not block it. Deleting from customer_contacts here
-- still cascades into customer_contact_locations via that table's own
-- (unaffected, native) CASCADE foreign key.
create trigger trg_customers_cascade_delete_contacts
before delete on customers
for each row
begin
  delete from customer_contacts where customer_id = old.id;
end;
