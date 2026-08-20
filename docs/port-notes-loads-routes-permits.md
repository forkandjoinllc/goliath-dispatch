# Port notes — Loads / Routes / Permits domain

Source: `src/db/schema/load.ts`, `route.ts` (+ shared helpers/enums in
`_shared.ts`). Target: MySQL 8.0.46 / Laravel, following the conventions in
`docs/mysql-port.md`.

## Files

- `database/schema/04_loads_routes_permits_tables.sql` — 13 tables, no
  foreign keys.
- `database/schema/83_loads_routes_permits_foreign_keys.sql` — every FK for
  this domain, applied after all domains' table files.
- `database/schema/94_loads_routes_permits_triggers.sql` — the append-only
  guard on `load_status_history`, no `DELIMITER`.
- `database/migrations/2026_08_20_000004_create_loads_routes_permits_tables.php`
  — thin wrapper, `down()` genuinely reverses (triggers, then tables in
  reverse dependency order, with `foreign_key_checks` off so partial-`up()`
  states also clean up).
- `app/Enums/LoadStatus.php`, `StopType.php`, `AppointmentType.php` — new.
- `app/Enums/DocumentType.php`, `CommissionBasis.php` — **not created**,
  already existed (from the carriers/documents/signatures domain); reused
  as-is for `load_documents.document_type` and
  `loads.dispatcher_commission_basis` respectively. Values match exactly
  (verified, see below).

## Table count: 13

loads, load_stops, load_assignments, load_status_history, load_documents,
rate_confirmation_acceptances, check_calls, routes, route_states,
oversize_rules, oversize_evaluations, permits, escorts.

Verified: `select count(*) from information_schema.tables where
table_schema='t4'` = **13** immediately after loading only
`04_loads_routes_permits_tables.sql` into an empty scratch database.

## How CHECK lists and PHP enums are guaranteed to match

Each enum value list was copied once, by hand, directly out of the relevant
`pgEnum(...)` array literal (`loadStatusEnum`, `stopTypeEnum`,
`appointmentTypeEnum` in `_shared.ts`) into the `CHECK (col IN (...))`
clause, and the new PHP enum cases were generated from that same literal
(snake_case value → PascalCase case name, matching the convention already
used by `LoadStatus`'s siblings elsewhere in this tree).

That hand-transcription step is exactly where drift could sneak in, so it
isn't left to eyeballing: `/tmp/verify_enum_parity.php` and
`/tmp/verify_enum_parity2.php` (not committed — throwaway checkers,
reproducible from the two source files any time; `vendor/` isn't installed
in this tree so they parse the PHP enum files by regex instead of via
reflection/autoload, which is an equally exact check of the literal `case
Foo = 'foo'` text) parse every `constraint chk_..._<col> check (<col> [is
null or <col>] in (...))` clause out of `04_loads_routes_permits_tables.sql`
and assert exact set equality — not "PHP is a superset of SQL" or vice versa
— against the corresponding enum. Result, all 7 CHECK↔enum pairs match:

```
chk_loads_status                         LoadStatus.php                 MATCH (13 values)
chk_load_status_history_to_status        LoadStatus.php                 MATCH (13 values)
chk_load_status_history_from_status      LoadStatus.php                 MATCH (13 values)
chk_load_stops_stop_type                 StopType.php                   MATCH (2 values)
chk_load_stops_appointment_type          AppointmentType.php            MATCH (4 values)
chk_load_documents_document_type         DocumentType.php (reused)      MATCH (27 values)
chk_loads_dispatcher_commission_basis    CommissionBasis.php (reused)   MATCH (3 values)
```

`LoadStatus` (13 values, `_shared.ts` `loadStatusEnum`): draft, available,
assigned, dispatched, en_route_to_pickup, at_pickup, in_transit, at_delivery,
delivered, pod_received, invoiced, paid, cancelled.

## Enums NOT given a CHECK/PHP pair

Several `varchar` columns in the source carry a comment listing valid values
but are **not** `pgEnum`-typed in Drizzle, so — matching the reference
domain's precedent exactly (`owner_type`, `document_access_logs.action`,
`document_expirations.kind`, `signature_audit_events.event_type`,
`group_members.member_type`, `dispatcher_resource_assignments.resource_type`
were all left unchecked there for the identical reason) — they were ported
as plain `varchar` with no `CHECK` and no PHP backed enum, faithfully
matching the source's deliberate choice to leave them open:
`load_assignments.resource_type` (truck|trailer|driver),
`rate_confirmation_acceptances.decision`
(accepted|rejected|changes_requested), `check_calls.origin`
(scheduled|provider_event|manual), `oversize_evaluations.outcome` and
`.human_validation_status`, `permits.status`, `escorts.status` and
`.escort_type`.

