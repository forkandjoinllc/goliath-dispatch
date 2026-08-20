# Port notes — Finance / Messaging / Tracking domain

Source: `src/db/schema/finance.ts`, `messaging.ts`, `tracking.ts` (+ shared
helpers/enums in `_shared.ts`). Target: MySQL 8.0.46 / Laravel, following the
conventions in `docs/mysql-port.md`.

This is the last of the five domains to land, and the most financially
sensitive: `financial_snapshots` is the immutable ledger that keeps historic
money reproducible after fee percentages change, and `stripe_events` is the
idempotency guard against double-processing a webhook.

## Files

- `database/schema/05_finance_messaging_tracking_tables.sql` — 22 tables, no
  foreign keys.
- `database/schema/84_finance_messaging_tracking_foreign_keys.sql` — every FK
  for this domain, applied after all domains' table files.
- `database/schema/95_finance_messaging_tracking_triggers.sql` — the two
  tamper-evident guards (`financial_snapshots`, `stripe_events`), no
  `DELIMITER`.
- `database/migrations/2026_08_20_000005_create_finance_messaging_tracking_tables.php`
  — thin wrapper, `down()` genuinely reverses (triggers, then tables in
  reverse dependency order, with `foreign_key_checks` off so partial-`up()`
  states also clean up).
- `app/Enums/ExpenseStatus.php`, `ExpenseTreatment.php`, `InvoiceStatus.php`,
  `PaymentMethod.php`, `PaymentStatus.php`, `NotificationChannel.php`,
  `NotificationStatus.php`, `TrackingProvider.php`, `TrackingEventType.php`
  — new, 9 enums.
- `app/Enums/CommissionBasis.php`, `Locale.php`, `Role.php` — **not created**,
  already existed (`CommissionBasis` from the loads domain, `Locale` and
  `Role` from tenancy/auth); reused as-is for
  `financial_snapshots.dispatcher_commission_basis` /
  `dispatcher_commissions.basis`, `notification_templates.locale` /
  `notifications.locale`, and `conversation_participants.role`
  respectively. Values match exactly (verified, see below).

## Table count: 22

expense_categories, expenses, financial_snapshots, dispatcher_commissions,
invoices, invoice_line_items, payments, payment_attempts, stripe_events,
carrier_settlements, carrier_settlement_lines, conversations,
conversation_participants, messages, message_attachments,
notification_templates, notification_preferences, notifications,
integration_connections, tracking_sessions, tracking_events,
public_tracking_links.

Verified: `select count(*) from information_schema.tables where
table_schema='t5'` = **22** immediately after loading only
`05_finance_messaging_tracking_tables.sql` into an empty scratch database.

## How CHECK lists and PHP enums are guaranteed to match

Each enum value list was copied once, by hand, directly out of the relevant
`pgEnum(...)` array literal in `_shared.ts` into the `CHECK (col IN (...))`
clause, and the new PHP enum cases were generated from that same literal
(snake_case value → PascalCase case name, matching the convention already
used by the four existing enum files).

That hand-transcription step is exactly where drift could sneak in, so it
wasn't left to eyeballing: `/tmp/verify_enum_parity5.php` (not committed —
throwaway checker, reproducible from the two source files any time;
`vendor/` isn't installed in this tree so it parses the PHP enum files by
regex instead of via reflection/autoload, which is an equally exact check of
the literal `case Foo = 'foo'` text) parses every `constraint chk_..._<col>
check (<col> in (...))` clause out of `05_finance_messaging_tracking_tables.sql`
and asserts exact set equality — not "PHP is a superset of SQL" or vice
versa — against the corresponding enum. Result, all 19 CHECK↔enum pairs
match:

