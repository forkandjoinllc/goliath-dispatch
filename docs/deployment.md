# Goliath Dispatch — Deployment

This document expands `docs/architecture.md` §11 into the actual steps and
env var values for each environment. Read `docs/integrations.md` first for
what each provider needs; this document assumes you already know which
providers you're turning on.

## 1. The three environments

| | Development | Staging | Production |
|---|---|---|---|
| `APP_ENV` | `development` | `staging` | `production` |
| Database | Local Postgres 15+, or a Supabase branch | Dedicated Supabase project | Dedicated Supabase project (never shared with staging) |
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:5432/goliath_dev` | Supabase **pooled** connection string (port 6543, `pgbouncer=true`) | Supabase **pooled** connection string |
| `DATABASE_URL_UNPOOLED` | same as `DATABASE_URL` | Supabase **direct** connection string (port 5432) — used only for migrations, see §3 | Supabase **direct** connection string |
| Storage | `STORAGE_DRIVER=local` | `STORAGE_DRIVER=s3`, dedicated staging bucket | `STORAGE_DRIVER=s3`, dedicated production bucket, never shared with staging |
| Stripe | `STRIPE_DRIVER=mock` | `STRIPE_DRIVER=live` with **test-mode** keys | `STRIPE_DRIVER=live` with **live-mode** keys |
| Twilio / Mailgun / Google / FMCSA | `mock` for all | Real drivers, sandbox/test credentials where the provider offers one (Twilio test creds, Mailgun sandbox domain) | Real drivers, production credentials |
| `ALLOW_DEMO_SEED` | `true` | `false` | `false` — `src/db/seed/index.ts` additionally refuses to run when `APP_ENV=production`, so this is defense in depth, not the only guard |
| `SEED_DEMO_PASSWORD` | the documented default is fine | not used | not used |
| Jobs | `npm run jobs:run` (local CLI worker) or rely on `next dev` + manual cron hits | Vercel Cron (`vercel.json`) | Vercel Cron |
| `LOG_FORMAT` | `pretty` | `json` (so a log aggregator can parse it) | `json` |
| MFA enforcement | optional | recommended for Admin/Accounting | **required** for Admin and Accounting (see go-live checklist) |
| Custom domain | none | optional, Vercel preview domain is fine | per-tenant, see §5 |

`NODE_ENV` is `development`/`production`/`test` (framework-level, mostly
set automatically by `next dev`/`next build`); `APP_ENV` is this
application's own, finer-grained environment flag and is what `isProduction()`
and the seed guard actually check.

---

## 2. Vercel project setup

1. **Import the repository** into a new Vercel project. Framework preset:
   Next.js (auto-detected). Build command: `next build` (the default; the
   repo's `npm run build` is exactly this). Output directory: default
   (`.next`). Install command: `npm ci`.
2. **Set the Node version** to 20.x in Project Settings → General (the
   `engines.node` field in `package.json` requires `>=20.11.0`).
3. **Environment variables** — set these in Project Settings →
   Environment Variables, scoped per Vercel environment (Production,
   Preview, Development). Group by how badly a missing value breaks the
   deployment:

   **Build-breaking if absent** (the app will not boot; `serverEnv()` throws
   on first access):
   `DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `SIGNATURE_HASH_PEPPER`,
   `PUBLIC_TRACKING_TOKEN_SECRET`, `CRON_SECRET`.

   **Functionally silent if absent** (the app boots, the feature degrades to
   its mock or throws `integration_unavailable` only when actually used):
   every `*_DRIVER` variable and its corresponding credentials
   (`STRIPE_SECRET_KEY`, `MAILGUN_API_KEY`, `TWILIO_ACCOUNT_SID`,
   `GOOGLE_MAPS_SERVER_API_KEY`, `FMCSA_WEBKEY`, `S3_ACCESS_KEY_ID`, etc.).

   **Cosmetic/operational if absent** (falls back to a sane default):
   `NEXT_PUBLIC_APP_NAME`, `LOG_LEVEL`, `LOG_FORMAT`,
   `SIGNED_URL_TTL_SECONDS`, `PUBLIC_FORM_RATE_LIMIT_PER_HOUR`.

   Set `NEXT_PUBLIC_APP_URL` to the deployment's real URL (or the custom
   domain once configured) in every environment — it is used to build
   absolute links in emails and PDFs.

---

## 3. Connecting Supabase and running migrations

