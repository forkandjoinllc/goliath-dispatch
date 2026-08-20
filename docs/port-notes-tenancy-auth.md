# Port notes — Tenancy & Auth domain

Covers `tenant.ts`, `auth.ts` and `platform.ts` from the PostgreSQL/Drizzle
source. Follows the conventions in `docs/mysql-port.md`; this file records the
decisions specific to this domain's tables.

## Files owned

- `database/schema/01_tenancy_auth_tables.sql` — 26 tables, no foreign keys.
- `database/schema/80_tenancy_auth_foreign_keys.sql` — all FKs among this
  domain's own tables.
- `database/schema/91_tenancy_auth_triggers.sql` — the `audit_events`
  append-only guard.
- `database/migrations/2026_08_20_000001_create_tenancy_and_auth_tables.php`
- `app/Enums/{Locale,Role,UserStatus,TenantStatus,SubscriptionStatus,ConsentType,CommissionBasis,JobStatus,AuditAction}.php`

Table count: 26, matching the assignment exactly (`tenants`,
`tenant_branding`, `tenant_settings`, `saas_plans`, `tenant_subscriptions`,
`equipment_types`, `users`, `user_tenant_memberships`, `permissions`,
`role_permissions`, `user_permission_overrides`, `sessions`,
`mfa_configurations`, `verification_tokens`, `consent_records`,
`impersonation_sessions`, `login_attempts`, `rate_limit_buckets`, `leads`,
`quote_requests`, `audit_events`, `export_jobs`, `legal_holds`,
`retention_jobs`, `job_queue`, `idempotency_keys`).

## How the SQL CHECK lists and PHP enums were kept in sync

Both were generated from a single source of truth instead of being typed
twice by hand:

1. A Python script parsed `src/db/schema/_shared.ts` with a regex over every
   `export const xEnum = pgEnum('x', [...])` declaration and extracted the
   exact value arrays (`/tmp/portgen/enums.json` — scratch, not committed).
2. For each of the nine enums this domain uses, the script emitted the
   PHP backed-enum file directly (`app/Enums/*.php`), converting each value to
   a PascalCase case name (e.g. `past_due` -> `PastDue`,
   `auth.password_reset_requested` -> `AuthPasswordResetRequested`) and
   keeping the string value byte-for-byte as the source array.
3. The same extracted value arrays were used to hand-assemble the SQL
   `CHECK (col IN (...))` lists in `01_tenancy_auth_tables.sql`.
4. A verification script then re-parsed both the committed SQL file and the
   committed PHP files and asserted, constraint by constraint, that the
   ordered value list matched exactly. All 17 CHECK constraints (9 distinct
   enums, some reused across columns/tables) passed byte-for-byte before this
   was reported done. `php -l` was run against every generated enum file.

The nine enums used in this domain: `Locale`, `Role`, `UserStatus`,
`TenantStatus`, `SubscriptionStatus`, `ConsentType`, `CommissionBasis`,
`JobStatus`, `AuditAction` (56 cases — the largest, from `auditActionEnum`).

## Informal "enum-like" varchar columns get no CHECK

Several source columns are plain `varchar` in Drizzle with only a *comment*
documenting the intended values (not a real `pgEnum`), e.g.
`leads.status` (`// new | contacted | qualified | converted | disqualified`),
`leads.source`, `quoteRequests.status`, `exportJobs.format`,
`legalHolds.scopeType`, `retentionJobs.action`,
`userTenantMemberships`/`rolePermissions`/`userPermissionOverrides`.`scope`,
`userPermissionOverrides.effect`, `mfaConfigurations.method`,
`verificationTokens.purpose`, `equipmentTypes.category`,
`idempotencyKeys.status`. These are ported as plain `varchar` with **no**
`CHECK` constraint, because Postgres itself does not enforce them either —
adding a MySQL-side constraint the source never had would be a behavior
change, not a faithful port. Only columns backed by an actual `pgEnum` type
got a `CHECK`.

