# Goliath Dispatch — Operations Runbook

## 1. The background job system

### Running a worker locally

```bash
npm run jobs:run                    # loops forever, draining every 25s cycle
npm run jobs:run -- --once          # drain one batch, then exit
npm run jobs:run -- --job-type=email.send   # only process one job type; anything
                                             # else claimed is released immediately
npm run jobs:run -- --tenant=<uuid> # debugging convenience: only process one
                                     # tenant's jobs, releasing everything else
```

The CLI (`src/jobs/runner-cli.ts`) claims up to 10 jobs per batch, gives
itself a 25-second wall-clock budget per `drain()` call, and sleeps 5
seconds between empty batches. `SIGINT`/`SIGTERM` request a graceful
shutdown — the in-flight batch finishes normally (each job's lease is
released by its own success/failure/dead-letter path) before the process
exits; nothing is killed mid-write.

### How cron routes work in production

There is no long-running worker process in production — Vercel Cron hits
HTTP routes instead. `vercel.json` defines eight schedules (documented in
full in `docs/deployment.md` §6); each route calls `authorizeCronRequest()`
first (`src/app/api/cron/_lib/auth.ts`), which requires
`Authorization: Bearer <CRON_SECRET>` and returns a bare 401 on any mismatch.
`/api/cron/drain` (every minute) is the general-purpose queue drain that
processes everything not already covered by one of the seven dedicated
sweep routes. Because Vercel serverless functions have a wall-clock limit,
`drain()`'s `deadlineMs` parameter stops claiming new batches once exceeded
— unfinished work simply stays `queued` (or expires its lease and gets
reclaimed) for the next minute's invocation to pick up; nothing is lost.

### Inspecting the queue

There is no admin UI for the raw queue in this release — inspect it
directly against the database (`npm run db:studio`, or `psql`):

```sql
-- What's queued right now, oldest first
select id, job_type, tenant_id, status, attempts, max_attempts, run_at, last_error
from job_queue
where status in ('queued', 'running')
order by run_at
limit 50;

-- Dead letters needing attention
select id, job_type, tenant_id, attempts, last_error, completed_at
from job_queue
where status = 'dead_letter'
order by completed_at desc
limit 50;

-- A stuck lease (a worker claimed it, then died before finishing)
select id, job_type, locked_by, locked_until
from job_queue
where status = 'running' and locked_until < now();
```

A "stuck" running row does not need manual intervention if `locked_until`
has passed — the next `drain()` call (cron or local worker) reclaims it
automatically via `reclaimExpiredLeases()`, which runs at the start of every
`drain()`. A row still shows `running` with a future `locked_until` simply
because a worker currently owns it; wait for that lease to either complete
or expire before assuming it's actually stuck.

### Retrying a dead-lettered job

There is no one-click retry UI. Requeue it manually:

```sql
update job_queue
set status = 'queued', attempts = 0, last_error = null, run_at = now(),
    locked_by = null, locked_until = null
where id = '<job-id>';
```

Only do this after understanding *why* it dead-lettered
(`last_error`) — requeuing a job whose payload fails schema validation, or
whose handler has a genuine bug, just burns through `maxAttempts` again and
lands back in `dead_letter`. If the payload itself was malformed (an
`Unknown job type` or `Payload failed schema validation` message in
`last_error`), fix the payload before requeuing, or delete the row — it will
never succeed as written.

### Job catalog

