# Contributing to Goliath Dispatch

This document is conventions, not tooling instructions — for how to run
things, see `README.md`'s Quick Start and `docs/testing.md`.

## File and code conventions

- **Files:** `kebab-case.ts` / `kebab-case.tsx`. Directories mirror this too
  (`src/server/loads/`, not `src/server/Loads/`). React component **exports**
  are `PascalCase`, matching the convention `docs/architecture.md` §12
  states.
- **No client-side authorization.** `can()` in a component controls
  *visibility only* — it decides whether to render a button, never whether
  an action is allowed. The server action re-checks unconditionally. If
  you're tempted to skip the server-side check because "the button is
  already hidden," don't — the button being hidden is a UX courtesy, not a
  security boundary.
- **No placeholder UI.** Every visible control either works or renders the
  `comingSoon` state, which names the specific provider it's waiting on
  (see how the tracking settings screen presents Trucker Tools/MacroPoint/
  Highway, or how the toll estimate field behaves — never a dead button
  with no explanation).

## Every mutation goes through `defineAction`

`src/server/action.ts`'s `defineAction()` is the **only** way a mutation
happens in this codebase. It guarantees, in this order: an authenticated
actor, Zod-validated input, a server-side permission check (`authorize()`,
never a role-name string comparison), a tenant-bound `TenantDb` handle, an
audit event on success, and an `ActionResult<T>` shaped for the client
(i18n message key, never raw English text, never a stack trace).

Writing a server action that bypasses `defineAction` — calling
`tenantDb()` or `unsafeDb` directly from a route handler or a
"just this once" helper — is possible in TypeScript but is exactly the kind
of thing code review exists to catch. If you find yourself wanting to skip
a step `defineAction` would otherwise force, that's a signal to slow down,
not a reason to route around it.

`loadFor()` in the same file is the read-side equivalent for Server
Components: it enforces the permission and hands back a `TenantDb`, but
throws (for an error boundary to catch) instead of returning a result
shape, since a page render has no form to attach field errors to.

## The `unsafeDb` boundary

`eslint.config.mjs` blocks importing `unsafeDb` from `@/db/client` anywhere
outside an explicit allow-list:

```
src/db/**            — migrations, seeds, tenant-db.ts itself
src/jobs/**           — schedulers that sweep every tenant in turn
src/lib/auth/**       — sessions/identity are global, not tenant-owned
src/lib/audit.ts      — writes platform-level events with no active tenant
src/lib/rate-limit.ts
src/server/context.ts — resolves which tenant the actor is even in
src/server/platform/** — Super Admin tooling, deliberately cross-tenant
src/server/auth/**    — identity is global by definition
src/server/tenants/**  — tenant/subscription management is global
src/server/search/**   — see that module's own comment for why
src/app/api/**, tests/**, scripts/**, *.test.ts, *.spec.ts
```

The rationale, not just the rule: `tenantDb(tenantId)` injects the tenant
predicate and soft-delete filter into every query it builds. A feature
module reaching for `unsafeDb` instead is a module that has opted out of
that guarantee — the allow-list above is every place that opt-out is
*structurally correct* (there genuinely is no single tenant to scope to),
not a list of exceptions granted for convenience. If your new code needs
`unsafeDb` and your module isn't on the list, the question to ask first is
whether the module belongs on the list (because it's genuinely
cross-tenant, like `src/server/platform/**`) or whether the code should be
restructured to use `tenantDb()` instead. Do not add a directory to the
allow-list to make a one-off query easier to write.

## The i18n rule

No user-facing string is hard-coded in a component, an email template, an
SMS body, or a generated PDF. Every such string resolves through `t()`
against the dictionaries in `src/i18n/messages/{en,es}/*.json`
(`src/i18n/dictionary.ts`, `src/i18n/translate.ts`). This includes:

