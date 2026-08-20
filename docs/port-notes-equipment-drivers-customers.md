# Port notes — Equipment / Drivers / Customers domain

Source: `src/db/schema/equipment.ts`, `driver.ts`, `customer.ts` (+ shared
helpers/enums in `_shared.ts`). Target: MySQL 8.0.46 / Laravel, following the
conventions in `docs/mysql-port.md`.

## Files

- `database/schema/03_equipment_drivers_customers_tables.sql` — 10 tables, no
  foreign keys.
- `database/schema/82_equipment_drivers_customers_foreign_keys.sql` — every
  FK for this domain, applied after all domains' table files.
- `database/schema/93_equipment_drivers_customers_triggers.sql` — one
  trigger, forced by an InnoDB limitation rather than a business rule (see
  below); no `DELIMITER`.
- `database/migrations/2026_08_20_000003_create_equipment_drivers_customers_tables.php`
  — thin wrapper, `down()` genuinely reverses (trigger, then tables in
  reverse dependency order, with `foreign_key_checks` off so partial-`up()`
  states also clean up).
- `app/Enums/EquipmentStatus.php`, `app/Enums/DriverStatus.php` — new.
- `app/Enums/VerificationStatus.php`, `app/Enums/Locale.php` — **not
  created**, already existed (owned by the carriers/documents/signatures
  domain); reused as-is.

## Table count: 10

trucks, trailers, equipment_media, equipment_verifications, drivers,
driver_carrier_relationships, customers, customer_locations,
customer_contacts, customer_contact_locations.

Verified: `select count(*) from information_schema.tables where
table_schema='t3'` = 10 immediately after loading only
`03_equipment_drivers_customers_tables.sql` into an empty scratch database
(no other domain's tables present).

`equipment_types` is explicitly **not** in this file — it was already ported
by the tenancy/auth domain (`01_tenancy_auth_tables.sql`); `trucks.equipment_type_id`
and `trailers.equipment_type_id` reference it via `82_*_foreign_keys.sql`.

## How CHECK lists and PHP enums are guaranteed to match

Every enum value list was copied once, by hand, directly out of the
`pgEnum(...)` array literal in `_shared.ts` (`equipmentStatusEnum`,
`driverStatusEnum`, `verificationStatusEnum`, `localeEnum`), into the `CHECK
(col IN (...))` clause in `03_*_tables.sql`. The PHP enum cases were
generated from that same literal (snake_case value → PascalCase case name,
matching the convention already used by `App\Enums\OnboardingStatus` etc.).

Verified with a small script (`/tmp/verify_enum_parity2.php`, reproducible
from the two source files, not committed) that: parses every `constraint
chk_..._<col> check (<col> [is null or <col>] in (...))` clause out of
`03_equipment_drivers_customers_tables.sql` with a regex, `require`s the
relevant `App\Enums\*.php` files directly (no autoloader dependency needed
for a standalone check), sorts both lists, and asserts exact set equality
for every column backed by an enum. Result: all 6 real enum-backed CHECK
constraints match their PHP enum exactly:

```
MATCH: chk_trucks_status <-> App\Enums\EquipmentStatus (4 values)
MATCH: chk_trucks_coi_verification_status <-> App\Enums\VerificationStatus (7 values)
MATCH: chk_trailers_status <-> App\Enums\EquipmentStatus (4 values)
MATCH: chk_trailers_coi_verification_status <-> App\Enums\VerificationStatus (7 values)
MATCH: chk_equipment_verifications_status <-> App\Enums\VerificationStatus (7 values)
MATCH: chk_drivers_preferred_locale <-> App\Enums\Locale (2 values)
MATCH: chk_drivers_status <-> App\Enums\DriverStatus (4 values)
MATCH: chk_drivers_verification_status <-> App\Enums\VerificationStatus (7 values)
```

(`chk_trucks_coi_verification_status`, `chk_trailers_coi_verification_status`,
`chk_equipment_verifications_status` and `chk_drivers_verification_status`
all reuse `App\Enums\VerificationStatus` and were each checked
independently — 4 checks, one enum.)

Two more CHECK constraints exist and are intentionally **not** enum-backed:

- `chk_equipment_media_equipment_type` / `chk_equipment_verifications_equipment_type`
  — `check (equipment_type in ('truck','trailer'))`. This is the polymorphic
  discriminator the task calls out, not a `pgEnum` in the source (the source
  types `equipmentType: varchar('equipment_type', { length: 10 })` with only
  a `// truck | trailer` comment) — no matching PHP backed enum was created,
  faithfully mirroring that the source itself doesn't type it as an enum
  either.
- `chk_customers_credit_limit_cents` — `check (credit_limit_cents is null or
  credit_limit_cents >= 0)`, a numeric-range guard, not an `IN (...)` list.

## Enums NOT given a CHECK/PHP pair

Matching source fidelity — these are `varchar` columns with a comment
documenting intended values but **no** `pgEnum` type in Drizzle, so they got
no `CHECK` and no PHP backed enum: `equipment_media.angle`,
`equipment_media.media_kind`, `customers.status`. Postgres does not enforce
these either; the port doesn't invent stricter enforcement than the source
had.

## Per-tenant VIN uniqueness

`trucks` and `trailers` each carry `unique key <table>_tenant_vin_uq
(tenant_id, vin_normalized)`, not a global unique constraint — the same
truck run by two dispatch companies is two independent rows, exactly like
`carriers.dot_number` in the other domain.

Verified with a VIN a carrier could plausibly mistype (`1HGCM82633A004352`
vs `1HGCM82633AOO4352`, an `O`-for-`0` typo that the source's normalization
step folds to the same value):

**Same normalized VIN, two tenants — accepted:**
```sql
insert into trucks (..., tenant_id, vin, vin_normalized, ...) values (..., '1111...', '1HGCM82633A004352', '1HGCM82633A004352', ...);
insert into trucks (..., tenant_id, vin, vin_normalized, ...) values (..., '2222...', '1HGCM82633A004352', '1HGCM82633A004352', ...);
```
→ both rows present.

**Duplicate normalized VIN, same tenant (the O/0 typo case) — rejected:**
```
ERROR 1062 (23000) at line 2: Duplicate entry
  '11111111-1111-1111-1111-111111111111-1HGCM82633A004352' for key 'trucks.trucks_tenant_vin_uq'
```

## The driver licence blind index

`drivers.license_number_hash` is `char(64) charset ascii collate ascii_bin`
— the same hash-column convention as `carriers.ein_encrypted`'s sibling
`_last4` columns and every hash column in the other domain, applied here
because this column is functionally a blind index even though the source
doesn't name it with "hash" the way `sha256`/`content_hash` columns are
(it's `varchar('license_number_hash', { length: 64 })` in Drizzle, an HMAC
output — 64 hex chars, case-sensitive by construction).

`unique key drivers_tenant_license_hash_uq (tenant_id, license_number_hash)` —
per-tenant, matching the source's `uniqueIndex(...).on(t.tenantId,
t.licenseNumberHash)`. The column is nullable (a driver record can exist
before a licence is on file), and MySQL — like Postgres — never treats two
`NULL`s in a unique index as duplicates, so any number of driver rows with
no licence hash coexist without conflict.

Verified with a real SHA-256 hex digest:

**Same hash, two tenants — accepted:**
```sql
insert into drivers (..., tenant_id, license_number_hash) values (..., '1111...', '48de2934...');
insert into drivers (..., tenant_id, license_number_hash) values (..., '2222...', '48de2934...');
```
→ both rows present, `length(license_number_hash)` = 64 for each.

**Duplicate hash, same tenant — rejected:**
```
ERROR 1062 (23000) at line 2: Duplicate entry
  '11111111-1111-1111-1111-111111111111-48de29342a1c376935240359c08' for key 'drivers.drivers_tenant_license_hash_uq'