**One deliberate exception:** `load_status_history.source` *is* constrained
(`chk_load_status_history_source`), even though it isn't a `pgEnum` in the
Drizzle source either. This is a direct instruction in the task brief, not
an extrapolation: "`load_status_history.source` is constrained to `user |
tracking_provider | system_job | webhook` — this is how the audit trail
distinguishes a dispatcher's action from a tracking ingest." No PHP enum was
added for it, consistent with every other comment-only `varchar` in this
file — the `CHECK` is real, but there is nothing to reconcile it against on
the PHP side, so it isn't in the enum-parity table above. (An earlier draft
of this file also added `CHECK`s to `decision`, `origin`, `outcome`,
`human_validation_status`, and the permit/escort `status`/`escort_type`
columns, reasoning that they were equally closed workflow sets — that was
reverted before landing, since it isn't what the source declares and isn't
what the task asked for, and having a `CHECK` with no PHP enum counterpart
for it would break the "SQL list and PHP cases must match exactly" guarantee
the task asks for everywhere else.)

## The three `load_assignments` partial-unique-index replacements

MySQL has no partial/filtered unique index. The source's three Postgres
partial indexes —
`unique(load_id, truck_id) where truck_id is not null and unassigned_at is null`
(and the same shape for `trailer_id` / `driver_id`) — are replaced by three
`STORED` generated columns that collapse to `NULL` unless the row is a
*live* occupant of that resource slot, backed by a plain `unique key`:

```sql
active_truck_key char(36) as (
  case when truck_id is not null and unassigned_at is null then truck_id end
) stored,
unique key load_assignments_truck_uq (load_id, active_truck_key),
```

`STORED`, not `VIRTUAL`: this generated column backs a unique index consulted
on every write to the table.

Verified (see full transcript below) against a seeded tenant/load/two-trucks
fixture:

1. **Same truck twice on the same load while live → rejected.**
   ```
   ERROR 1062 (23000): Duplicate entry
     '88888888-8888-8888-8888-888888888888-55555555-5555-5555-5555-555'
     for key 'load_assignments.load_assignments_truck_uq'
   ```
2. **Unassign, then re-assign the same truck to the same load → accepted.**
   Setting `unassigned_at` on the live row collapses its `active_truck_key`
   to `NULL`, freeing the slot; the new insert succeeds.
3. **Two different trucks live on one load → accepted.** Different
   `active_truck_key` values, no collision.
4. **The same truck live on two different loads → accepted.** The unique key
   is scoped `(load_id, active_truck_key)`, not global on the truck — this is
   deliberate: cross-load scheduling-conflict detection ("is this truck
   already committed elsewhere in this time window?") is **not** a schema
   invariant in the source either (no exclusion constraint on
   `load_assignments` in `load.ts`) and stays entirely in the application
   layer, backed by tests. See `docs/mysql-port.md`, "Lo que se pierde" §1.

## `load_status_history`: append-only

Straightforward per-table `before update`/`before delete` pair, both
`SIGNAL SQLSTATE '45000'`, matching the pattern used for `audit_events`
(tenancy/auth domain) and `signature_audit_events`
(carriers/documents/signatures domain) — this domain owns the
`load_status_history` instance of it. Message text kept to 58 characters,
well under MySQL's 128-character `SIGNAL ... SET MESSAGE_TEXT` cap (a prior
domain's port notes record hitting `ERROR 1648` at 151 characters — avoided
here by checking length before committing the file).

## `loads.carrier_locked_at`: no trigger, by design

The source's comment on `carrierId` is explicit: "A load belongs to exactly
one carrier and the link is immutable once assigned." The mechanism is
`carrierLockedAt` — once set, `carrierId` should never change again;
correcting a carrier assignment means cancelling the load and creating a new
one (or duplicating it via `duplicatedFromLoadId`), never rewriting
`carrier_id` in place.

This rule is **deliberately not enforced by a database trigger** here. It
was in scope to consider (a `before update` guard comparing
`old.carrier_id`/`new.carrier_id` when `old.carrier_locked_at is not null`
would be a natural fit for the same `SIGNAL`-based pattern used elsewhere in
this file), but:

- The source itself does not encode this as a Postgres-level constraint
  anywhere in `load.ts` — it's a comment describing an application-level
  invariant, not a `CHECK` or exclusion constraint. Every other trigger in
  this port (append-only tables, tamper-evident `signature_records`) mirrors
  a mechanism the source *did* implement at the database layer; inventing a
  new one here would be adding behavior beyond what was ported, not
  reproducing it.
- The rule has a legitimate escape hatch (cancel-and-duplicate) that a rigid
  trigger would have to special-case correctly (e.g. still allowing
  `carrier_id` to be set the *first* time even though `carrier_locked_at` may
  already be non-null from some other flow, or allowing it to be cleared on
  cancellation) — that branching belongs with the rest of the load lifecycle
  business logic in the application, where it can be unit-tested against the
  actual dispatch workflow, not encoded blind in SQL.

So: **the next reader should not conclude this was forgotten.** It is a
conscious application-layer responsibility. `carrier_locked_at` itself is a
real, present column — the enforcement of what it means is not schema-level.

## Money: which `cents` columns get a `CHECK (>= 0)`

Per the task's explicit list, only four columns in this domain get the
non-negative guard: `loads.customer_charge_cents`,
`loads.carrier_gross_rate_cents`, `permits.cost_cents`, `escorts.cost_cents`.
Two other `cents()`-typed columns in the source —
`routes.estimated_toll_cents` and
`rate_confirmation_acceptances.rated_amount_cents` — are **left as plain
signed `bigint` with no floor**, matching the source (Drizzle's `cents()`
helper has no built-in non-negativity, and neither of these two columns is
in the task's explicit four-column list). Both are nullable snapshot/estimate
fields, not authoritative charges, so leaving them unconstrained is
consistent with `docs/mysql-port.md`'s money section ("the checks apply only
where the value cannot be negative *by definition*") rather than an
oversight.

Verified: `customer_charge_cents = -100` on `loads` is rejected
(`chk_loads_customer_charge_cents`); the same negative value on
`estimated_toll_cents`/`rated_amount_cents` would be accepted (not exercised
in the transcript below since it is expected-success, not a rejection to
demonstrate).

## JSON columns and generated columns

`legs` (routes), `travel_restrictions` (oversize_rules), `inputs` and
`state_results` and `missing_data_warnings` (oversize_evaluations),
`compliance_snapshot` (load_assignments) all became plain `json` columns.
**None of them needed a generated column**: the source never defines an
index into any of these JSON blobs (no `jsonb_path_ops` GIN index, no
expression index) in `load.ts`/`route.ts` — they are read/written whole by
the application, not queried by a JSON path. This is different from the
`load_assignments` case (§ above), where the "generated column" pattern is
used for a partial-unique-index replacement rather than JSON search.

## Comments preserved

- `oversize_rules`: "Per-state legal limits. Seeded with representative
  federal/state values and fully tenant-editable — these drive guidance,
  never a legal determination." — kept verbatim as the table's leading
  comment; this is the load-bearing disclaimer that the feature is not legal
  advice.
- `oversize_evaluations.inputs`: "Inputs are snapshotted so a later dimension
  change cannot rewrite history." — kept, since it explains why `inputs` is
  `json not null` rather than a live join back to `loads`.
- `load_assignments.committed_from`/`committed_to`: "Window the resource is
  committed for — used by conflict detection." — kept.
- `load_status_history.source`: "user | tracking_provider | system_job |
  webhook — distinguishes a dispatcher's action from an automated tracking
  ingest in the audit trail." — kept and slightly expanded per the task
  brief's own framing.

## Foreign keys

Single-column FKs mirroring each `.references()` call 1:1, `on delete`
copied from the `onDelete` option (absent → `restrict`, matching Postgres'
default `NO ACTION`), exactly the same convention the
carriers/documents/signatures domain used and documented. The mandatory
`<table>_tenant_id_uq` unique keys are present on every table per the
task's rule, even though nothing in this domain's FKs uses the compound
`(tenant_id, id)` form — same choice, same reasoning as the reference
domain.

Columns with **no** foreign key, because the source itself declares them as
plain `uuid`/`char(36)` with no `.references()` call:
`loads.duplicated_from_load_id` (forward-pointing self-reference to another
`loads.id` row, deliberately left unconstrained by the source — the same
pattern as `signature_requests.superseded_by_request_id` in the reference
domain).

Cross-domain FK targets and where they live:

| Column(s) | Target table | Owning domain file |
|---|---|---|
| `*.tenant_id` | `tenants` | `01_tenancy_auth_tables.sql` |
| `*.*_user_id` | `users` | `01_tenancy_auth_tables.sql` |
| `loads.carrier_id`, `rate_confirmation_acceptances.carrier_id` | `carriers` | `02_carriers_documents_signatures_tables.sql` |
| `load_documents.document_id`, `rate_confirmation_acceptances.document_id`, `permits.document_id`, `permits.route_survey_document_id`, `escorts.document_id` | `documents` | `02_carriers_documents_signatures_tables.sql` |
| `rate_confirmation_acceptances.document_version_id` | `document_versions` | `02_carriers_documents_signatures_tables.sql` |
| `loads.customer_id`, `loads.customer_contact_id` | `customers`, `customer_contacts` | `03_equipment_drivers_customers_tables.sql` |
| `load_stops.customer_location_id` | `customer_locations` | `03_equipment_drivers_customers_tables.sql` |
| `loads.required_equipment_type_id` | `equipment_types` | `01_tenancy_auth_tables.sql` (lives there, not `03_*`) |
| `load_assignments.truck_id`/`trailer_id`/`driver_id` | `trucks`, `trailers`, `drivers` | `03_equipment_drivers_customers_tables.sql` |

By the time this domain's verification ran, `03_equipment_drivers_customers_tables.sql`
had already landed, so **every** foreign key above — not just the ones into
`01_*`/`02_*` — was proven against real tables, not stubs. See the
verification transcript below.

## Verification (scratch database `t4`, never `goliath`/`goliath_test`)

### 1. Clean apply from empty, then cross-domain apply

```
mysql -uroot -proot -e "drop database if exists t4; create database t4 character set utf8mb4 collate utf8mb4_0900_ai_ci;"
mysql -uroot -proot t4 < database/schema/04_loads_routes_permits_tables.sql
```
→ succeeds with no output (no errors).

```
mysql -uroot -proot t4 -e "select count(*) from information_schema.tables where table_schema='t4';"
```
→ `13`.

Full cross-domain apply, in the fixed numeric order, against a fresh `t4`:

```
01_tenancy_auth_tables.sql                        -> OK
02_carriers_documents_signatures_tables.sql        -> OK
03_equipment_drivers_customers_tables.sql          -> OK
04_loads_routes_permits_tables.sql                 -> OK
80_tenancy_auth_foreign_keys.sql                   -> OK
81_carriers_documents_signatures_foreign_keys.sql   -> OK
82_equipment_drivers_customers_foreign_keys.sql     -> OK
83_loads_routes_permits_foreign_keys.sql            -> OK
```

(An earlier run against a mid-edit copy of `82_equipment_drivers_customers_foreign_keys.sql`
— another engineer's file, being actively worked on concurrently in this
shared tree — hit `ERROR 1215` partway through; `83_*` still applied cleanly
that time too, since every target table this domain's FKs need had already
been created by the point `82_*` ran, and only `82_*`'s own FK-adding step on
a table this domain doesn't touch was affected. The final, reproducible run
above is clean end to end.)

Querying `information_schema.key_column_usage` afterward confirms this
domain's foreign keys are all present with the correct
`referenced_table_name`/`referenced_column_name`:
`select count(*) from information_schema.key_column_usage where
table_schema='t4' and referenced_table_name is not null and table_name in
(<this domain's 13 tables>)` → **49** (spot-checked all 13 tables — `loads`
alone shows 8: `tenant`, `customer`, `customer_contact`, `carrier`,
`dispatcher_user`, `required_equipment_type`, `permit_ready_approved_by_user`,
`oversize_validated_by_user`).