- Validation and error messages (`AppError` carries a `messageKey`, never a
  literal string — see `src/lib/errors.ts` and every action's error path).
- System-narrated messages in a conversation thread (`messages.systemKey` +
  `systemParams`, not a literal `body` string).
- PDF and email copy (`src/lib/pdf/**`, `src/integrations/email/templates.ts`
  both resolve through the same dictionaries per architecture.md §10).

**Both locales move together.** Adding an English key without its Spanish
counterpart is not "finish the translation later" — it's a build failure.
`tests/unit/marketing/i18n-parity.test.ts` collects every dotted key in
`marketing.json` for both locales and fails if either side has a key the
other doesn't; the same discipline applies to every other namespace even
where a dedicated parity test doesn't yet exist for it — if you add one for
a namespace that doesn't have it, follow that test's pattern.
`getDictionary()` silently falls back to English for a missing Spanish key
at runtime, which is exactly the failure mode a parity test exists to catch
before it ships, not after.

## The money rule

Every monetary value is an integer number of US cents
(`src/lib/money/index.ts`'s `Cents` type, the `cents()` schema helper in
`src/db/schema/_shared.ts`). Every percentage is an integer count of basis
points (`Bps`). Never introduce a `number` that represents dollars, and
never store or compute with a JavaScript float for money. If you need a new
monetary column, use `cents(name)` from `_shared.ts`; if you need a new
calculation, extend `src/lib/money/index.ts` rather than doing arithmetic
inline in a server action — `assertInteger()` there exists specifically to
catch a non-integer value at the point of calculation, not three steps
downstream in a settlement PDF.

If a calculation's result needs to be historically reproducible (i.e.
anything that could appear on an invoice, settlement, or carrier-facing
statement), write it into `financial_snapshots` as a new version — never
mutate a prior calculation in place. See `docs/data-model.md` §4.

## The audit rule

Any action that changes state a reviewer might later need to reconstruct —
which in practice is nearly everything `defineAction` wraps — should pass
an `audit` callback (or call `ctx.audit()` directly inside the handler for
something conditional). Use the closest-fitting existing `auditAction` enum
value (`src/db/schema/_shared.ts`); add a new one only when nothing fits,
since it requires a migration (see below). A `reason` is **required**, not
optional, on: any verification override, any impersonation-related event,
any deletion, and any legal hold action — `defineAction`/the underlying
service function should validate this itself rather than trusting the
caller.

Never write directly to `audit_events` outside `src/lib/audit.ts`'s
`recordAudit()` — that module is the one place the append-only guarantee
and the actor/effective-actor distinction (architecture.md §4's
impersonation note) are assembled correctly.

## The soft-delete rule

Deletion, from a user's perspective, sets `deletedAt`/`deletedBy`/
`deletionReason` (the `softDelete` spread in `_shared.ts`) — it never issues
a SQL `DELETE`. `tenantDb`'s default read methods already filter
`deletedAt IS NULL`; you do not need to add that predicate yourself in
ordinary feature code. Hard deletion happens **only** through the retention
pipeline (`src/server/retention/`, `src/jobs/handlers/retention-purge.ts`),
which requires an explicit, compile-time-visible `legalHoldChecked` proof
before it will run — see `docs/data-model.md` §5 and
`docs/operations.md` §4 for the full mechanics. If a feature seems to need
a real `DELETE`, it almost certainly doesn't; ask before writing one.

## Adding a permission

1. Add the permission to `PERMISSIONS` in `src/lib/permissions/catalog.ts`
   (the `resource:action` key, bilingual description) and grant it to the
   appropriate role(s) at the appropriate scope in the role matrix in the
   same file.
2. Regenerate `docs/permissions.md`: `npm run docs:permissions`.
3. Add or extend an integration test proving the grant behaves as intended
   — both that the intended role *can* and that an unintended role
   *cannot* (see `tests/integration/loads/scope-permissions.test.ts` for the
   pattern). `tests/unit/permissions/generate-permissions-doc.test.ts`
   already asserts the committed `docs/permissions.md` matches what the
   generator produces byte-for-byte — if you forget step 2, CI catches it,
   but do it as part of the same commit regardless.
4. If the permission is one of the two "structural absence" guarantees
   architecture.md §4 describes (Accounting cannot touch operational loads;
   Drivers do not change load status), do not add it to those roles even
   as a scope you intend to leave unused — the guarantee is the *absence*
   of the row, not a row with a scope nobody currently exercises.