1. Create the Supabase project (one per environment — never share a
   database between staging and production).
2. From Project Settings → Database, copy **both** connection strings:
   - **Connection pooling** (PgBouncer, port 6543) → `DATABASE_URL`. This is
     what the running application uses; a serverless function's connection
     count would otherwise exhaust Postgres's own connection limit.
   - **Direct connection** (port 5432) → `DATABASE_URL_UNPOOLED`.
3. **Run migrations against the direct connection, not the pooled one.**
   `src/db/migrate.ts` already prefers `DATABASE_URL_UNPOOLED` when set
   (`process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL`) — this
   is deliberate, not incidental: `drizzle-orm/postgres-js/migrator` and the
   hand-written SQL in `drizzle/custom/` use session-level features
   (`CREATE TRIGGER`, multi-statement transactions) that a transaction-mode
   PgBouncer pool does not support correctly. Run migrations from a machine
   with a network path to the direct connection (Supabase's direct port is
   reachable from anywhere by default; a locked-down VPC-only Postgres would
   need a bastion or a Vercel deployment hook that runs before traffic is
   cut over):

   ```bash
   DATABASE_URL_UNPOOLED="postgres://...:5432/postgres" npm run db:migrate
   ```
4. Do **not** run `npm run db:seed` against staging or production with
   `ALLOW_DEMO_SEED=true` — see the go-live checklist (§7). A staging
   environment that wants realistic-but-fake data should seed once during
   setup with `ALLOW_DEMO_SEED=true` set only for that one invocation, then
   flip it back to `false`.
5. If `src/db/seed/index.ts` does not exist yet in your checkout (it is
   owned by a separate workstream at the time of writing — see
   `docs/implementation-checklist.md`), migrations still apply cleanly on
   their own; you will simply have an empty (but fully migrated) database
   until the seed lands.

---

## 4. Stripe webhook

1. In the Stripe Dashboard (or via `stripe webhook_endpoints create`), add
   an endpoint pointing at:

   ```
   https://<your-domain>/api/webhooks/stripe
   ```
2. Subscribe it to at least the nine event types
   `docs/integrations.md` lists under "Event types handled" — subscribing to
   more is harmless (unhandled types are acknowledged and ignored), but
   subscribing to fewer means an event this app expects to process never
   arrives.
3. Copy the endpoint's **signing secret** (`whsec_...`) into
   `STRIPE_WEBHOOK_SECRET` for that Vercel environment.
4. Set `STRIPE_DRIVER=live`, `STRIPE_SECRET_KEY`,
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and the three
   `STRIPE_PRICE_*` ids from the Products you created in Stripe.
5. Verify: `stripe trigger invoice.paid --add customer:metadata.tenantId=<uuid>`
   (or send a real test-mode subscription through checkout) and confirm a
   row lands in `stripe_events` with `processing_status = 'processed'`.

---

## 5. Object storage: bucket, CORS, lifecycle, IAM

The application does not create its own bucket — provision it manually (AWS
S3, Cloudflare R2, MinIO, or Supabase Storage in S3-compatible mode) and
point `STORAGE_DRIVER=s3` at it. **The bucket must be private** — no public
read access, no public listing.

**CORS** (only needed if the browser ever uploads directly via a presigned
URL rather than proxying through a server action — check
`src/lib/storage/s3-driver.ts`'s `signedUploadUrl` usage before deciding you
need this; if all uploads currently proxy through the server, CORS can be
left at the provider default):

```json
[
  {
    "AllowedOrigins": ["https://<your-domain>"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

**Lifecycle policy** — the application's own retention pipeline
(`docs/operations.md`) governs *database* rows, but it does not currently
delete the corresponding S3 objects on purge; a bucket lifecycle rule is the
recommended backstop until that gap is closed (see
`docs/implementation-checklist.md`):

```json
{
  "Rules": [
    {
      "ID": "expire-old-versions",
      "Status": "Enabled",
      "NoncurrentVersionExpiration": { "NoncurrentDays": 2555 }
    }
  ]
}
```

(2555 days ≈ 7 years, matching the financial retention floor. Adjust if
versioning is not enabled on the bucket — in which case this rule is a
no-op and object lifecycle must be driven by application code instead.)

**Minimal IAM policy** for the credentials in `S3_ACCESS_KEY_ID`/
`S3_SECRET_ACCESS_KEY` — scoped to one bucket, no account-wide S3 access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:CopyObject",
        "s3:HeadObject"
      ],
      "Resource": "arn:aws:s3:::goliath-dispatch-production/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::goliath-dispatch-production"
    }
  ]
}
```

