# Goliath Dispatch — Testing

## 1. The test pyramid as it exists

Four layers, three of them driven by Vitest's `projects` config
(`vitest.config.ts`), the fourth by Playwright (`playwright.config.ts`).

| Layer | Command | Environment | Files live in |
|---|---|---|---|
| Unit | `npm run test:unit` | `node` | `tests/unit/**/*.test.ts` and any `src/**/*.test.ts` colocated with source |
| Integration | `npm run test:integration` | `node`, real Postgres | `tests/integration/**/*.test.ts` |
| Component | *(part of `npm test`; no dedicated script — run `npx vitest run --project component`)* | `jsdom` | `tests/component/**/*.test.tsx` |
| E2E | `npm run test:e2e` | real browser via Playwright, against a built app | `tests/e2e/**` |

`npm test` (`vitest run`, no `--project` filter) runs unit, integration and
component together in one invocation — this is what `npm run verify` and CI
use. Coverage (`npm run test:coverage`) instruments
`src/lib/**`, `src/server/**`, `src/integrations/**`, `src/jobs/**` (v8
provider, text/html/lcov reporters) — deliberately excluding `src/app/**`
(routes/components), since that layer is covered by the component and E2E
layers instead, not by line coverage.

**What each layer actually covers:**

- **Unit** — pure functions and logic with no I/O: money formulas
  (`tests/unit/finance/money-formulas.test.ts`), the load status machine,
  oversize evaluation, VIN validation, the permission-doc generator, backoff
  timing, provider mocks in isolation (`tests/unit/integrations/**`), and
  every `src/**/*.test.ts` colocated with its source module.
- **Integration** — anything that needs a real database: tenant isolation,
  permission scope resolution against real rows, uniqueness constraints,
  the compliance gates, the financial snapshot lifecycle, the job queue
  against real `job_queue` rows, the Stripe webhook route end-to-end via the
  mock adapter.
- **Component** — React component behavior in `jsdom` (data tables, form
  fields, the kanban board, the signature pad) without a browser or a
  server.
- **E2E** — **configured but not yet populated.** `playwright.config.ts`
  points `testDir` at `./tests/e2e`, but that directory does not exist in
  this checkout and no Playwright spec files exist anywhere in the repo.
  `npm run test:e2e` will currently fail with "no tests found" rather than
  exercise anything. See `docs/implementation-checklist.md` for this gap
  tracked explicitly — do not assume browser-level coverage exists today.
  `@axe-core/playwright` is an installed dev dependency, so accessibility
  assertions are ready to use in whatever E2E specs get written first.

## 2. How the integration tests get a database

`tests/setup/db-setup.ts` is loaded as a Vitest `setupFiles` entry only for
the `integration` project. On `beforeAll` it:

1. Overrides `process.env.DATABASE_URL`/`DATABASE_URL_UNPOOLED`/
   `TEST_DATABASE_URL` to `TEST_DATABASE_URL` (default
   `postgres://postgres:postgres@127.0.0.1:5432/goliath_test`) — **before**
   any test file's own `import` of `@/db/client` or `@/db/tenant-db`
   resolves, because Vitest fully executes every `setupFiles` entry before
   loading any test file.
2. Runs the generated Drizzle migrations plus every file in
   `drizzle/custom/`, once per test run (memoized via a module-level
   `Promise`).
3. Truncates every real table (`TRUNCATE ... RESTART IDENTITY CASCADE`)
   before the first test and again after each individual test
   (`afterEach`), so every test starts from an empty, fully-migrated
   database. `TRUNCATE` fires `ON TRUNCATE` triggers rather than the
   `BEFORE DELETE` guards the append-only tables install, so this is safe
   even for `audit_events`/`financial_snapshots`/etc.

To point integration tests at a database, either accept the default
(`postgres://postgres:postgres@127.0.0.1:5432/goliath_test`, matching
`.env.example`) or export `TEST_DATABASE_URL` before running:

```bash
createdb goliath_test    # once
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/goliath_test \
  npm run test:integration
```

**Known flakiness under high parallelism, and the workaround already
applied:** integration tests share one database and truncate between every
test, so two test *files* running concurrently would corrupt each other's
state mid-test. `vitest.config.ts`'s `integration` project is configured
with `pool: 'forks'` and `poolOptions.forks.singleFork: true` specifically
to force every integration test file to run **serially in one process** —
this is already the workaround, not something you need to add. If you see
flakiness in this layer despite that setting, the most likely causes are
(a) a test that doesn't await something it enqueues into `job_queue` and
asserts on it in the same test rather than draining the queue explicitly,
or (b) a local Postgres under heavy unrelated load — `hookTimeout`/
`testTimeout` are already generous (120s/60s) to absorb normal CI
contention, not correctness races.

## 3. Testing against each provider's mock

Every integration family defaults to its mock (`docs/integrations.md`), so
no test needs real credentials. The general pattern:

```ts
import { getEmailProvider, readOutbox, clearOutbox } from '@/integrations/email'

beforeEach(() => clearOutbox())

it('sends an invitation email', async () => {
  await sendInvitation(/* ... */)
  const [message] = readOutbox()
  expect(message.to).toBe('carrier@example.com')
})
```

Each family's `resetXProviderCache()` (`resetFmcsaProviderCache`,
`resetGeoProviderCache`, `resetOcrProviderCache`, `resetEmailProviderCache`,
`resetSmsProviderCache`, `resetPaymentProviderCache`,
`resetTrackingProviderCache`) clears the module-level memoized instance —
use it in a test that flips a `*_DRIVER` env var mid-suite, otherwise the
first-constructed adapter stays cached for the rest of the process.