`CommissionBasis` is one such real enum (`commissionBasisEnum`, used by
`tenant_settings.dispatcher_commission_basis`) even though the task's example
list didn't name it explicitly — it's a genuine `pgEnum`, so it got the same
treatment as the eight explicitly named enums.

## The cross-domain FK example, as specified

`user_tenant_memberships.carrier_id` and `.driver_id` point at `carriers` and
`drivers`, both owned by another engineer's domain file. Per the task's own
example, these columns exist (as plain `char(36)` with their source index,
`memberships_carrier_idx`) but get **no** foreign key anywhere in this
domain's files. Referential integrity for those two columns is the
responsibility of the application layer and, eventually, that other domain's
tenant-guard triggers — not this migration set.

`audit_events.impersonation_session_id` also has no FK, but for a different
reason: the Postgres source itself declares it as a bare `uuid(...)` column
with no `.references()` call, so there was nothing to preserve — it's ported
as an unconstrained column, faithfully matching the source.

## Hash/digest columns

`sessions.token_hash` and `verification_tokens.token_hash` match the literal
`token_hash` pattern from the conventions doc and got
`char(64) charset ascii collate ascii_bin`.

`idempotency_keys.request_digest` isn't literally in the doc's example list
(`token_hash`, `sha256`, `payload_digest`, `event_hash`,
`raw_payload_digest`), but it's functionally identical — a fixed-width
hex digest used for equality comparison — so it got the same treatment for
the same reason the doc gives for the others: an `ai_ci` collation would
silently treat two digests differing only in case as equal.

## `tenant_id_uq` (tenant_id, id) — which tables got it

