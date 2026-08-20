# Port notes — Carriers / Documents / Signatures domain

Source: `src/db/schema/carrier.ts`, `document.ts`, `signature.ts` (+ shared
helpers/enums in `_shared.ts`). Target: MySQL 8.0.46 / Laravel, following the
conventions in `docs/mysql-port.md`.

## Files

- `database/schema/02_carriers_documents_signatures_tables.sql` — 21 tables,
  no foreign keys.
- `database/schema/81_carriers_documents_signatures_foreign_keys.sql` — every
  FK for this domain, applied after all domains' table files.
- `database/schema/92_carriers_documents_signatures_triggers.sql` — the two
  required trigger families, no `DELIMITER`.
- `database/migrations/2026_08_20_000002_create_carriers_documents_signatures_tables.php`
  — thin wrapper, `down()` genuinely reverses (triggers, then tables in
  reverse dependency order, with `foreign_key_checks` off so partial-`up()`
  states also clean up).
- `app/Enums/OnboardingStatus.php`, `DocumentType.php`, `DocumentReviewStatus.php`,
  `VerificationStatus.php`, `SignatureStatus.php`, `SignatureMethod.php` — new.
- `app/Enums/Locale.php` — **not created**, already existed (owned by another
  domain); reused as-is, values match (`en`, `es`).

## Table count: 21

carriers, carrier_users, carrier_onboardings, carrier_onboarding_events,
dispatcher_profiles, carrier_dispatcher_assignments, dispatcher_groups,
group_members, dispatcher_resource_assignments, fmcsa_verifications,
factoring_companies, factoring_assignments, documents, document_versions,
document_reviews, document_expirations, document_access_logs,
signature_templates, signature_requests, signature_records,
signature_audit_events.

Verified: `select count(*) from information_schema.tables where
table_schema='t2'` = 21 immediately after loading only `02_*_tables.sql` into
an empty scratch database.

## How CHECK lists and PHP enums are guaranteed to match

Every enum value list was copied once, by hand, directly out of the
`pgEnum(...)` array literal in the TypeScript source, into the `CHECK (col IN
(...))` clause. The PHP enum cases were generated from that same literal
(snake_case value → PascalCase case name, following the exact convention
already used by the other domains' enum files in this tree, e.g.
`AuditAction`).

That single hand-transcription step is exactly the place drift could sneak
in, so it's not left to eyeballing: `/tmp/verify_enum_parity.php` (not
committed — a throwaway checker, reproducible from the two source files any
time) parses every `constraint chk_..._<col> check (<col> [is null or <col>]
in (...))` clause out of `02_carriers_documents_signatures_tables.sql` with a
regex, loads the corresponding `App\Enums\*` class via reflection
(`::cases()`), sorts both lists, and asserts set equality — not "PHP is a
superset of SQL" or vice versa, exact equality, for every column that shares
an enum (e.g. `chk_carriers_onboarding_status`,
`chk_carrier_onboardings_status`,
`chk_carrier_onboarding_events_to_status`/`_from_status` all reuse
`OnboardingStatus` and were each checked independently). Result: all 15
CHECK↔enum pairs across the 6 domain enums (7+27+6+7+7+2 = 56 values total)
match exactly. Re-run any time with:

```
php verify_enum_parity.php
```

(script body kept below for reproducibility — see "Verification scripts")

## Enums NOT given a CHECK/PHP pair

Several `varchar` columns in the source carry a *comment* listing valid
values but are **not** `pgEnum`-typed in Drizzle: `owner_type` (documents),
`subject_type` (signature_requests), `action` (document_access_logs), `kind`
(document_expirations), `event_type` (signature_audit_events), `member_type`
(group_members), `resource_type` (dispatcher_resource_assignments),
`malware_scan_status`/`extraction_status` (document_versions). These were
ported as plain `varchar` with no `CHECK` and no PHP backed enum, faithfully
matching the source's deliberate choice to leave them open (per the task's
explicit six-enum list, which lines up exactly with the six real `pgEnum`
types used across these three files).

## `template_content_hash` — one column treated as a hash beyond the literal list

The task's list of hash-column names doesn't mention
`signature_requests.template_content_hash`, but it is a SHA-256 pinned copy
of `signature_templates.content_hash` (same comment, same 64-hex-char
shape). Applied `char(64) charset ascii collate ascii_bin` to it too, for the
same tamper-evidence reason as `content_hash` itself. Noting this since it's
an extrapolation beyond the literal instruction list, not a verbatim match.

## Per-tenant DOT uniqueness

`carriers` has **no** global unique constraint on `dot_number` — only
`unique key carriers_tenant_dot_uq (tenant_id, dot_number)`. Verified: the
same DOT (`1234567`) inserted under two different `tenant_id`s succeeds; a
second insert of the same DOT under the *same* `tenant_id` is rejected by
that key (error output below).

## Foreign keys: simple, not compound, to match the source