### 2. Trigger file loads over PDO (not just the CLI)

Loading `94_loads_routes_permits_triggers.sql` via `mysql t4 < file` (the
CLI, batch mode, no `DELIMITER`) **fails**, exactly as the reference domains'
port notes predict:
```
ERROR 1064 (42000) at line ...: You have an error in your SQL syntax ...
```
This is expected — it demonstrates the DELIMITER problem the CLI has with a
multi-statement trigger body when no `DELIMITER` command is present, and is
not how the migration actually loads the file.

The real target — `PDO::exec()` on the entire file contents in one call,
exactly what `DB::unprepared(file_get_contents(...))` does — succeeds, run
alongside all three other domains' trigger files to prove nothing about this
file depends on load order within the 9X range:

```php
$pdo = new PDO('mysql:host=127.0.0.1;dbname=t4;charset=utf8mb4', 'root', 'root',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
foreach ([
    '91_tenancy_auth_triggers.sql',
    '92_carriers_documents_signatures_triggers.sql',
    '93_equipment_drivers_customers_triggers.sql',
    '94_loads_routes_permits_triggers.sql',
] as $f) {
    $pdo->exec(file_get_contents("database/schema/$f"));
    echo "$f -> OK\n";
}
```
Output:
```
91_tenancy_auth_triggers.sql -> OK
92_carriers_documents_signatures_triggers.sql -> OK
93_equipment_drivers_customers_triggers.sql -> OK
94_loads_routes_permits_triggers.sql -> OK
```
Confirmed present via `information_schema.triggers`:
```
trg_load_status_history_no_update  | BEFORE | UPDATE | load_status_history
trg_load_status_history_no_delete  | BEFORE | DELETE | load_status_history
```