Applied to every table in this domain that carries a `tenant_id` column at
all, including the ones where it's nullable (`leads`, `quote_requests`,
`audit_events`, `job_queue`, `idempotency_keys`, `verification_tokens`,
`consent_records`): the rule in the task brief is unconditional ("every
tenant-owned table"), and a composite unique key over `(tenant_id, id)` is
harmless to add even where nothing currently references it — `id` alone is
already unique, so the pair trivially stays unique regardless of how many
rows have `tenant_id IS NULL` (MySQL doesn't treat NULLs as duplicates in a
unique index). This also matches the Postgres source's own
`drizzle/custom/0002_tenant_guards.sql`, which put the same composite unique
constraint on `equipment_types` (one of this domain's tables) for exactly
this purpose.

`sessions.active_tenant_id` was deliberately **not** treated as a
`tenant_id` for this rule — it names the tenant a session is currently
scoped into, not the tenant that owns the session row (a user's session isn't
tenant-owned; it can be re-scoped across tenants they belong to). `tenants`
itself is excluded for the obvious reason (it isn't owned by a tenant, it
*is* one). Truly global tables (`users`, `permissions`, `role_permissions`,
`login_attempts`, `rate_limit_buckets`, `saas_plans`, `mfa_configurations`)
have no `tenant_id` column and got nothing.

## `audit_events` — append-only

Two explicit triggers, `audit_events_no_update` / `audit_events_no_delete`,
each `SIGNAL SQLSTATE '45000'`. Postgres used one `plpgsql` function looped
over a table array (`drizzle/custom/0001_audit_immutability.sql`); MySQL
can't run dynamic SQL inside a trigger, so this is spelled out per table —
more verbose, same guarantee. Only `audit_events` is created here:
`signature_audit_events`, `load_status_history`, `financial_snapshots` and
`stripe_events` are other engineers' tables and are explicitly out of scope.

MySQL's native `datetime(3) ... on update current_timestamp(3)` column clause
(used on every `updated_at` in this domain) already gives the equivalent of
Postgres's `goliath_touch_updated_at` trigger for free, so no separate
"touch updated_at" trigger was needed — one fewer moving part than the source.

## `DELIMITER`-free trigger file, verified over PDO

`91_tenancy_auth_triggers.sql` has no `DELIMITER` directives, as required
by `DB::unprepared()`. This was proven, not assumed:

- Loading the file through the plain `mysql` CLI **without** `DELIMITER`
  fails (`ERROR 1064 ... near ''`) — the CLI naively splits on `;` and
  chokes on the semicolon inside `BEGIN ... END`. A `DELIMITER $$` scratch
  copy (not committed) was used to load it via the CLI for interactive
  testing.
- The *committed* file was then executed with a small PHP script using
  `pdo_mysql`'s `PDO::exec()` directly against the same string
  `file_get_contents()` returns — the exact code path `DB::unprepared()`
  uses — and it succeeded, creating both triggers. See verification output
  below.

## What could not be ported faithfully

Nothing in this domain's own tables required a compromise — no partial
unique indexes, no `CHECK` with subqueries, and no JSON `GIN`-style search
requirement appear in `tenant.ts`, `auth.ts` or `platform.ts`. The three
categories `docs/mysql-port.md` calls out as lossy don't come up here; they
apply to other domains' tables (e.g. customer-contact "one primary contact"
partial index, equipment scheduling overlap, `jsonb` search columns).

The only real accommodation was the cross-domain FK omission described above,
which is a structural consequence of the five-way file split, not a MySQL
limitation.

## Notes for the other domains

- `user_tenant_memberships.carrier_id` / `.driver_id` are `char(36)` columns
  with no FK. If your domain owns `carriers` / `drivers`, your own
  `8x_*_foreign_keys.sql` (or a later tenant-guard trigger file) is the
  right place to either add the FK yourself (pointing the other direction is
  not possible — the column lives in my table) or add a tenant-consistency
  trigger the way `0002_tenant_guards.sql` did in Postgres. I did not add
  anything on my side beyond the plain column and its existing
  `memberships_carrier_idx` index.
- `audit_events`, `export_jobs`, `legal_holds`, `retention_jobs`, `leads`,
  `quote_requests` all carry the `retention` shape (`archived_at`,
  `purge_eligible_at`, `legal_hold`) or `auditable` (soft delete) — any
  cross-domain retention/purge job you write against these can rely on those
  columns existing with those exact names and types (`datetime(3)` /
  `tinyint(1)`).
- Every enum this domain owns is mirrored 1:1 as a backed PHP enum in
  `app/Enums/`. If your domain needs one of these values (e.g. `Role` or
  `AuditAction`) in application code, reuse `App\Enums\Role` /
  `App\Enums\AuditAction` rather than redeclaring the list.

## Verification performed

```
mysql -uroot -proot -e "drop database if exists t1; create database t1 character set utf8mb4 collate utf8mb4_0900_ai_ci;"
mysql -uroot -proot t1 < database/schema/01_tenancy_auth_tables.sql   # applies cleanly, 26 tables
mysql -uroot -proot t1 < database/schema/80_tenancy_auth_foreign_keys.sql
php pdo_test.php   # PDO::exec() of the committed 91_tenancy_auth_triggers.sql — succeeded
```

Constraint checks (see final report for full output):
- invalid `tenants.status` value -> `Check constraint 'tenants_status_chk' is violated`
- `UPDATE`/`DELETE` on `audit_events` -> `audit_events is append-only; ... is not permitted`
- duplicate `(tenant_id, code)` on `equipment_types` -> `Duplicate entry ... for key 'equipment_types_tenant_code_uq'`
- negative `saas_plans.monthly_price_cents` -> `Check constraint 'saas_plans_monthly_price_cents_nonneg' is violated`
- out-of-range bps on `tenant_settings` -> `Check constraint 'tenant_settings_carrier_dispatch_fee_bps_range' is violated`
- `sessions.token_hash` case-sensitivity: two hashes differing only in case both insert successfully (ascii_bin), a true same-case duplicate is rejected
- deleting a `tenants` row cascades to `tenant_branding` (`ON DELETE CASCADE` verified)
- `down()` migration logic drops both triggers and all 26 tables cleanly with zero FK errors, in the reverse-dependency order listed in the migration file