Set `SIGNED_URL_TTL_SECONDS` (default 300) to the shortest value your UX can
tolerate — every document view/download mints a fresh signed URL, so this is
purely a "how long is a copied link valid" setting, not a caching knob.

---

## 6. Cron

`vercel.json` defines eight cron schedules (all UTC), each hitting a route
under `/api/cron/*` that first calls `authorizeCronRequest()` — every
request must carry `Authorization: Bearer <CRON_SECRET>`, or it gets a bare
401 with no body (deliberately uninformative, so a probing request learns
nothing about why it failed):

| Path | Schedule | What it does |
|---|---|---|
| `/api/cron/fmcsa-reverification` | `0 6 * * *` (daily 06:00 UTC) | Enqueues one `fmcsa.reverify_carrier` job per carrier whose reverification window elapsed. |
| `/api/cron/document-expiration` | `0 7 * * *` | Sweeps for documents entering the warning window or newly expired. |
| `/api/cron/invoice-overdue` | `0 8 * * *` | Transitions `sent`/`due` invoices past their due date to `overdue`. |
| `/api/cron/retention-archive` | `0 9 * * *` | Archives operational records past the active window, skipping legal holds. |
| `/api/cron/retention-purge` | `0 10 * * 0` (weekly, Sunday) | Fires every week but **performs no deletion in production** unless an operator manually re-enqueues the job with `confirm: true` — see `docs/operations.md` §1. |
| `/api/cron/tracking-ingest` | `*/5 * * * *` | Polls active tracking sessions for pull-based providers and refreshes session health. |
| `/api/cron/tracking-link-expiry` | `0 * * * *` (hourly) | Marks public tracking links past their TTL as revoked. |
| `/api/cron/drain` | `* * * * *` (every minute) | The general-purpose job-queue drain — everything else in `docs/operations.md`'s job catalog that isn't one of the dedicated sweeps above runs through this route. |

Set `CRON_SECRET` (see §7) in every environment that has cron enabled —
Vercel Cron sends it automatically once configured, but verify it manually
after first deploy:

```bash
curl -i -X POST https://<your-domain>/api/cron/drain \
  -H "Authorization: Bearer $CRON_SECRET"
```

A 200 with a JSON `DrainResult` body confirms the whole chain (secret →
route → registry → queue) is wired correctly. Vercel's own Cron Jobs tab
shows each schedule's next/last run and its response status — check it
after the first deploy and periodically thereafter (see
`docs/operations.md`'s monitoring section).

---

## 7. Secret generation and rotation

Generate every `*_SECRET`/`*_KEY` placeholder in `.env.example` with:

```bash
openssl rand -base64 32
```

Run it once per secret — `AUTH_SECRET`, `ENCRYPTION_KEY`,
`SIGNATURE_HASH_PEPPER`, `PUBLIC_TRACKING_TOKEN_SECRET`, `CRON_SECRET` — and
never reuse a value across environments.

**Rotating `ENCRYPTION_KEY` without downtime.** `src/lib/crypto.ts`'s
`decryptField()` tries the current `ENCRYPTION_KEY` first, then falls back
to `ENCRYPTION_KEY_PREVIOUS` if set — this is the entire mechanism the
rollout below depends on:

1. Generate a new key: `openssl rand -base64 32`.
2. Deploy with `ENCRYPTION_KEY_PREVIOUS` set to the **current** (soon to be
   old) value, and `ENCRYPTION_KEY` set to the **new** value. Every existing
   encrypted field (carrier EIN, driver license number, integration
   credentials) still decrypts correctly — reads fall through to the
   previous key — while every new write is sealed under the new key.
3. Leave both set for long enough that every row encrypted under the old
   key has been re-written at least once (there is no bulk re-encryption
   job in this codebase — a row is only re-sealed the next time its own
   update path runs, e.g. a carrier's EIN is only re-encrypted if someone
   edits it). If your data has effectively-permanent secrets that are
   rarely edited, consider writing a one-off script that reads and re-saves
   every row `decryptField`/`encryptField` touches (search for
   `encryptField(` to find every call site) rather than waiting indefinitely.
4. Once you are confident every row is under the new key (or you have
   accepted the residual risk), remove `ENCRYPTION_KEY_PREVIOUS` and
   redeploy. From this point, a row still sealed under the old key becomes
   unreadable — do not skip step 3.

`AUTH_SECRET` and `CRON_SECRET` have no rotation mechanism beyond a hard
cutover — rotating `AUTH_SECRET` invalidates nothing stored (sessions are
opaque tokens hashed independently of it; check `src/lib/auth/session.ts` if
this changes), but rotating `CRON_SECRET` requires updating it in Vercel's
Cron configuration atomically with the deploy, since a mismatch simply
401s every cron invocation until both sides agree — there is no fallback.
`SIGNATURE_HASH_PEPPER` should be treated as effectively permanent: rotating
it invalidates the ability to *verify* every previously sealed
`signature_records.integritySeal`, since that HMAC has no "previous key"
fallback the way field encryption does — do not rotate it without a plan
for re-sealing or accepting that historical signatures become unverifiable
by the automated check (the underlying PDF and audit trail remain intact
and human-readable either way).

---

## 8. Backup and restore

**What to back up:**
1. **The Postgres database** — Supabase's built-in daily backups (Point-in-
   Time Recovery on paid tiers) cover this; for self-hosted Postgres, use
   `pg_dump`/WAL archiving on the same cadence below.