`down()` was simulated the same way against the fully-loaded `t4`: dropping
both triggers, then all 13 tables in reverse order with
`foreign_key_checks = 0`, took the schema from 70 tables to 57 tables — an
exact drop of 13, confirming `down()` genuinely reverses `up()` without
disturbing the other three domains' 57 tables.

### 3. Constraints bite

Fixture: one tenant, one user, one customer, one carrier, two trucks, one
trailer, one driver, two loads (`GD-1001`, `GD-1002`).

**`load_assignments` — all four behaviours, real error output:**

1. Same truck twice on the same load, both live → rejected:
   ```
   ERROR 1062 (23000): Duplicate entry
     '88888888-8888-8888-8888-888888888888-55555555-5555-5555-5555-555'
     for key 'load_assignments.load_assignments_truck_uq'
   ```
2. `unassigned_at` set on the first row, then the same truck re-assigned to
   the same load → accepted (`reassign after unassign ok`).
3. A second, different truck assigned live to the same load → accepted
   (`second distinct truck on same load ok`).
4. The same truck assigned live to a *different* load → accepted
   (`same truck on different load ok`) — the cross-load conflict case is
   application logic, not a schema constraint, per source.

**`load_status_history` refuses UPDATE and DELETE:**
```
ERROR 1644 (45000): load_status_history is append-only: rows cannot be updated
ERROR 1644 (45000): load_status_history is append-only: rows cannot be deleted
```