```

`drivers.date_of_birth` is `date`, not `datetime(3)` — a calendar fact with
no time-of-day component, per the task's explicit instruction; the source
itself types it `date('date_of_birth')`, not `timestamp`.

## The partial unique index on `customer_contacts`

```sql
primary_contact_key char(36) as (
  case when is_primary = 1 and deleted_at is null then customer_id end
) stored,
unique key customer_contacts_primary_uq (primary_contact_key)
```

`STORED`, not `VIRTUAL`, per `docs/mysql-port.md`: this index is read on
every contact write.

All four behaviours verified end to end against a real `customers` row:

**1. First primary contact — accepted:**
```sql
insert into customer_contacts (..., customer_id, is_primary) values (..., 'cccc...', 1);
```
→ inserted; `primary_contact_key` = the customer's id.

**2. Second primary for the same customer — rejected:**
```
ERROR 1062 (23000) at line 2: Duplicate entry 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  for key 'customer_contacts.customer_contacts_primary_uq'
```

**3. Many non-primaries for the same customer — accepted:**
Two more rows inserted with `is_primary = 0`; both succeed
(`primary_contact_key` is `NULL` for both, and MySQL never treats multiple
`NULL`s in a unique index as duplicates); `count(*) where is_primary=0` = 2.

**4. A new primary accepted after the old one is soft-deleted:**
```sql
update customer_contacts set deleted_at = now(3) where id = '...'; -- the old primary
insert into customer_contacts (..., customer_id, is_primary) values (..., 'cccc...', 1); -- new primary
```
→ succeeds. Final state confirms the soft-deleted contact's
`primary_contact_key` reverted to `NULL` (freeing the slot) and the new row's
`primary_contact_key` is the customer's id.

## One InnoDB limitation, worked around with a trigger

`driver.ts`/`customer.ts` declare `customerContacts.customerId` with
`{ onDelete: 'cascade' }`. But `customer_contacts.customer_id` is also a base
column of the `STORED` generated column `primary_contact_key` above, and
**InnoDB refuses outright to create a `CASCADE` (or `SET NULL`) foreign key
on a column that feeds a generated column in the same table** — this is not
a modeling choice, it's a hard InnoDB restriction, verified directly:

```sql
alter table customer_contacts
  add constraint fk_customer_contacts_customer
    foreign key (customer_id) references customers (id) on delete cascade;