```
chk_expense_categories_treatment                       ExpenseTreatment.php     MATCH (4 values)
chk_expenses_treatment_snapshot                         ExpenseTreatment.php     MATCH (4 values)
chk_expenses_status                                     ExpenseStatus.php        MATCH (4 values)
chk_financial_snapshots_dispatcher_commission_basis     CommissionBasis.php      MATCH (3 values)
chk_dispatcher_commissions_basis                        CommissionBasis.php      MATCH (3 values)
chk_invoices_status                                     InvoiceStatus.php        MATCH (8 values)
chk_payments_method                                     PaymentMethod.php        MATCH (7 values)
chk_payments_status                                     PaymentStatus.php        MATCH (8 values)
chk_payment_attempts_method                             PaymentMethod.php        MATCH (7 values)
chk_payment_attempts_status                             PaymentStatus.php        MATCH (8 values)
chk_conversation_participants_role                      Role.php                 MATCH (6 values)
chk_notification_templates_channel                      NotificationChannel.php  MATCH (3 values)
chk_notification_templates_locale                       Locale.php               MATCH (2 values)
chk_notifications_channel                               NotificationChannel.php  MATCH (3 values)
chk_notifications_status                                NotificationStatus.php   MATCH (6 values)
chk_notifications_locale                                Locale.php               MATCH (2 values)
chk_tracking_sessions_provider                          TrackingProvider.php     MATCH (5 values)
chk_tracking_events_provider                            TrackingProvider.php     MATCH (5 values)
chk_tracking_events_event_type                          TrackingEventType.php    MATCH (13 values)
```

Every other `CHECK` in the file (`chk_expenses_amount_cents`,
`chk_financial_snapshots_carrier_dispatch_fee_bps`,
`chk_financial_snapshots_dispatcher_commission_bps`,
`chk_dispatcher_commissions_percentage_bps`, `chk_invoices_total_cents`,
`chk_invoices_amount_paid_cents`, `chk_invoice_line_items_amount_cents`,
`chk_payments_amount_cents`) is a money `>= 0` guard or a basis-points
`BETWEEN 0 AND 10000` guard, not an enum-parity pair — accounted for
separately below.

## Enums NOT given a CHECK/PHP pair

Several `varchar` columns in the source carry a comment listing valid values
but are **not** `pgEnum`-typed in Drizzle, so — matching the precedent set
by the other three domains exactly — they were ported as plain `varchar`
with no `CHECK` and no PHP backed enum:
`dispatcher_commissions.status` (accrued|approved|paid|voided),
`carrier_settlements.status` (draft|issued|paid|voided),
`invoice_line_items.kind` (dispatch_fee|expense|adjustment|credit),
`conversations.kind` (direct|load|broadcast),
`messages.origin` (user|system),
`integration_connections.category` (tracking|maps|fmcsa|ocr|email|sms|payments|tolls),
`integration_connections.health_status` (unknown|healthy|degraded|failing),
`tracking_sessions.health_status` (unknown|healthy|stale|lost|ended),
`stripe_events.processing_status` (received|processed|ignored|failed).

## `financial_snapshots`: the immutable calculation ledger

Source comment, preserved verbatim as the table's leading comment: "Every
change to any input writes a new row; rows are never updated, so historical
results stay reproducible even after tenant settings, fee percentages or
category treatments change."

The guard (`95_finance_messaging_tracking_triggers.sql`) follows the
tamper-evident shape already established by `signature_records`
(carriers/documents/signatures domain), not the fully append-only shape used
by `audit_events`/`load_status_history`: `DELETE` is refused outright by
`trg_financial_snapshots_no_delete`; `UPDATE` is refused by
`trg_financial_snapshots_guard_update` only if one of nine protected columns
changes — `load_id`, `version`, and the seven money columns
`customer_charge_cents`, `carrier_gross_rate_cents`,
`commissionable_base_cents`, `dispatch_fee_amount_cents`,
`net_carrier_settlement_cents`, `gross_margin_cents`,
`dispatcher_commission_amount_cents`. Every other column — the bps/basis
inputs, the expense breakdown, `reason`, `computed_by_user_id`,
`computed_at`, and critically the retention columns `archived_at`,
`purge_eligible_at`, `legal_hold` — stays freely updatable, exactly as the
task specified, so the archival job can do its work without bypassing the
guard.