**Invalid `load_status` — rejected:**
```
ERROR 3819 (HY000): Check constraint 'chk_loads_status' is violated.
```
(attempted value: `'not_a_real_status'`)

**Duplicate `(tenant_id, load_number)` — rejected:**
```
ERROR 1062 (23000): Duplicate entry
  '11111111-1111-1111-1111-111111111111-GD-1001' for key 'loads.loads_tenant_number_uq'
```

**Negative `customer_charge_cents` — rejected:**
```
ERROR 3819 (HY000): Check constraint 'chk_loads_customer_charge_cents' is violated.
```
(attempted value: `-100`)

**Out-of-range `carrier_dispatch_fee_bps` — rejected:**
```
ERROR 3819 (HY000): Check constraint 'chk_loads_carrier_dispatch_fee_bps' is violated.
```
(attempted value: `10500`, i.e. 105%)

### 4. Table count

`select count(*) from information_schema.tables where table_schema='t4'` =
**13** (measured right after loading only
`04_loads_routes_permits_tables.sql` into an empty database, before any
other domain's tables or FKs were added).

## For the finance domain

- `loads.customer_charge_cents` and `loads.carrier_gross_rate_cents` are the
  two authoritative money fields on a load — both signed `bigint` cents,
  both `CHECK (>= 0)` (the *charge* and *gross rate* cannot be negative by
  definition, even though margin/settlement derived from them elsewhere can
  be). `carrier_dispatch_fee_bps` and `dispatcher_commission_bps` are
  snapshotted onto the load at creation/assignment time (basis points,
  `CHECK (BETWEEN 0 AND 10000)`) precisely so a later change to a carrier's
  or dispatcher's standing rate does not retroactively rewrite a load's
  already-agreed economics — treat these four columns as the load's frozen
  financial terms, not a live join back to `carriers.dispatch_fee_bps` /
  `dispatcher_profiles.commission_bps`.
- `loads.dispatcher_commission_basis` (`dispatch_fee_amount` |
  `carrier_gross_rate` | `commissionable_base`) determines what the
  commission percentage above is a percentage *of* — this needs to be read
  before computing dispatcher payout from a load.
- `permits.cost_cents` and `escorts.cost_cents` are real out-of-pocket costs
  tied to a load (both `CHECK (>= 0)`, both default `0`) — these are
  candidates for whatever "load-level expense" rollup the finance domain
  builds, distinct from `rate_confirmation_acceptances.rated_amount_cents`
  and `routes.estimated_toll_cents`, which are unconstrained
  snapshots/estimates, not authoritative charges (see "Money" above — do not
  treat a negative value in either of those two as a data-integrity bug, the
  schema permits it deliberately).
- `rate_confirmation_acceptances.document_sha256` pins the exact PDF bytes
  the carrier accepted, alongside `rated_amount_cents` — this is the
  evidentiary record if a rate dispute arises after invoicing; it is not
  itself an invoice or payment.
- Nothing in this domain creates an invoice, a payment, or an expense record
  — those tables belong to whichever domain owns `finance.ts`. `loads` is
  the thing an invoice line item will reference, via `load_id`, from that
  other domain — this domain does not declare that reverse FK (a table this
  domain does not own cannot be altered here).