| Job type | Cadence | What it does |
|---|---|---|
| `fmcsa.reverification_sweep` | Daily, via `/api/cron/fmcsa-reverification` (06:00 UTC) | Finds carriers whose FMCSA reverification window elapsed and enqueues one `fmcsa.reverify_carrier` per carrier. |
| `fmcsa.reverify_carrier` | Enqueued by the sweep above, or on-demand | Re-verifies one carrier against FMCSA; flags a regression from a previously-clean status. |
| `carrier.fmcsa_verify` | On carrier creation | On-demand FMCSA verification for a newly created carrier. |
| `document.expiration_sweep` | Daily, via `/api/cron/document-expiration` (07:00 UTC) | Materializes warning/expired `document_expirations` rows and notifies once per row. |
| `document.ocr_extract` | On COI upload | Runs OCR on a newly uploaded COI and re-verifies every truck/trailer of that carrier against it. |
| `document.watermark_generate` | On demand | Pre-generates and caches a watermarked variant of a document version under a deterministic key. |
| `invoice.overdue_sweep` | Daily, via `/api/cron/invoice-overdue` (08:00 UTC) | Transitions `sent`/`due` invoices past due date to `overdue`, notifies once per invoice. |
| `invoice.draft_from_pod` | On load reaching `pod_received` | Idempotently creates the draft invoice for that load. |
| `pdf.generate` | On demand (invoice edits, etc.) | Re-renders and re-stores an invoice PDF as a new document version. |
| `route.evaluate` | On stop/dimension change | Recalculates a load's route and oversize evaluation. |
| `tracking.ingest_sweep` | Every 5 min, via `/api/cron/tracking-ingest` | Polls every active tracking session for new events (pull-based providers only — today, only the mock) and refreshes session health. |
| `tracking.link_expiry_sweep` | Hourly, via `/api/cron/tracking-link-expiry` | Marks public tracking links past their TTL as revoked. |
| `retention.archive_sweep` | Daily, via `/api/cron/retention-archive` (09:00 UTC) | Archives operational records past the active window, skipping anything under legal hold. |
| `retention.purge_sweep` | Weekly (Sunday), via `/api/cron/retention-purge` (10:00 UTC) | Permanently deletes `documents` and `invoices` past their purge-eligible date, and anonymizes (soft-deletes + redacts free text on) `loads` past theirs; refuses to run without explicit legal-hold-checked proof. **In `APP_ENV=production` this schedule fires every week but performs no deletion or anonymization unless the job payload carries `confirm: true`** — the cron route never sets that flag, so a production purge only happens when an operator deliberately re-enqueues the job with confirmation (§1's "retrying a dead-lettered job" pattern applies here too, but note this job usually succeeds, not dead-letters — you are re-enqueuing a *fresh* confirmed run, not retrying a failure). |
| `report-export` | On demand (report export request) | Generates the CSV/XLSX/PDF artifact for one queued `export_jobs` row under its frozen permission scope. |
| `email.send` | On demand (every transactional email) | Generic queued outbound email, retried and dead-lettered on repeated provider failure. |
| `sms.send` | On demand | Generic queued outbound SMS; short retry budget, refuses without recorded consent. |
| `notification.deliver` | On demand | Drains one queued email/SMS notification through the registered provider. |
| `stripe.webhook_replay_sweep` | Not on `vercel.json`'s schedule today — see note below | Replays payment-domain Stripe events left `received`/`failed` once payment effects are registered. |

> **Running a confirmed production purge.** `retention.purge_sweep` refuses
> to delete or anonymize anything in `APP_ENV=production` unless its payload
> carries `confirm: true` (see the table above). Trigger one deliberately
> once you've reviewed the candidates (§6 has the queries) and are ready:
>
> ```sql
> insert into job_queue (job_type, payload, max_attempts)
> values ('retention.purge_sweep', '{"confirm": true}'::jsonb, 1);
> ```
>
> Then either wait for the next `/api/cron/drain` minute, or run
> `npm run jobs:run -- --job-type=retention.purge_sweep --once` from a
> machine with production database access. Check the resulting
> `retention_jobs` rows (`action`, `candidateCount`, `processedCount`,
> `skippedLegalHoldCount`) to confirm the run did what you expected before
> considering the task done.

> **Note:** `stripe.webhook_replay_sweep` is a registered job type
> (`src/jobs/handlers/stripe-webhook-process.ts`) but is not one of the eight
> schedules in `vercel.json`. It only runs if something enqueues it — check
> whether a caller does before assuming deferred Stripe events are being
> replayed automatically in production; if nothing enqueues it, deferred
> events accumulate in `stripe_events` with `processing_status IN ('received',
> 'failed')` until manually replayed.

## 2. Monitoring

None of the following has a built-in dashboard in this release
(`src/app/[locale]/(app)/app/platform/health/page.tsx` exists but check what
it actually surfaces before assuming full coverage). Query the underlying
tables directly until a dashboard is built:

| What to watch | Query / where it's visible |
|---|---|
| Queue depth | `select status, count(*) from job_queue group by status;` — a growing `queued` count with a healthy cron means the drain rate is falling behind enqueue rate. |
| Dead letters | `select job_type, count(*) from job_queue where status = 'dead_letter' group by job_type;` — any non-zero count deserves triage (§3 below has the common causes). |
| Webhook processing lag | `select event_type, processing_status, created_at from stripe_events where processing_status in ('received', 'failed') order by created_at;` — `received` older than a few minutes with `stripe.webhook_replay_sweep` not scheduled (see above) means it needs a manual nudge. |
| Failed notifications | `select event_key, channel, failure_reason, count(*) from notifications where status = 'failed' group by 1, 2, 3;` |
| FMCSA verification staleness | `select count(*) from carriers where fmcsa_next_verification_at < now();` — should trend toward zero within a day of the daily sweep running; a persistently large number means the sweep or its downstream jobs are failing. |
| Document expirations unresolved | `select count(*) from document_expirations where resolved_at is null and kind = 'expired';` — the platform health page and `docs/architecture.md` both call this out as a metric worth watching; query it directly until it's on a dashboard. |
| Cron health | Vercel's own Cron Jobs tab (Project → Cron Jobs) shows next/last run and HTTP status per schedule — check this first for any of the above before assuming an application-level bug. |

## 3. Common incidents

**Stripe webhook failing signature verification.** The route returns 400
`invalid_signature` before touching the database (`docs/integrations.md`'s
Stripe section). Most common cause: `STRIPE_WEBHOOK_SECRET` doesn't match
the endpoint that actually sent the request — e.g. testing with the Stripe
CLI's `whsec_...` while the deployed env var still has the dashboard
endpoint's secret, or vice versa. Verify which secret belongs to which
endpoint before assuming application code regressed.

**Storage permission errors.** A 403 from S3 almost always means the IAM
policy on `S3_ACCESS_KEY_ID` doesn't cover the action being attempted —
check it against the minimal policy in `docs/deployment.md` §5. A signed
URL that 403s on the *client* side but the server logged no error usually
means `SIGNED_URL_TTL_SECONDS` expired between mint and use — check the
timestamp gap, not the IAM policy, first.

**A provider outage** (Stripe, Twilio, Mailgun, Google, FMCSA down).
Every live adapter goes through `src/integrations/_shared/http.ts`'s shared
client: 8s timeout, 3 attempts, exponential backoff — a genuine outage
exhausts that budget and throws `integration_unavailable`, which surfaces
as a translated error to the user and (for anything routed through a job)
a retried, then dead-lettered, job. Nothing in this codebase automatically
falls back to the mock adapter mid-outage — that would silently fabricate
data. Wait out the provider's outage, or manually flip the relevant
`*_DRIVER` back to `mock` only if you have a specific, understood reason to
accept fabricated data temporarily (e.g. a demo, never production).

**A stuck job lease.** See §1's "Inspecting the queue" — check
`locked_until` before assuming it's actually stuck; `reclaimExpiredLeases()`
runs at the start of every `drain()` call automatically.

**A tenant reports missing data.** Check scope and assignment before
suspecting a bug: most "missing data" reports are either (a) a Dispatcher
whose `assigned` scope genuinely doesn't include the carrier/load/resource
in question (`carrier_dispatcher_assignments`/`dispatcher_resource_assignments`
— confirm there's an active row, i.e. `end_date IS NULL`), or (b) a
soft-deleted or archived record (`deletedAt`/`archivedAt` not null — check
both before concluding data was lost). Only escalate to "possible bug" once
you've confirmed the record exists, is not soft-deleted or archived, and
the reporting user's role/scope should genuinely include it per
`docs/permissions.md`.

**MFA lockout.** A user with `mfa_configurations.confirmedAt` set who has
lost their authenticator and exhausted their hashed recovery codes cannot
self-recover — there is no email/SMS-based MFA bypass in this codebase. An
Admin (for a tenant user) or a platform Super Admin (for an Admin) must
reset the affected `mfa_configurations` row (delete it, forcing re-
enrollment on next login) via direct database access or a support tool if
one exists; record the action manually since there is no dedicated audit
action for "MFA reset by support" today (use the closest fit,
`auth.mfa_enrolled`, with a `reason` explaining the support context, or add
a new `audit_action` enum value if this happens often enough to warrant
one — see CONTRIBUTING.md for the migration process).

**A suspected cross-tenant leak.** This is the highest-severity class of
incident this product can have. Escalation path:
1. Do not attempt to "fix" the query first — capture the exact request
   (user, tenant, resource id(s), timestamp) so it's reproducible.
2. Check `audit_events` for the request (`requestId` if you have it, or
   `actorUserId` + `occurredAt` window) to see exactly what the application
   believed it was doing.
3. Determine which of the four tenancy layers (`docs/architecture.md` §3:
   schema, database trigger, `tenantDb`, `authorize()`) the leak crossed —
   a leak that reached the database despite the `0002_tenant_guards.sql`
   triggers is qualitatively different (and much more concerning) than one
   caught by no layer because it went through `unsafeDb` outside the
   ESLint allow-list.
4. Treat any confirmed leak as a security incident requiring tenant
   notification per your data processing agreements, not just a bug fix —
   this is a legal/compliance decision, not an engineering one; loop in
   whoever owns that relationship before or in parallel with the fix.
5. Add a regression test in `tests/integration/**` that reproduces the
   exact leak before closing it out — `tests/integration/auth/search-tenant-isolation.test.ts`
   is the pattern to extend or sit alongside.

## 4. Legal hold

**Applying a hold** (`src/server/retention/legal-holds.ts`,
`applyLegalHold`) — via Settings → Retention in the app, or directly:

- Requires `name`, a `reason` of at least 10 characters, and a `scopeType`:
  `tenant` (everything), `entity_type` (every row of one retention-tracked
  entity, e.g. every invoice), or `record` (one specific row, requiring
  `entityId`).
- Sets `legal_hold = true` on every row the hold's scope covers (on tables
  that carry the column — see `docs/data-model.md` §5 for which tables
  don't).
- **Blocks:** both the archive sweep and the purge sweep skip any row with
  `legal_hold = true`; a held record cannot move to `archivedAt` and cannot
  be permanently deleted, regardless of how old it is.
- Audited as `legal_hold.applied` with the reason attached.

**Releasing a hold** (`releaseLegalHold`) — requires its own `releaseReason`
(also ≥10 characters). Because a record can be covered by more than one
hold simultaneously, releasing one hold only clears `legal_hold` on rows
not still covered by a *different* active hold — the release logic
recomputes coverage from the remaining active holds rather than blindly
flipping the flag. Audited as `legal_hold.released`.

## 5. Impersonation and support access

**The policy** (`src/server/auth/impersonation.ts`): two entry points.

- **Tenant-scoped** (`tenant:impersonate`) — an Admin stepping into one of
  their own tenant's users. No extra step required beyond the permission
  check, since the actor already belongs to that tenant.
- **Platform-scoped** (`platform:impersonate`) — a Super Admin acting
  outside their own tenant membership. This *requires* first calling
  `openTenantSupportAccess()` (`platform:tenant:support_access`), which is
  audited independently (`tenant.accessed`) — a Super Admin's platform
  authority does not implicitly grant "read/act inside any tenant" without
  that separate, logged step. "I looked" is always distinguishable from "I
  acted as" in the audit trail.

Every impersonation session hard-expires **60 minutes** after it starts;
there is no renewal (see `docs/assumptions.md` for why). Every action taken
during impersonation is audited with **both** identities on the row:
`actorUserId` (who is really logged in) and `effectiveUserId` (whose
authority the action ran under) — never just one.

**Reviewing what was done:** the app ships two dedicated screens —
`/app/audit/impersonation` (list of sessions) and
`/app/audit/impersonation/[id]` (every audit event recorded during one
session, since every such event carries the `impersonationSessionId`).
Query directly if you need it outside the UI:

```sql
select * from audit_events
where impersonation_session_id = '<session-id>'
order by occurred_at;
```

## 6. Data subject requests

To find everything about a person, search by every identity anchor that
table carries a value for — there is no single "purge this person" button,
because a person's data is legitimately spread across operational,
financial and audit tables with different retention floors:

1. **Identity:** `users` (by `emailNormalized`), every
   `user_tenant_memberships` row for that user (which tenants, which
   roles), `sessions`, `mfa_configurations`, `consent_records`.
2. **If they are a driver:** `drivers` (by `licenseNumberHash` if you have
   the raw license number to hash the same way, or by `userId`),
   `driver_carrier_relationships`, `tracking_sessions`/`tracking_events`
   where `driverId` matches, `load_assignments` where `driverId` matches.
3. **If they are a carrier contact:** `carrier_users`,
   `carrier_dispatcher_assignments`, every document/signature request tied
   to that carrier.
4. **If they are a customer contact:** `customer_contacts`,
   `customer_contact_locations`.
5. **Everywhere, regardless of role:** `audit_events` (by `actorUserId` or
   `effectiveUserId`), `notifications`, `messages` (by `senderUserId`).

**What the retention policy permits:** operational-class data
(`docs/data-model.md` §5) can be deleted once past its purge-eligible date
and not under legal hold — but financial-class data (invoices, payments,
signature records, consent records, audit events) is retained a minimum of
7 years by policy and by the database triggers in
`drizzle/custom/0001_audit_immutability.sql`, which reject deletion
outright for the strictly append-only tables. **A right-to-erasure request
cannot be fully honored against financial or audit records inside the
retention window** — this is a deliberate compliance trade-off (financial
recordkeeping obligations vs. erasure rights), not an oversight.

One entity type has a real, implemented anonymization path today: `loads`
past their purge-eligible date are soft-deleted and have their free-text
columns (`customerReference`, `poNumber`, `specialInstructions`,
`internalNotes`, `cancellationReason`) redacted by
`retention.purge_sweep`'s `anonymizeArchivedLoads()` — see
`docs/data-model.md` §5 and this section's job catalog note above for how
to run a confirmed production purge. That path does **not** touch the load's
own name/contact-bearing relations (the customer, carrier, driver and
equipment rows it references), and the purge sweep's coverage is otherwise
limited to `documents`, `invoices` and `loads` — the remaining
retention-tracked entity types (`RETENTION_ENTITY_TYPES` in
`src/server/retention/policy.ts`) have no automated purge or anonymize path
yet. For a data-subject request that needs a specific person's own
identifying fields cleared (a driver's name/license, a customer contact's
name/email) rather than a load's free text, that must currently be done by
hand, carefully, on a case-by-case basis, with legal sign-off on which
fields are safe to clear without breaking a financial record's own
integrity (e.g. never touch a `financial_snapshots` row's amounts, only
ever a person's name/contact columns on a separate table).