`financial_snapshots_load_version_uq (load_id, version)` is kept exactly as
named — it is what lets the application always ask for "the latest version
for this load" deterministically.

Verified end to end (real fixture, real error output — see full transcript
below): `DELETE` refused, `UPDATE` changing `dispatch_fee_amount_cents`
refused, `UPDATE` setting only `archived_at` accepted, negative
`gross_margin_cents` accepted on insert (no `CHECK` exists for it — see
Money section).

## `stripe_events`: the webhook idempotency ledger

Source comment, preserved verbatim: "Stripe webhook ledger — the idempotency
guard for event replay."

Same tamper-evident shape: `DELETE` refused outright by
`trg_stripe_events_no_delete`; `UPDATE` refused by
`trg_stripe_events_guard_update` only if `stripe_event_id`, `event_type` or
`payload_digest` changes. `processing_status`, `processed_at`, `attempts`
and `error_message` remain updatable — that is literally how webhook
idempotency is recorded: a retried delivery finds the existing row by
`stripe_events_event_id_uq` and advances its processing state rather than
inserting a duplicate.

### `stripe_events.tenant_id`: nullable, handled explicitly

The source declares `tenantId: uuid('tenant_id').references(() =>
tenants.id, { onDelete: 'cascade' })` with **no** `.notNull()` — a webhook
can legitimately arrive before the application has resolved which tenant it
belongs to (e.g. a Connect-account-level event that must be looked up via
`stripe_event_id`/account metadata first, or an event for a not-yet-fully-
provisioned tenant). This was ported faithfully:

- `tenant_id char(36) null` (only nullable tenant_id column in this domain).
- The foreign key (`fk_stripe_events_tenant`,
  `84_finance_messaging_tracking_foreign_keys.sql`) is declared on that
  nullable column with `on delete cascade`, mirroring the source's option
  exactly — MySQL permits an FK on a nullable column; a NULL value simply
  has nothing to check, and the constraint applies normally once the row is
  backfilled with a real tenant id.
- `stripe_events_tenant_id_uq (tenant_id, id)` is still declared, for
  structural consistency with the rule that every tenant-owned table in this
  port carries it — but it is **not load-bearing** here the way it is
  elsewhere: nothing in this schema needs to compound-reference
  `stripe_events` via `(tenant_id, id)`, and MySQL never treats two `NULL`
  values in a unique index as duplicates, so any number of still-unresolved
  (`tenant_id IS NULL`) rows coexist safely under it — the table's own
  primary key already guarantees `id` uniqueness regardless. The real
  idempotency guarantee is `stripe_events_event_id_uq (stripe_event_id)`.

Verified: duplicate `stripe_event_id` rejected
(`ERROR 1062 ... stripe_events_event_id_uq`), `UPDATE` changing `event_type`
rejected, `UPDATE` advancing `processing_status`/`attempts`/`processed_at`
accepted.

## Money: which `cents` columns get a `CHECK (>= 0)`

Per the task's explicit list, exactly **five** columns in this domain get
the non-negative guard: `expenses.amount_cents`, `invoices.total_cents`,
`invoices.amount_paid_cents`, `payments.amount_cents`,
`invoice_line_items.amount_cents`.