2. **The S3 bucket** — enable versioning and cross-region replication (or an
   equivalent scheduled sync) at the bucket/provider level; this
   application has no built-in backup mechanism for object storage.

**Cadence and retention:** daily backups, retained at minimum 7 years for
anything that could contain financial-class data (in practice: back up the
whole database — there's no clean per-table backup split available in a
managed Postgres backup product) matching the financial-record retention
floor in `docs/data-model.md` §5. Supabase Pro/Team tiers offer 7-day to
28-day PITR by default; if the platform's own PITR window is shorter than
your compliance requirement, add a separate scheduled `pg_dump` to
independent storage.

**The database and object store must be restored together, to the same
point in time.** This is the caveat that matters most: `document_versions.storageKey`
and every other stored-key reference is a pointer, not a value — restoring
the database to yesterday while the bucket is still at today's state means
every row created today points at nothing (broken signed URLs, 404s), and
restoring the bucket to yesterday while the database is at today's state
means today's rows point at objects that were deleted by a lifecycle rule
or overwritten. Always restore both from backups taken at (or as close as
practically possible to) the same timestamp, and treat a database-only or
bucket-only restore as an incident requiring manual reconciliation, not a
routine operation.

**Tested restore procedure** (run this in staging at least once before you
need it in production):

1. Provision a fresh Postgres instance (or a Supabase branch/point-in-time
   restore) from the chosen backup timestamp.