## Adding a migration

1. Change the Drizzle schema in `src/db/schema/**`.
2. `npm run db:generate` to produce the generated SQL migration under
   `drizzle/`.
3. If the change needs something Drizzle's schema DSL cannot express — a
   trigger, a cross-table check constraint, a partial index with a `WHERE`
   clause Drizzle doesn't support directly — add or extend a file under
   `drizzle/custom/`, numbered after the existing two
   (`0001_audit_immutability.sql`, `0002_tenant_guards.sql`). Every custom
   file **must be idempotent** (`create or replace function`, `drop trigger
   if exists` before `create trigger`, `exception when duplicate_object`
   around `alter table ... add constraint`) — both files are re-applied on
   every `npm run db:migrate` and in every integration test run's
   `db-setup.ts`, so a non-idempotent statement breaks the second run, not
   just a hypothetical replay.
4. Run `npm run db:migrate` locally to confirm it applies cleanly, then run
   the integration test suite (`npm run test:integration`), which
   re-applies every migration (including `drizzle/custom/**`) against a
   throwaway test database on every run.
5. If the new table/column carries money, add it via the `cents()`/`Bps`
   patterns above. If it's tenant-owned, add `tenantId` and the standard
   tenant/status/foreign-key indexes (architecture.md §12). If it
   participates in retention, add `...retention` and register it in
   `src/server/retention/policy.ts`'s `classifyEntity()` map — the retention
   job handler and the settings UI both depend on that one map agreeing.

## Adding an i18n namespace

1. Create `src/i18n/messages/en/<namespace>.json` and
   `src/i18n/messages/es/<namespace>.json` with matching key structure.
2. Register the namespace so `getDictionary()`/`t()` can resolve it — check
   `src/i18n/namespaces.ts` for how the existing 22 namespaces are wired and
   follow the same pattern.
3. Add a parity test for the new namespace (copy the shape of
   `tests/unit/marketing/i18n-parity.test.ts`, pointed at your new files)
   rather than relying on the marketing one to somehow catch a gap in an
   unrelated namespace — it can't, it only reads `marketing.json`.

## Adding a job

1. Write the handler in `src/jobs/handlers/<name>.ts`, ending with a
   `defineJob('<job.type>', { schema, handler, defaultMaxAttempts,
   description })` call — see any existing handler for the shape. The
   handler receives a validated, typed payload (validated against `schema`
   by the registry *before* your handler ever sees it) and a `JobContext`
   with an explicit `tenantId` (nullable only for genuinely platform-level
   sweep jobs).
2. Import the new file from `src/jobs/handlers/index.ts` — this is the
   side-effecting import that actually registers the job type; without it,
   `getJobDefinition()` never finds your handler and any enqueued job of
   that type sits `queued` forever (or dead-letters as "unknown job type"
   if the row somehow gets claimed before this import runs, which shouldn't
   happen in practice since the import is transitive from `runner.ts`).
3. Enqueue it with `enqueue()` from `src/jobs/queue.ts`, passing a
   `dedupeKey` whenever double-enqueuing the same logical work would be
   harmful (most cases) — a repeat enqueue with a colliding key is a
   harmless no-op, never a duplicate row.
4. If it needs a recurring schedule rather than being enqueued reactively,
   add a route under `src/app/api/cron/<name>/route.ts` (copy an existing
   one — the shared shape is `authorizeCronRequest()` then call `drain()`
   with `jobType` set, or run your own sweep logic that itself calls
   `enqueue()` per unit of work) and add the schedule to `vercel.json`.
5. Write a test in `tests/integration/jobs/` if the handler touches the
   database (most do), or `tests/unit/jobs/` if it's pure logic.

## Before you open a PR

Run `npm run verify` — `format:check` → `lint` → `typecheck` → `test`
(unit + integration + component) → `build`, in that order, matching exactly
what `.github/workflows/ci.yml` runs. There is no git pre-commit hook
enforcing this in this repository (no Husky/lint-staged config exists) —
running it is a convention, not a mechanically enforced gate, so treat a
green `npm run verify` as your own responsibility before pushing, not
something CI will catch for you before a teammate sees a broken branch.