Every other `cents`-typed column — including several that might intuitively
look like they should never go negative — is left as plain signed `bigint`
with no floor, matching the precedent set by the loads/routes/permits domain
(where `routes.estimated_toll_cents` and
`rate_confirmation_acceptances.rated_amount_cents` were deliberately left
unconstrained for the identical reason: the task's explicit column list is
authoritative, not intuition about which columns "feel" non-negative).
Concretely, left unconstrained in this domain:
`financial_snapshots.customer_charge_cents`,
`financial_snapshots.carrier_gross_rate_cents` (even though the *load's own*
equivalent columns in `04_loads_routes_permits_tables.sql` **do** carry
`CHECK (>= 0)` — the snapshot columns are not in this domain's explicit
list, so they are ported without one),
`financial_snapshots.commissionable_base_cents`,
`financial_snapshots.dispatch_fee_amount_cents`,
`financial_snapshots.net_carrier_settlement_cents`,
`financial_snapshots.gross_margin_cents`,
`financial_snapshots.dispatcher_commission_amount_cents`,
`dispatcher_commissions.basis_amount_cents`/`amount_cents`,
`invoices.subtotal_cents`/`adjustments_cents`/`balance_cents`,
`invoice_line_items.unit_amount_cents` (a negative unit amount is exactly
what a `kind = 'credit'` line item needs),
`payments.refunded_amount_cents`, `carrier_settlements.*`,
`carrier_settlement_lines.*`.

`gross_margin_cents` and `net_carrier_settlement_cents` in particular are
called out explicitly in the task brief as **deliberately unconstrained**: a
load sold below cost, or a carrier whose deductions exceed their rate, are
legitimate negative business events, not data-integrity bugs. Verified by
inserting a `financial_snapshots` row with `gross_margin_cents = -50000` —
accepted (see transcript below).

Basis points get `CHECK (BETWEEN 0 AND 10000)` universally, independent of
the cents-column list above:
`financial_snapshots.carrier_dispatch_fee_bps`,
`financial_snapshots.dispatcher_commission_bps`,
`dispatcher_commissions.percentage_bps`.

## Idempotency and dedupe keys

Every key from the task brief is present, named exactly as specified:

- `notifications_dedupe_uq (dedupe_key, user_id, channel)` — stops the daily
  expiry sweep from re-notifying every morning. Verified: same
  `(dedupe_key, user_id, channel)` triple rejected with
  `ERROR 1062 ... notifications.notifications_dedupe_uq`.
- `payment_attempts_idempotency_uq (idempotency_key)`.
- `tracking_events_provider_ref_uq (provider, raw_provider_reference)`.
- `public_tracking_links_token_uq (token_hash)`.
- `tracking_sessions_provider_uq (provider, provider_session_id)` (also
  carried over, same pattern).
- `stripe_events_event_id_uq (stripe_event_id)` — see above.
- `notifications_user_unread_idx (tenant_id, user_id, read_at)` — backs the
  notification bell.
- `invoices_due_idx (tenant_id, due_date)` — backs the overdue sweep.
- `tracking_events_session_idx (session_id, occurred_at)` — backs the event
  timeline.
- `public_tracking_links_expiry_idx (expires_at)` — backs the link-expiry
  job.

All kept, none renamed.

## Hash/token columns

`message_attachments.sha256`, `stripe_events.payload_digest`,
`public_tracking_links.token_hash` are all `char(64) charset ascii collate
ascii_bin`, per `docs/mysql-port.md`. `stripe_events.payload_digest` is
nullable (source: `varchar('payload_digest', { length: 64 })` with no
`.notNull()` — the digest is only computed once the payload is captured, and
early "received but not yet processed" rows may not have one yet).
`public_tracking_links.token_hash` is a security boundary — an
accent-insensitive collation would let two distinct tokens collide in the
unique index; `ascii_bin` keeps it case- and accent-sensitive.

## `integration_connections.credentials_encrypted`

`text`, matching the source's envelope-encrypted ciphertext blob, and left
as `text` rather than narrowed to a fixed-length `varchar` — the encrypted
payload's length varies with the credential type (API key vs. OAuth token
pair vs. certificate).

## JSON columns and generated columns

`expense_breakdown` (financial_snapshots), `system_params` (messages),
`available_tokens` (notification_templates), `config`
(integration_connections), `raw_payload` (tracking_events), `payload`
(stripe_events) all became plain `json` columns. **None of them needed a
generated column**: the source never defines an index into any of these
JSON blobs in `finance.ts`/`messaging.ts`/`tracking.ts` — they are
read/written whole by the application, not queried by a JSON path. This
matches the precedent set by the loads/routes/permits domain's JSON columns.