2. Provision or restore the S3 bucket to the same timestamp (versioned
   bucket: restore each object to its version as-of that time; replicated
   bucket: point at the replica's state at that time).
3. Point a non-production deployment's `DATABASE_URL_UNPOOLED` /
   `DATABASE_URL` and `S3_BUCKET` at the restored copies.
4. Run `npm run db:migrate` (idempotent — safe even if the restored database
   is already fully migrated) to confirm the restored schema matches the
   application's expectations.
5. Spot-check: open a document that existed at the backup timestamp and
   confirm its signed URL resolves; open a load with a financial snapshot
   and confirm the numbers match what was reported to the carrier at that
   time.
6. Only after this validates does a restore proceed against the real
   production `DATABASE_URL`/`S3_BUCKET` values — and only as a deliberate,
   announced incident-response action, never as a routine task.

---

## 9. Custom domains

`tenants.customDomain` (unique) and `tenants.customDomainVerifiedAt` exist
in the schema, and the tenant settings screen accepts a custom domain value
— but **there is no automated DNS verification or Vercel Domains API
integration in this codebase**. Setting a tenant's custom domain in the
settings form only stores the value; nothing currently issues a TLS
certificate, adds the domain to the Vercel project, or flips
`customDomainVerifiedAt`. Until that automation exists, per-tenant custom
domains are a **manual operations task**:

1. Add the domain to the Vercel project (Project Settings → Domains) and
   follow Vercel's DNS instructions (a `CNAME` to `cname.vercel-dns.com`, or
   an `A` record to Vercel's anycast IP for an apex domain).
2. Once Vercel shows the domain as verified and its certificate issued,
   manually set `tenants.customDomainVerifiedAt` (via `db:studio` or a
   one-off script) so the application's own record matches reality.
3. Confirm `NEXT_PUBLIC_APP_URL`-derived links for that tenant (emails,
   PDFs, tracking links) are correct — today they use the platform's shared
   `NEXT_PUBLIC_APP_URL`, not a per-tenant custom domain; a tenant's custom
   domain currently only affects which hostname routes into the app, not
   what hostname the app generates in outbound links. See
   `docs/assumptions.md` for the reasoning.

---

## 10. Go-live checklist

Work through this in order; each item names where to verify it.

- [ ] `ALLOW_DEMO_SEED=false` in the production environment variables.
- [ ] No demo/seed users exist in the production database (`SELECT * FROM
      users WHERE email_normalized LIKE '%@demo.%'` or whatever pattern the
      seed uses once it lands — see `docs/demo-credentials.md`).
- [ ] MFA enforced for every Admin and Accounting user
      (`mfa_configurations.confirmedAt IS NOT NULL` for each such
      membership) before they are granted access to production data.
- [ ] Real Stripe keys (`STRIPE_DRIVER=live`, live-mode `STRIPE_SECRET_KEY`)
      — confirm you are not accidentally still on test-mode keys with the
      driver flipped to `live`.
- [ ] Stripe webhook endpoint added and verified (§4) — trigger one real
      test-mode event before cutover if still on test keys, or wait for the
      first live event and check `stripe_events`.
- [ ] Storage is private (`STORAGE_DRIVER=s3`, bucket has no public access)
      and CORS is locked to the production origin only (§5).
- [ ] CSP verified — load the production site with browser devtools open
      and confirm no CSP violations are logged; `src/lib/security/headers.mjs`
      is the single source of the policy.
- [ ] Security headers verified — `curl -I https://<domain>` and confirm
      `Strict-Transport-Security`, `X-Frame-Options: DENY`,
      `X-Content-Type-Options: nosniff` are all present (HSTS is only added
      when `NODE_ENV=production`, per `headers.mjs`).
- [ ] `npm run audit:deps` is clean (`npm audit --omit=dev --audit-level=high`)
      — run it in CI (see `.github/workflows/ci.yml`) and again right before
      cutover if any dependency changed since the last CI run.
- [ ] Malware scanning is not left on `MALWARE_SCAN_DRIVER=noop` for any
      deployment that accepts carrier/driver-uploaded documents — the
      `noop` driver always reports uploads clean without scanning them
      (`src/lib/storage/malware.ts`). `clamav` is interface-only in this
      release (see `docs/integrations.md`), so going live with real
      scanning requires implementing the ClamAV socket protocol documented
      in that adapter's header comment before this box can be checked.
- [ ] Migrations applied against production via the direct connection (§3).
- [ ] Cron firing — check Vercel's Cron Jobs tab shows recent successful
      runs for all eight schedules (§6), and manually verify `/api/cron/drain`
      once (§6).
- [ ] Legal review completed for the Privacy Policy, Terms and the
      electronic-signature consent copy
      (`tenant_settings.signatureConsentCopy` and
      `signature_templates.consentCopyEn`/`consentCopyEs`) — these are
      rendered verbatim to end users and carry real legal weight for the
      e-signature ceremony; engineering should not be the last reviewer of
      this copy.

---

## 11. Rollback

**Rolling back a deploy:** use Vercel's "Instant Rollback" to the previous
deployment (Project → Deployments → select the prior good deployment →
Promote to Production). This reverts application code immediately; it does
**not** touch the database.

**A rollback does not undo a migration.** If the deploy you're rolling back
from ran a migration that changed the schema (new column, new table, new
constraint), rolling back the *code* leaves the *database* in the new
schema shape while the *old* code runs against it. Two consequences:

- If the migration was purely additive (a new nullable column, a new
  table) the old code typically still works — it just doesn't know about
  the new column.
- If the migration was destructive or changed an existing column's
  type/constraint, rolling back code alone is insufficient; you need a
  compensating down-migration (write one, this repo's `drizzle-kit generate`
  does not produce them automatically) or you must roll forward instead of
  back.

The safe default: **never** ship a schema migration in the same deploy as a
risky application-code change when you might need to roll back one without
the other. When in doubt, deploy the migration first (additive, backward-
compatible with the currently-running code), confirm it's healthy, then
deploy the code that depends on it — that way an instant rollback of the
code half is always safe.