-- ERROR 1215 (HY000): Cannot add foreign key constraint
```

The same `alter table` with `on delete restrict` (or no action at all)
succeeds immediately against the identical column — isolating the cause to
the delete action, not the column types, collation, or a missing index (all
double-checked and identical to the unaffected `customer_locations ->
customers` cascade FK, which uses the same parent/child column types and
worked on the first try).

Fix: `fk_customer_contacts_customer` is declared `on delete restrict` in
`82_equipment_drivers_customers_foreign_keys.sql`, and the source's cascade
semantics are reproduced explicitly by a `before delete on customers`
trigger in `93_equipment_drivers_customers_triggers.sql`:

```sql
create trigger trg_customers_cascade_delete_contacts
before delete on customers
for each row
begin
  delete from customer_contacts where customer_id = old.id;
end;
```

The trigger runs before the row is removed, so by the time InnoDB checks the
`RESTRICT` foreign key during the `customers` delete, the matching
`customer_contacts` rows are already gone and the check passes. Deleting
those rows itself cascades into `customer_contact_locations` via that
table's own (unaffected, native) `CASCADE` foreign key — no second trigger
needed there.

Verified end to end: a customer with 4 contacts (1 soft-deleted, 1 primary,
2 non-primary) was hard-deleted; before, `count(*) from customer_contacts
where customer_id = '...'` was 4; the `delete from customers` succeeded with
no FK error; after, the count was 0.

This is the one place this domain's foreign keys deviate from "mirror
`onDelete` exactly" — documented in both `82_*` and `93_*`'s header comments,
not silently.

## Foreign keys: simple, not compound, to match the source

Same precedent as the carriers/documents/signatures domain: the source uses
single-column FKs to each parent's `id` only, never the compound
`(tenant_id, id)` pattern, so `82_equipment_drivers_customers_foreign_keys.sql`
mirrors that. The mandatory `<table>_tenant_id_uq` unique keys are still
present on all ten tables.

Columns with **no** foreign key, because the source declares them as plain
`uuid`/`char(36)` with no `.references()` call:

- `equipment_media.equipment_id`, `equipment_verifications.equipment_id` —
  polymorphic pointer into `trucks` or `trailers` depending on the sibling
  `equipment_type` discriminator; a single FK cannot target two tables.
- `equipment_verifications.coi_document_version_id` — plain `uuid` in the
  source, no `.references()` call (unlike its sibling `coi_document_id`,
  which does reference `documents.id`).

## Money and dimensions

`customers.credit_limit_cents` is a nullable signed `bigint` with `CHECK
(credit_limit_cents is null or credit_limit_cents >= 0)` — nullable because
the source's `cents('credit_limit_cents')` helper carries no `.notNull()`
call, and `>= 0` because a credit limit cannot legitimately be negative
(unlike gross margin or a settlement, per `docs/mysql-port.md`'s money
section).

`trailers`' dimension and capacity columns (`length_inches`, `width_inches`,
`deck_height_inches`, `well_length_inches`, `capacity_pounds`, `axle_count`)
are ported as plain nullable `int` with no `CHECK` — imperial units
throughout, matching the source's plain `integer(...)` columns with no range
guard of their own.

## Verification (scratch database `t3`, never `goliath`/`goliath_test`)

### 1. Clean load, cross-domain FKs resolve

```
mysql -uroot -proot -e "drop database if exists t3; create database t3 character set utf8mb4 collate utf8mb4_0900_ai_ci;"
mysql -uroot -proot t3 < database/schema/01_tenancy_auth_tables.sql
mysql -uroot -proot t3 < database/schema/02_carriers_documents_signatures_tables.sql
mysql -uroot -proot t3 < database/schema/03_equipment_drivers_customers_tables.sql
```
→ all three load with no errors. `select count(*) from information_schema.tables
where table_schema='t3'` = 57 (01's + 02's + this domain's tables together);
counting only this domain's 10 table names = 10.

```
mysql -uroot -proot t3 < database/schema/82_equipment_drivers_customers_foreign_keys.sql
```
→ succeeds (after the trigger workaround above); 28 `FOREIGN KEY` constraints
created across the 10 tables, resolving against `tenants`, `users`,
`carriers`, `documents` and `equipment_types` — all owned by the already-
landed `01_*`/`02_*` domains, none stubbed.

### 2. Trigger file loads over PDO, not just the CLI

Loading `93_equipment_drivers_customers_triggers.sql` via `mysql t3 < file`
(the CLI, batch mode, no `DELIMITER`) **fails**, exactly like the other
domain's trigger file and for the same reason:
```
ERROR 1064 (42000) at line 37: You have an error in your SQL syntax ...
```
This is expected, not a bug in the file, and is not how the migration will
load it.

The real target — `PDO::exec()` on the entire file contents in one call,
exactly what `DB::unprepared(file_get_contents(...))` does — succeeds:

```php
$pdo = new PDO('mysql:host=127.0.0.1;dbname=t3;charset=utf8mb4', 'root', 'root',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec(file_get_contents('database/schema/93_equipment_drivers_customers_triggers.sql'));
// => "PDO::exec() of full trigger file: OK"
```
Output:
```
PDO::exec() of full trigger file: OK
trg_customers_cascade_delete_contacts | BEFORE | DELETE | customers
```

### 3. Constraints bite

All error output shown verbatim above in each section:

- Per-tenant VIN: accepted across tenants, `ERROR 1062` on the same-tenant
  O/0-typo duplicate.
- Per-tenant licence hash: accepted across tenants, `ERROR 1062` on the
  same-tenant duplicate.
- `customer_contacts` primary-contact: all four behaviours confirmed (first
  primary accepted, second rejected with `ERROR 1062`, many non-primaries
  accepted, new primary accepted after the old one is soft-deleted).
- Invalid `equipment_status`: `insert ... status = 'not_a_real_status'` →
  `ERROR 3819 (HY000): Check constraint 'chk_trucks_status' is violated.`;
  the same row with `status = 'active'` inserts cleanly.
- `customers -> customer_contacts` cascade-via-trigger: a customer with 4
  contact rows was hard-deleted; `customers` row count went from 1 to 0 with
  no FK error, and the matching `customer_contacts` count went from 4 to 0.

### 4. Table count

`select count(*) from information_schema.tables where table_schema='t3'` = 10
when only counting this domain's ten table names, measured right after
loading only `03_equipment_drivers_customers_tables.sql` (immediately
following `01_*`/`02_*`, which contribute the other 47).

### 5. Migration `down()` genuinely reverses

Simulated the full `up()`/`down()` sequence directly: table count in `t3`
went from 57 (all three domains' tables) to 47 after dropping the trigger and
this domain's 10 tables in `array_reverse()` order with
`foreign_key_checks = 0` — the same statements the migration's `down()`
issues.

## Nothing was left unported

Every table, column, index name, and comment worth preserving from
`equipment.ts`, `driver.ts` and `customer.ts` made it across. The one
deliberate deviation — `fk_customer_contacts_customer` as `RESTRICT` plus a
compensating trigger, instead of a native `CASCADE` — is not a shortcut
against the source; it reproduces the source's cascade semantics exactly,
worked around an InnoDB limitation that made the literal translation
impossible to even declare.

## For the loads domain (and anyone else building on these tables)

- `trucks.id` / `trailers.id` are valid polymorphic targets for
  `equipment_media.equipment_id` / `equipment_verifications.equipment_id`,
  discriminated by the sibling `equipment_type` column (`'truck'` |
  `'trailer'`) — no foreign key enforces which table a given row's
  `equipment_id` points into; that's application-layer, faithful to the
  source.
- `documents.id` (owned by the carriers/documents/signatures domain) is a
  valid FK target for `equipment_verifications.coi_document_id` — already
  wired up in `82_*`.
- `customers.id`, `customer_locations.id`, `customer_contacts.id`,
  `drivers.id`, `trucks.id`, `trailers.id` are all `char(36)` UUID primary
  keys with the standard `<table>_tenant_id_uq (tenant_id, id)` unique key,
  ready for any other domain (e.g. loads) to reference.
- Deleting a `customers` row (hard delete, not the usual soft-delete path)
  cascades into `customer_contacts` via `trg_customers_cascade_delete_contacts`,
  not a native FK — if another domain ever needs to reason about cascade
  order into/out of `customers`, this trigger is part of that chain, not
  just the FKs in `82_*`.
- `App\Enums\VerificationStatus` and `App\Enums\Locale` are shared and were
  reused unmodified — if your domain also has an FMCSA/COI-style
  verification status or a locale column, reuse these, don't create new
  ones. `App\Enums\EquipmentStatus` and `App\Enums\DriverStatus` are new,
  owned by this domain, and available for reuse if needed elsewhere.