## Comments preserved

- `financial_snapshots`: "Immutable calculation history. Every change to any
  input writes a new row; rows are never updated, so historical results stay
  reproducible even after tenant settings, fee percentages or category
  treatments change." — kept as the leading comment; this is the load-bearing
  rationale for the whole immutability guard.
- `financial_snapshots.expense_breakdown`: "Every expense that fed this
  snapshot, by id and treatment." — kept.
- `stripe_events`: "Stripe webhook ledger — the idempotency guard for event
  replay." — kept.
- `invoices`: "Goliath Dispatch invoices the CARRIER for the dispatch fee." —
  kept; clarifies this is not a customer-facing invoice table.
- `carrier_settlements.factoring_submitted_at`: "Manual factoring: the
  platform records, it does not fund." — kept.
- `notification_templates`: "Event-driven. New event types are added to the
  catalog, not to the delivery pipeline — templates and preferences resolve
  by event_key at send time." — kept.
- `notifications.dedupe_key`: "Stable key that makes repeat sweeps
  idempotent." — kept.
- `integration_connections.credentials_encrypted`: "Envelope-encrypted
  credential blob. Never returned to the client." — kept.
- `tracking_sessions.consent_granted_at`: "No location is ingested until
  consent is recorded." — kept.
- `tracking_events.raw_provider_reference`: "Provider's own event id — the
  idempotency key for ingestion." — kept.
- `public_tracking_links`: "Customers have no accounts; they receive a
  signed, expiring link that exposes a deliberately narrow projection of one
  load." — kept verbatim as the table's leading comment; this is the
  deliberately-narrow-projection note the task specifically called out.
- `expense_categories.treatment`: "Drives the money formulas — see
  docs/port-notes-finance-messaging-tracking.md." (re-pointed from the
  source's `docs/architecture.md` reference, since that document doesn't
  exist in this tree).

## Foreign keys

Single-column FKs mirroring each `.references()` call 1:1, `on delete`
copied from the `onDelete` option (absent → `restrict`, matching Postgres'
default `NO ACTION`), same convention every prior domain used.

Columns with **no** foreign key, because the source itself declares them as
plain `uuid`/`char(36)` with no `.references()` call:
`tracking_events.stop_id` (the source's `stopId: uuid('stop_id')` carries no
`.references()` — a load's stops are not necessarily resolvable when a
tracking event is ingested from a provider webhook, so the app resolves this
loosely, same pattern as `loads.duplicated_from_load_id` in the loads
domain).

Cross-domain FK targets and where they live:

| Column(s) | Target table | Owning domain file |
|---|---|---|
| `*.tenant_id` | `tenants` | `01_tenancy_auth_tables.sql` |
| `*.*_user_id` | `users` | `01_tenancy_auth_tables.sql` |
| `expenses.carrier_id`, `invoices.carrier_id`, `carrier_settlements.carrier_id` | `carriers` | `02_carriers_documents_signatures_tables.sql` |
| `expenses.receipt_document_id`, `invoices.pdf_document_id`, `carrier_settlements.pdf_document_id` | `documents` | `02_carriers_documents_signatures_tables.sql` |
| `carrier_settlements.factoring_company_id` | `factoring_companies` | `02_carriers_documents_signatures_tables.sql` |
| `invoices.customer_id` | `customers` | `03_equipment_drivers_customers_tables.sql` |
| `tracking_sessions.driver_id` | `drivers` | `03_equipment_drivers_customers_tables.sql` |
| `tracking_sessions.truck_id` | `trucks` | `03_equipment_drivers_customers_tables.sql` |
| `expenses.load_id`, `financial_snapshots.load_id`, `dispatcher_commissions.load_id`, `invoices.load_id`, `invoice_line_items.load_id`, `carrier_settlement_lines.load_id`, `conversations.load_id`, `tracking_sessions.load_id`, `tracking_events.load_id`, `public_tracking_links.load_id` | `loads` | `04_loads_routes_permits_tables.sql` |