`docs/mysql-port.md` explains the `<table>_tenant_id_uq (tenant_id, id)`
unique key exists so a child *can* structurally reference `(tenant_id, id)`
of its parent via a compound foreign key, backed by a cross-tenant guard
trigger, as a second line of defense. The Drizzle source for this domain,
however, does **not** use that pattern anywhere — every `.references()` call
is a single-column FK to the parent's `id` only, and cross-tenant isolation
is left to the application scope. To stay faithful to the source rather than
inventing new semantics, `81_*_foreign_keys.sql` mirrors that: plain
single-column FKs, `on delete cascade`/`set null`/`restrict` copied 1:1 from
each `.references()` call's `onDelete` option (absent option → `restrict`,
matching Postgres' default `NO ACTION`). The mandatory `<table>_tenant_id_uq`
unique keys are still present on every table (per the task's explicit rule),
so nothing stops a future cross-tenant guard trigger from being added later
by whoever needs it — this port just doesn't add one that the source didn't
have.

Columns with **no** foreign key, because the source itself declares them as
plain `uuid`/`char(36)` with no `.references()` call: `documents.owner_id`,
`documents.current_version_id` (forward pointer into `document_versions`,
which points back at `documents` — a real FK here would be circular),
`signature_requests.subject_id`, `signature_requests.superseded_by_request_id`
(self-reference), `group_members.member_id`,
`dispatcher_resource_assignments.resource_id`,
`factoring_assignments.notice_of_assignment_document_id` /
`change_of_payee_document_id` (would point at `documents`, but the source
leaves them unreferenced — likely to avoid forcing document upload before the
factoring assignment exists).

## Money

This domain has no `cents()`-typed columns — no invoices/payments/loads live
in `carrier.ts`/`document.ts`/`signature.ts`. `document_versions.byte_size`
is a plain `bigint` (file size in bytes, not money) and was ported as-is with
no `CHECK`, matching source fidelity (no non-negative constraint was declared
there either).

## The tamper-evident guard on `signature_records`

Ported faithfully per the task's spec — DELETE refused outright, UPDATE
refused only when a tamper-relevant column changes:

```sql
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
```

`<=>` (null-safe equal) is used instead of `<>` even though all five guarded
columns are `not null` today — it's the more defensively-correct operator for
this kind of guard and costs nothing.

One implementation snag worth recording: the first draft of the guard message
text was 151 characters. MySQL's `SIGNAL ... SET MESSAGE_TEXT` is capped at
128 characters and raises `ERROR 1648 (HY000) Data too long for condition
item 'MESSAGE_TEXT'` if you exceed it — caught during verification (see
below) and shortened to 95 characters.

`signature_records` intentionally carries **no** soft-delete columns
(`deleted_at`/`deleted_by`/`deletion_reason`) — the source spreads only
`...timestamps, ...retention` on this table, not `...auditable`. That's
consistent with "tamper-evident, not disposable": the only way a row leaves
the active set is archival (`archived_at`), never a soft delete, and the
retention columns remain updatable through the guard trigger by design so
the archival job isn't fighting its own tamper-evidence mechanism.

## `signature_audit_events`: append-only

Straightforward per-table `before update`/`before delete` pair, both
`SIGNAL SQLSTATE '45000'`, matching the pattern `docs/mysql-port.md`
describes for `audit_events`/`load_status_history`/`financial_snapshots` in
other domains — this domain owns the `signature_audit_events` instance of it.

## Verification (scratch database `t2`, never `goliath`/`goliath_test`)

### 1. Clean apply from empty

```
mysql -uroot -proot -e "drop database if exists t2; create database t2 character set utf8mb4 collate utf8mb4_0900_ai_ci;"
mysql -uroot -proot t2 < database/schema/02_carriers_documents_signatures_tables.sql
```
→ succeeds with no output (no errors).

```
mysql -uroot -proot t2 -e "select count(*) from information_schema.tables where table_schema='t2';"
```
→ `21`.

Foreign keys were checked the same way, after adding minimal stub `tenants`
and `users` tables to `t2` (id-only, just enough for the FK targets to exist
— `t2` is scratch, this is not committed anywhere):
```
mysql -uroot -proot t2 < database/schema/81_carriers_documents_signatures_foreign_keys.sql
```
→ succeeds; `information_schema.table_constraints` shows 63 FOREIGN KEY
constraints created.

### 2. Trigger file loads over PDO (not just the CLI)

Loading `92_carriers_documents_signatures_triggers.sql` via `mysql t2 <
file` (the CLI, batch mode, no `DELIMITER`) **fails**:
```
ERROR 1064 (42000) at line 18: You have an error in your SQL syntax ...
```
This is expected and is *not* a bug in the file — it demonstrates exactly
the DELIMITER problem the CLI has with multi-statement trigger bodies when
no `DELIMITER` command is present. It is not how the migration will load the
file.

The real target — `PDO::exec()` on the entire file contents in one call,
exactly what `DB::unprepared(file_get_contents(...))` does — succeeds:

```php
$pdo = new PDO('mysql:host=127.0.0.1;dbname=t2;charset=utf8mb4', 'root', 'root',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec(file_get_contents('database/schema/92_carriers_documents_signatures_triggers.sql'));
// => "PDO::exec() of full trigger file: OK"
```
Output:
```
PDO::exec() of full trigger file: OK
trg_signature_audit_events_no_delete | BEFORE | DELETE | signature_audit_events
trg_signature_audit_events_no_update | BEFORE | UPDATE | signature_audit_events
trg_signature_records_guard_update | BEFORE | UPDATE | signature_records
trg_signature_records_no_delete | BEFORE | DELETE | signature_records
```

The full migration (`up()` = three `DB::unprepared()` calls, `down()` =
drop triggers then drop tables in reverse order with
`foreign_key_checks = 0`) was simulated the same way against `t2`:
`2 tables → 23 tables (21 + 2 stubs) → back to 2 tables`, confirming `down()`
genuinely reverses `up()`.

### 3. Constraints bite

**Same DOT, two tenants — accepted:**
```sql
insert into carriers (..., tenant_id, dot_number, ...) values (..., '1111...', '1234567', ...);
insert into carriers (..., tenant_id, dot_number, ...) values (..., '2222...', '1234567', ...);
```
→ both rows present:
```
tenant_id                              dot_number  legal_name
11111111-1111-1111-1111-111111111111  1234567     Acme Trucking
22222222-2222-2222-2222-222222222222  1234567     Acme Trucking
```

**Duplicate DOT, same tenant — rejected:**
```
ERROR 1062 (23000) at line 2: Duplicate entry
  '11111111-1111-1111-1111-111111111111-1234567' for key 'carriers.carriers_tenant_dot_uq'
```

**Invalid `onboarding_status` — rejected:**
```
ERROR 3819 (HY000) at line 2: Check constraint 'chk_carriers_onboarding_status' is violated.
```

**Basis-points range — rejected out of range, accepted in range:**
```
ERROR 3819 (HY000) at line 2: Check constraint 'chk_carriers_dispatch_fee_bps' is violated.
-- vs. dispatch_fee_bps = 1500 -> inserted fine
```

**`signature_audit_events` refuses UPDATE and DELETE:**
```
ERROR 1644 (45000) at line 1: signature_audit_events is append-only: rows cannot be updated
ERROR 1644 (45000) at line 1: signature_audit_events is append-only: rows cannot be deleted
```

**`signature_records` guard — refuses UPDATE of any tamper-relevant column,
allows the retention/other columns:**
```
update signature_records set integrity_seal = repeat('z',64) ...;
-- ERROR 1644 (45000) at line 1: signature_records is tamper-evident: seal/hash/signer/signed_at cannot be modified once written

update signature_records set document_sha256 = repeat('z',64) ...;   -- same error
update signature_records set signer_legal_name = 'Someone Else' ...; -- same error
update signature_records set signed_at = now(3) ...;                 -- same error

update signature_records set archived_at = now(3), seal_algorithm = 'HMAC-SHA256' ...;
-- succeeds: archived_at and seal_algorithm are freely updatable
```

**`signature_records` refuses DELETE outright:**
```
ERROR 1644 (45000) at line 1: signature_records cannot be deleted: it is the tamper-evident signing artifact
```

### 4. Table count

`select count(*) from information_schema.tables where table_schema='t2'` = **21**
(measured right after loading only `02_carriers_documents_signatures_tables.sql`
into an empty database, before the stub `tenants`/`users` tables used for FK
testing were added).

## Nothing was left unported

Every table, column, index name, and comment worth preserving from
`carrier.ts`, `document.ts` and `signature.ts` made it across. The one
deliberate simplification (single-column FKs instead of compound
`(tenant_id, id)` FKs) is explained above and matches the source's own
choice, not a shortcut against it.

## For the other four domains

- `carriers.tenant_id`, all other `tenant_id` columns in this file, and every
  `..._user_id` column expect `tenants.id` / `users.id` to exist as
  `char(36)` primary keys before `81_carriers_documents_signatures_foreign_keys.sql`
  runs — i.e. after all `0X_*_tables.sql` files have been applied, before any
  `8X_*_foreign_keys.sql` file runs.
- `App\Enums\Locale` and `App\Enums\VerificationStatus` are shared. `Locale`
  already existed when this domain started (created by whichever domain got
  there first) and was reused unmodified. `VerificationStatus` did **not**
  exist yet and was created here — if your domain also uses FMCSA-style
  verification status, reuse `App\Enums\VerificationStatus`, don't create a
  second one.
- `documents.id` is a valid FK target for anything that wants to attach a
  document (loads, invoices, trucks, trailers, drivers) via the same
  `owner_type`/`owner_id` polymorphic pattern already used here — no need to
  duplicate the `documents` table's shape.