**Worked example — Stripe webhooks**
(`tests/integration/auth/stripe-webhook.test.ts`,
`tests/unit/integrations/payments/stripe-mock.test.ts`):

```ts
import { emitMockEvent, resetMockPayments } from '@/integrations/payments'

beforeEach(() => resetMockPayments())

it('marks an invoice paid on invoice.paid', async () => {
  const { rawBody, signature } = emitMockEvent('invoice.paid', {
    id: 'in_mock_1',
    metadata: { tenantId, invoiceId },
  })

  const res = await POST(new Request('http://test/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: rawBody,
  }))

  expect(res.status).toBe(200)
  // assert stripe_events row is processed, invoice status updated, etc.
})
```

`emitMockEvent` signs the payload with the exact same HMAC scheme the real
webhook route verifies against — see `docs/integrations.md`'s Stripe
section for why this makes the mock a faithful stand-in, not just a shape
match.

**Worked example — the tracking simulator**
(`tests/integration/tracking/mock-flow.test.ts`,
`tests/unit/integrations/tracking/mock-tracking.test.ts`):

```ts
import { getTrackingProvider, resetMockTrackingSessions } from '@/integrations/tracking'

beforeEach(() => resetMockTrackingSessions())

it('advances a session from started to arrived_pickup', async () => {
  const provider = getTrackingProvider('mock')
  const { sessionId } = await provider.startSession({ loadId, stops })
  const events = await provider.pollEvents(sessionId, null)
  expect(events.map((e) => e.eventType)).toContain('session_started')
})
```

## 4. Security-relevant tests

These are the tests a reviewer should read first — each proves a specific
guarantee this document set claims elsewhere:

| Guarantee | Proven by | What it actually asserts |
|---|---|---|
| Tenant isolation | `tests/integration/auth/search-tenant-isolation.test.ts` | A search/list query scoped to tenant A never returns a row belonging to tenant B, even when both share overlapping data (same DOT number, same name). |
| Permission enforcement | `tests/integration/loads/scope-permissions.test.ts`, `tests/integration/carriers/dispatcher-scope.test.ts`, `tests/integration/equipment/dispatcher-scope.test.ts`, `tests/integration/drivers/admin-only-assignment.test.ts` | A role without a grant is rejected server-side even if a client somehow rendered the control; a Dispatcher's `assigned` scope is bounded to their actual assignments, not every tenant record. |
| Signature integrity | `tests/unit/signatures/seal.test.ts`, `tests/unit/signatures/audit-chain.test.ts` (as `signature-audit-chain` logic), `tests/integration/signatures/ceremony.test.ts` | The HMAC `integritySeal` changes if any sealed field is tampered with; the `signature_audit_events` hash chain detects a missing or reordered event. |
| Financial immutability | `tests/integration/finance/snapshot-versioning.test.ts` | A second calculation on the same load writes version 2, never rewrites version 1; the database trigger rejects a direct `UPDATE` to a computed column. |
| Audit immutability | `tests/integration/audit/immutability.test.ts` | `UPDATE`/`DELETE` against `audit_events` is rejected by Postgres, not merely undone by application discipline. |
| Export scoping | `tests/integration/reports/export-scope-snapshot.test.ts` | An `export_jobs` row's `scopeSnapshot` is frozen at request time — a subsequent permission grant to the requester does not retroactively widen an already-completed export. |

Also worth knowing about, one level down from "security-relevant" but still
load-bearing for the honesty of this document set:
`tests/unit/marketing/i18n-parity.test.ts` fails the build if any English
message key is missing its Spanish counterpart (or vice versa) —
`getDictionary()` would otherwise silently fall back to English for a
missing key, so this test is what turns a translation gap into a build
failure instead of a silent, invisible regression.

## 5. Adding a test at each layer

- **Unit** — colocate as `src/path/to/thing.test.ts` next to the module, or
  add to the matching `tests/unit/<domain>/` directory if it doesn't test
  one specific file. No database, no `server-only` import chain that
  reaches `@/db/client` — if your function needs either, it's an
  integration test.
- **Integration** — add to `tests/integration/<domain>/`. Reuse or extend
  that domain's `fixtures.ts` (e.g. `tests/integration/loads/fixtures.ts`)
  rather than building tenant/user/carrier scaffolding inline — every
  domain directory already has one. Remember the file runs serially with
  every other integration file (§2) — do not add cross-file ordering
  assumptions.
- **Component** — add to `tests/component/`, using
  `tests/component/test-utils.tsx` for the shared render wrapper (provides
  whatever context providers the component under test expects — check
  `src/components/providers/` for what's available).
- **E2E** — this layer has no existing specs to pattern-match against yet
  (§1). If you are the first to add one, create `tests/e2e/`, write a spec
  against `playwright.config.ts`'s existing `webServer` config (it already
  builds and starts the app on port 3100 unless `E2E_BASE_URL` is set), and
  update this document's §1 table once real coverage exists.

## 6. Running everything

```bash
npm run test:unit          # fast, no database
npm run test:integration   # needs TEST_DATABASE_URL reachable
npm test                   # unit + integration + component together
npm run test:coverage      # same, with v8 coverage
npm run test:e2e           # builds + starts the app, runs Playwright (currently: no specs)
npm run verify              # format:check + lint + typecheck + test + build — the pre-merge gate
```
