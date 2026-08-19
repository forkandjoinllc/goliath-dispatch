# Goliath Dispatch

Goliath Dispatch is a multi-tenant SaaS platform for US transportation
dispatch companies that manage multiple motor carriers on their behalf,
with particular attention to heavy-haul and oversize freight. Each dispatch
company (a **tenant**) onboards its own carriers, dispatches loads on their
behalf, tracks compliance and financials per carrier, and bills the
carriers a dispatch fee — all bilingual (English/Spanish), audit-first, and
built so that suspending access, ending a support session, or reviewing who
did what is never a "we'd have to check the logs" conversation.

Six roles share the product: **Platform Super Admin** (operates the SaaS
itself, across every tenant), **Admin** (runs one dispatch company),
**Accounting** (financial operations, cannot touch operational loads),
**Dispatcher** (assigns and manages loads, scoped to their own carriers/
resources), **Carrier** (a carrier company's own portal user), and
**Driver** (the person behind the wheel, no load-status authority of their
own — status moves come from tracking or a human dispatcher).

For the architecture and the reasoning behind its major decisions, start
with [`docs/architecture.md`](docs/architecture.md). This README gets you
running; that document explains why it's built this way.

## Documentation map

| Document | What's in it |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | System shape, multi-tenancy, authorization, the financial engine, compliance gates, background jobs, retention, i18n, environments. |
| [`docs/permissions.md`](docs/permissions.md) | The full generated permission matrix — every permission, every role's scope. |
| [`docs/data-model.md`](docs/data-model.md) | Every one of the 92 tables: purpose, columns, indexes, invariants, ER diagrams per domain. |
| [`docs/integrations.md`](docs/integrations.md) | Every third-party provider: what it's for, mock vs. live vs. interface-only, env vars, failure modes, how to go live. |
| [`docs/deployment.md`](docs/deployment.md) | Vercel + Supabase setup, secrets, backups, custom domains, the go-live checklist. |
| [`docs/testing.md`](docs/testing.md) | The test pyramid as it actually exists, how to test against each provider's mock, security-relevant tests. |
| [`docs/operations.md`](docs/operations.md) | The job system runbook, monitoring, common incidents, legal hold, impersonation, data-subject requests. |
| [`docs/implementation-checklist.md`](docs/implementation-checklist.md) | Honest, file-verified status of every feature area — what's complete, partial, interface-only, or not started. |
| [`docs/assumptions.md`](docs/assumptions.md) | Every judgement call the brief left open, why it was resolved the way it was, and what changes if it's wrong. |
| [`docs/demo-credentials.md`](docs/demo-credentials.md) | Seed login credentials — **does not exist in this checkout yet**; see the seed note below. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Conventions: `defineAction`, the `unsafeDb` boundary, the money/audit/soft-delete rules, how to add a permission/migration/i18n namespace/job. |

## What's built, by phase

1. **Foundation** — multi-tenancy (schema + database triggers + data-access
   layer + authorization, four independent layers), opaque revocable
   sessions, TOTP MFA, the full role/permission matrix, bilingual i18n with
   build-time parity enforcement, an append-only audit trail, tenant
   branding, security headers with a per-request CSP nonce.
2. **Carrier onboarding & compliance** — carrier CRUD (per-tenant, no
   global registry), a full onboarding review workflow, FMCSA authority
   verification (mock + live QCMobile adapter) with a recurring
   reverification sweep, document upload/versioning/review with OCR-based
   VIN extraction, equipment (trucks/trailers) and driver management with
   encrypted PII, and the nine compliance gates that block dispatch until
   met.
3. **Load lifecycle & operations** — customer management with duplicate
   detection, the full load lifecycle (draft through paid/cancelled) with
   five board/calendar/timeline/map views, resource assignment with
   conflict detection, rate confirmations with carrier accept/reject and
   evidentiary PDF hashing, route calculation, and oversize/overweight
   evaluation with permit and escort tracking.
4. **Financials** — an integer-cents, basis-points money model with
   versioned, database-enforced-immutable financial snapshots; expense
   approval with configurable commission treatment; carrier invoicing;
   Stripe billing (mock + live) with idempotent webhook processing; carrier
   settlement statements; manual (non-API) factoring support; scoped report
   exports.
5. **Signatures, messaging & notifications** — a no-account e-signature
   ceremony with a tamper-evident HMAC-sealed record and a hash-chained
   audit log; in-app messaging (polled); event-driven, per-locale, per-
   channel notification delivery over email (mock + live Mailgun) and SMS
   (mock + live Twilio, consent-gated).
6. **Tracking & public visibility** — consent-gated tracking sessions with
   a full mock simulator; signed, expiring, no-account public tracking
   links for customers; a bilingual marketing site with lead/quote capture.
7. **Platform operations** — a durable, lease-based Postgres job queue
   drained by Vercel Cron; retention classification (operational vs.
   financial) with archive/purge sweeps and legal hold; platform Super
   Admin tooling (tenant suspension, SaaS plans); tenant-isolated global
   search.

See [`docs/implementation-checklist.md`](docs/implementation-checklist.md)
for the item-by-item verified status behind that summary, and the "what
this release does not do" section below for the honest limits.

## Quick start

**Prerequisites:** Node.js ≥20.11, and either a local PostgreSQL 15+ or a
Supabase project.

```bash
git clone <this-repository-url> goliath-dispatch
cd goliath-dispatch
npm install
cp .env.example .env
```

Generate the four required secrets and paste each into `.env`:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 32   # SIGNATURE_HASH_PEPPER
openssl rand -base64 32   # PUBLIC_TRACKING_TOKEN_SECRET
openssl rand -base64 32   # CRON_SECRET
```

(That's five commands, one per line above the secret it fills — `.env.example`
also documents each one inline. Every other variable in `.env.example` has
a working default: every external provider defaults to its `mock` driver,
so nothing else is required to run the app locally.)

Create the databases (adjust for your local Postgres setup, or use a
Supabase project's connection string instead):

```bash
createdb goliath_dev
createdb goliath_test
```

Run migrations, seed, and start the dev server:

```bash
npm run db:migrate
npm run db:seed     # see the note below if src/db/seed/ doesn't exist yet
npm run dev
```

Open http://localhost:3000.

> **Seed data note:** `npm run db:seed` runs `src/db/seed/index.ts`. If that
> file doesn't exist in your checkout, the seed workstream hasn't landed
> yet — migrations still apply cleanly and `npm run dev` still works, you
> will simply start from an empty database (no demo tenants/users) until
> it does. Once it lands, credentials will be documented in
> `docs/demo-credentials.md`. **The seed refuses to run outside
> development** — it checks `ALLOW_DEMO_SEED` (must be `true`, the
> `.env.example` default) and `APP_ENV` (must not be `production`) before
> writing anything. Never set `ALLOW_DEMO_SEED=true` in a deployed
> environment.

## Script reference

| Script | What it does | When to use it |
|---|---|---|
| `npm run dev` | Starts the Next.js dev server. | Day-to-day development. |
| `npm run build` | Production build (`next build`). | Before deploying; also run by CI and by `npm run verify`. |
| `npm start` | Serves a production build (`next start`). | After `npm run build`, e.g. locally verifying a production bundle, or as the E2E `webServer` command. |
| `npm run lint` | ESLint, zero warnings tolerated. | Before committing; part of `verify`. |
| `npm run lint:fix` | ESLint with autofix. | Cleaning up lint issues quickly. |
| `npm run format` | Prettier, writes changes. | Before committing. |
| `npm run format:check` | Prettier, check-only. | Part of `verify`/CI. |
| `npm run typecheck` | `tsc --noEmit`. | Part of `verify`/CI. |
| `npm run db:generate` | Generates a Drizzle migration from schema changes. | After editing `src/db/schema/**`. |
| `npm run db:migrate` | Applies generated migrations plus `drizzle/custom/*.sql`. | After pulling schema changes; in deployment. |
| `npm run db:push` | Pushes schema directly without a migration file. | Rapid local prototyping only — never against staging/production. |
| `npm run db:studio` | Opens Drizzle Studio, a browser DB explorer. | Inspecting data locally. |
| `npm run db:seed` | Runs the demo data seed. | Local development / staging setup, `ALLOW_DEMO_SEED=true` only. |
| `npm run db:reset` | Drops and recreates the schema, then migrates and seeds. | Local development only — refuses to run in production. |
| `npm test` | Vitest: unit + integration + component. | The default full test run. |
| `npm run test:watch` | Vitest in watch mode. | Active development. |
| `npm run test:unit` | Unit tests only, no database. | Fast iteration on pure logic. |
| `npm run test:integration` | Integration tests against `TEST_DATABASE_URL`. | Testing tenant isolation, permissions, DB-enforced invariants. |
| `npm run test:coverage` | Vitest with v8 coverage. | Checking coverage of `src/lib`, `src/server`, `src/integrations`, `src/jobs`. |
| `npm run test:e2e` | Playwright E2E. | See `docs/testing.md` — no specs exist yet in this checkout. |
| `npm run test:e2e:ui` | Playwright's interactive UI mode. | Debugging an E2E spec. |
| `npm run jobs:run` | Local background-job worker (loops or `--once`). | Draining the queue outside of Vercel Cron, e.g. local dev. |
| `npm run docs:permissions` | Regenerates `docs/permissions.md` from `catalog.ts`. | After changing the permission matrix. |
| `npm run verify` | `format:check` → `lint` → `typecheck` → `test` → `build`. | The full pre-merge gate; matches CI exactly. |
| `npm run audit:deps` | `npm audit --omit=dev --audit-level=high`. | Dependency vulnerability check; part of CI and the go-live checklist. |

## Project structure

```
src/
  app/                  Next.js App Router
    [locale]/(marketing)/  Public bilingual marketing site
    [locale]/(auth)/       Login, signup, MFA, password reset
    [locale]/(app)/app/    The authenticated application shell (every feature area)
    [locale]/sign/[token]/ No-account e-signature ceremony
    [locale]/track/[token]/ No-account public tracking view
    api/cron/**           Vercel Cron entry points (secret-authenticated)
    api/webhooks/**       Stripe and tracking-provider webhook intake
  server/                 One directory per domain: defineAction-based mutations, queries, services
  lib/                    Cross-cutting: auth, crypto, env, errors, i18n, money, pdf, permissions, security, storage, validation
  integrations/           Provider interfaces + mock/live adapters, one directory per family
  jobs/                   The durable job queue, registry, and every handler
  db/                     Drizzle schema (src/db/schema/**), tenant-scoped client, migration/reset scripts
  i18n/                   Dictionaries (en/es) and the translation runtime
  components/             Shared UI: shadcn-style primitives, forms, data display, shell chrome
  types/                  Shared TypeScript types
drizzle/                  Generated SQL migrations + drizzle/custom/ hand-written triggers/constraints
tests/                    unit/, integration/, component/, setup/ — see docs/testing.md
docs/                     This documentation set
scripts/                  One-off tooling (e.g. the permissions-doc generator)
```

## Providers: mocks by default

Every external integration defaults to a mock adapter — the whole product,
including every automated test, runs with zero third-party credentials.
Full detail (failure modes, going live, exact fixtures) is in
[`docs/integrations.md`](docs/integrations.md); the short version:

| Provider | Mock by default | What changes with real credentials |
|---|---|---|
| FMCSA carrier data | ✓ (5 deterministic DOT fixtures) | Live QCMobile lookups (`FMCSA_DRIVER=qcmobile`). |
| Google Places/Geocoding/Routes | ✓ | Live autocomplete/geocode/route calculation (`GEO_DRIVER=google`). |
| OCR / VIN extraction | ✓ | Live Amazon Textract or Google Document AI. |
| Email | ✓ (in-memory outbox) | Live Mailgun send (`EMAIL_DRIVER=mailgun`). |
| SMS | ✓ (in-memory outbox) | Live Twilio send (`SMS_DRIVER=twilio`). |
| Payments/billing | ✓ (full in-memory Stripe, real signature scheme) | Live Stripe (`STRIPE_DRIVER=live`). |
| Object storage | Local disk (`STORAGE_DRIVER=local`) | Private S3-compatible bucket (`STORAGE_DRIVER=s3`). |

## What this release does not do

Being specific about limits here is more useful than a features list. See
`docs/assumptions.md` and `docs/implementation-checklist.md` for the full
reasoning behind each:

- **Customers get a signed, expiring tracking link, not an account.** There
  is no customer login/portal this release; visibility into a shipment is
  entirely through `publicTrackingLinks`.
- **Factoring is a manual workflow.** The product records what a human
  confirmed happened with a factoring company (documents received, a
  company verified, proceeds submitted) — there is no funding API
  integration.
- **Toll estimation (TollGuru) is an interface with no live adapter.**
  Every call throws rather than fabricating a number; wiring a real
  TollGuru integration is a deliberately deferred, well-documented gap, not
  an oversight.
- **The three live carrier-tracking providers (Trucker Tools, MacroPoint,
  Highway) are interfaces plus a working settings screen, with a
  functional mock standing in for all three.** Each needs a carrier-facing
  onboarding flow inside that provider's own portal that has no equivalent
  in this codebase yet; every method throws `integration_unavailable` until
  a real adapter is written.
- **Malware scanning defaults to `noop`** (logs loudly, reports every
  upload clean without scanning it); the ClamAV driver is interface-only.
  This is on the go-live checklist in `docs/deployment.md` for exactly this
  reason.
- **In-app messaging is polled (every 20 seconds), not pushed.** There is
  no WebSocket/SSE transport; the UI discloses this to users rather than
  implying real-time delivery it doesn't provide.
- **Per-tenant custom domains have no automated DNS verification.** The
  schema and settings field exist; connecting a domain to Vercel and
  marking it verified is a manual operations task today.
- **The retention purge sweep anonymizes `loads` and deletes `documents`/
  `invoices`; it does not yet cover the rest of the retention registry**, and
  refuses to run at all in production without an operator manually
  confirming it (irreversibility safeguard).
- **The E2E test suite is configured but has no specs yet** —
  `playwright.config.ts` is fully set up; `tests/e2e/` does not exist.
- **The QStash background-jobs driver is a reserved value, not an
  implementation** — only the durable Postgres queue (`JOBS_DRIVER=database`)
  actually runs jobs today.