By the time this domain's verification ran, all four other domains'
`0X_*_tables.sql` files had already landed, so **every** foreign key above —
not just the ones into `01_*`/`02_*` — was proven against real tables, not
stubs. See the verification transcript below.

Total foreign keys in this domain's file: **67** (`select count(*) from
information_schema.key_column_usage where table_schema='t5' and
referenced_table_name is not null and table_name in (<these 22 tables>)` =
67, checked against a fresh independent full apply, not just the `t5`
session used for the trigger/constraint tests).

## Verification (scratch database `t5`, never `goliath`/`goliath_test`)

### 1. Clean apply from empty

```
mysql -uroot -proot -e "drop database if exists t5; create database t5 character set utf8mb4 collate utf8mb4_0900_ai_ci;"
mysql -uroot -proot t5 < database/schema/05_finance_messaging_tracking_tables.sql
```
→ succeeds with no output (no errors).

```
mysql -uroot -proot t5 -e "select count(*) from information_schema.tables where table_schema='t5';"
```
→ `22`.

### 2. Full cross-domain apply, fixed numeric order, fresh `t5`

```
01_tenancy_auth_tables.sql                          -> OK
02_carriers_documents_signatures_tables.sql          -> OK
03_equipment_drivers_customers_tables.sql            -> OK
04_loads_routes_permits_tables.sql                   -> OK
05_finance_messaging_tracking_tables.sql             -> OK
80_tenancy_auth_foreign_keys.sql                     -> OK
81_carriers_documents_signatures_foreign_keys.sql     -> OK
82_equipment_drivers_customers_foreign_keys.sql       -> OK
83_loads_routes_permits_foreign_keys.sql              -> OK
84_finance_messaging_tracking_foreign_keys.sql        -> OK
```

No collisions, no ordering problems — every domain's `0X_*_tables.sql`
loaded before any `8X_*_foreign_keys.sql`, and this domain's FKs into
`loads`, `carriers`, `documents`, `factoring_companies`, `customers`,
`drivers`, `trucks`, `tenants`, `users` all resolved against real tables on
the first try. Nothing in another domain's files broke this apply.

```
select count(*) from information_schema.tables where table_schema='t5';
```
→ **92** (13 + 25 + 10 + 13 + 22 = 92 owned across the five domains).

```
select count(*) from information_schema.key_column_usage
  where table_schema='t5' and referenced_table_name is not null;
```
→ **246** total foreign keys across the combined schema (this domain
contributes 67 of them — verified separately on an independent fresh apply,
see "Foreign keys" above).

### 3. Trigger file loads over PDO (not just the CLI)

Loading `95_finance_messaging_tracking_triggers.sql` via `mysql t5 < file`
(the CLI, batch mode, no `DELIMITER`) **fails**, exactly as the other four
domains' port notes predict:
```
ERROR 1064 (42000) at line 35: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '' at line 6
```
Expected — this demonstrates the DELIMITER problem the CLI has with a
multi-statement trigger body when no `DELIMITER` command is present, and is
not how the migration actually loads the file. (Confirmed the same failure
mode reproduces on all five domains' trigger files run through the CLI in
this same session, not just this one.)

The real target — `PDO::exec()` on the entire file contents in one call,
exactly what `DB::unprepared(file_get_contents(...))` does — succeeds, run
alongside all four other domains' trigger files to prove nothing about this
file depends on load order within the 9X range:

```php
$pdo = new PDO('mysql:host=127.0.0.1;dbname=t5;charset=utf8mb4', 'root', 'root',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
foreach ([
    '91_tenancy_auth_triggers.sql',
    '92_carriers_documents_signatures_triggers.sql',
    '93_equipment_drivers_customers_triggers.sql',
    '94_loads_routes_permits_triggers.sql',
    '95_finance_messaging_tracking_triggers.sql',
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
95_finance_messaging_tracking_triggers.sql -> OK
```
Confirmed present via `information_schema.triggers`:
```
trg_financial_snapshots_guard_update  | BEFORE | UPDATE | financial_snapshots
trg_financial_snapshots_no_delete     | BEFORE | DELETE | financial_snapshots
trg_stripe_events_guard_update        | BEFORE | UPDATE | stripe_events
trg_stripe_events_no_delete           | BEFORE | DELETE | stripe_events
```

`down()` was simulated the same way against the fully-loaded `t5`: dropping
this domain's 4 triggers, then all 22 tables in reverse order with
`foreign_key_checks = 0`, took the schema from 92 tables to 70 tables — an
exact drop of 22, confirming `down()` genuinely reverses `up()` without
disturbing the other four domains' 70 tables. Trigger count after the drop:
9 (2 `audit_events` + 2 `signature_audit_events` + 2 `signature_records` + 1
`customers` cascade-delete-contacts + 2 `load_status_history`) — exactly the
other four domains' triggers, none of this domain's four remaining.

### 4. Constraints bite

Fixture: one tenant (`Acme Dispatch`), one user (`dispatcher@acme.test`),
one customer (`Shipper Co`), one load (`GD-2001`).

**`financial_snapshots` — DELETE refused:**
```
ERROR 1644 (45000): financial_snapshots cannot be deleted: it is the immutable calculation ledger
```

**`financial_snapshots` — UPDATE changing `dispatch_fee_amount_cents` refused:**
```
ERROR 1644 (45000): financial_snapshots is immutable: load/version/computed money columns cannot change
```

**`financial_snapshots` — UPDATE setting only `archived_at` accepted:**
```
id                                     archived_at
55555555-5555-5555-5555-555555555555  2026-08-20 00:51:11.382
```

**`stripe_events` — duplicate `stripe_event_id` refused:**
```
ERROR 1062 (23000): Duplicate entry 'evt_123' for key 'stripe_events.stripe_events_event_id_uq'
```

**`stripe_events` — UPDATE changing `event_type` refused:**
```
ERROR 1644 (45000): stripe_events is tamper-evident: event id/type/digest cannot change once written
```

**`stripe_events` — UPDATE advancing `processing_status`/`attempts` accepted:**
```
id                                     processing_status  attempts
66666666-6666-6666-6666-666666666666  processed           1
```

**Negative `expenses.amount_cents` — rejected:**
```
ERROR 3819 (HY000): Check constraint 'chk_expenses_amount_cents' is violated.
```
(attempted value: `-100`)

**Negative `financial_snapshots.gross_margin_cents` — accepted (deliberate
absence of a `CHECK`):**
```
id                                     gross_margin_cents
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa  -50000
```

**Duplicate `notifications.dedupe_key` + `user_id` + `channel` — rejected:**
```
ERROR 1062 (23000): Duplicate entry 'load:44444444-4444-4444-4444-444444444444:status-22222222-2222-2' for key 'notifications.notifications_dedupe_uq'
```

### 5. Enum/CHECK parity

`/tmp/verify_enum_parity5.php` (not committed): all 19 `CHECK ... IN (...)`
enum-parity pairs match exactly (see section above for the full table); the
remaining 8 `CHECK` constraints in the file are money `>= 0` or bps
`BETWEEN` guards, not enum pairs, and are enumerated there too so nothing is
silently unaccounted for.

## Nothing to report from other domains

No collision or ordering problem was found in any other domain's files
during the combined apply — `01`–`04` tables, `80`–`83` foreign keys, and
`91`–`94` triggers all loaded cleanly, in order, before this domain's own
files were added on top. The combined table count (92) and the combined
trigger count after this domain's tables/triggers were dropped again (70
tables / 9 triggers) both match exactly what the other four domains'
already-committed port notes claim for themselves.
