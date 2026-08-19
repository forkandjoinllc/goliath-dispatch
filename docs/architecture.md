# Goliath Dispatch — Architecture

> Multi-tenant SaaS for US transportation dispatch companies managing multiple
> carriers. Bilingual (English / Spanish), heavy-haul aware, audit-first.

---

## 1. Shape of the system

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Browser                                                                 │
│  • Public marketing site  /{locale}/…      (RSC, static where possible)  │
│  • Application shell      /{locale}/app/…  (RSC + server actions)        │
│  • Public tracking        /{locale}/track/{token}  (no account)          │
└───────────────┬─────────────────────────────────────────────────────────┘
                │  HTTPS, secure cookies, CSP with per-request nonce
┌───────────────▼─────────────────────────────────────────────────────────┐
│ Next.js (App Router, TypeScript)                                        │
│                                                                          │
│  middleware.ts ── locale routing, request id, cookie                     │
│                                                                          │
│  app/[locale]/…            React Server Components                       │
│  server/action.ts          the ONLY way a mutation happens               │
│  server/context.ts         Actor resolution (memoized per request)       │
│  lib/permissions/          role matrix + scope evaluation                │
│  db/tenant-db.ts           tenant-bound data access                      │
│  integrations/             provider interfaces + mock adapters           │
│  jobs/                     idempotent, tenant-aware background work      │
└───────────────┬─────────────────────────────────────────────────────────┘
                │
┌───────────────▼───────────────┐   ┌─────────────────────────────────────┐
│ PostgreSQL (Supabase)         │   │ Private S3-compatible object store   │
│  • 92 tables, all tenant-keyed│   │  tenants/{tenantId}/…                │
│  • append-only audit triggers │   │  short-lived signed URLs only        │
│  • cross-tenant FK guards     │   │  watermarked downloads               │
│  • durable job queue          │   └─────────────────────────────────────┘
└───────────────────────────────┘
```

External providers — Stripe, Twilio, Mailgun, Google Places/Routes, FMCSA,
OCR, Trucker Tools / MacroPoint / Highway — are reached **only** through the
interfaces in `src/integrations/`. Each has a mock adapter that is the default
in development and test, so the entire product runs and its tests pass with no
third-party credentials.

---

## 2. Why these choices

| Decision | Reason |
|---|---|
| **Next.js App Router + RSC** | Dispatch screens are data-dense and read-heavy. Rendering on the server keeps the permission check adjacent to the query and avoids shipping an authorization model to the browser. |
| **Server actions over a REST layer** | Every mutation passes through one harness (`defineAction`) that enforces auth → validation → permission → tenant scope → audit. A REST surface would multiply the places that sequence could be skipped. |
| **Drizzle over an ORM with lazy loading** | Migrations are plain SQL we can read, and the query builder is explicit enough that a tenant predicate is visible in review. |
| **Opaque DB sessions, not JWTs** | Suspension, "sign out everywhere" and ending a support session must take effect immediately. A stateless token cannot be revoked. |
| **Integer cents everywhere** | Settlement disputes are the expensive failure mode. No float ever holds money. |
| **Immutable snapshots for financials** | Fee percentages and expense treatments change. A settled load's math must not. |
| **Self-hosted fonts from npm** | No third-party runtime request, no CSP exception, and CI builds without network access to Google. |

---

## 3. Multi-tenancy

Tenancy is enforced at **four** layers. Any one of them failing is contained by
the next.

1. **Schema** — every tenant-owned table carries `tenant_id`. Composite unique
   keys `(tenant_id, id)` exist on the parent tables.
2. **Database triggers** — `drizzle/custom/0002_tenant_guards.sql` installs a
   `before insert or update` trigger on every high-risk child relationship. A
   row whose parent lives in another tenant is rejected by Postgres, not by
   application code.
3. **Data access** — feature code cannot import `unsafeDb`; ESLint blocks it.
   It uses `tenantDb(tenantId)`, whose every method injects
   `tenant_id = $tenant` and the soft-delete predicate.
4. **Authorization** — `resourceInScope()` re-checks the tenant boundary before
   any scope is evaluated, so a stale id from a client payload cannot cross.

Object storage keys are prefixed `tenants/{tenantId}/…` and the storage layer
refuses to sign a key that does not start with the caller's tenant prefix, so a
guessed key is not sufficient either.

A carrier that works with three dispatch companies is **three rows** in three
tenants. There is no global carrier registry; DOT uniqueness is per tenant.

---

## 4. Authorization

`src/lib/permissions/` holds the whole model:

- **`catalog.ts`** — the permission list and the role matrix. This is the only
  file where a role name appears next to a capability. `docs/permissions.md` is
  generated from it.
- **`check.ts`** — `can()` returns a decision, `authorize()` throws. Both are
  pure functions of the `Actor`, so they are cheap in render paths and directly
  unit-testable.
- **Scopes** — `platform` ⊃ `tenant` ⊃ `assigned` ⊃ `carrier` ⊃ `own`. A grant
  names a scope; the resource facts decide whether a specific record falls
  inside it.

Two rules the product depends on, expressed structurally rather than by an
`if` somewhere:

- **Accounting cannot modify operational loads** — `load:create`,
  `load:update` and `load:assign_resources` are simply absent from its matrix.
- **Drivers do not change load status** — `load:status:update` is absent from
  theirs. Status moves come from tracking ingestion or a Dispatcher/Admin.

The one tenant-configurable exception, `allowDispatcherResourceAssignment`,
lives in `resolveRoleMatrix()` so it is visible in a single place.

**Impersonation** produces an `Actor` whose authority is the target user's but
whose `actorUserId` in every audit row remains the initiator's. Both identities
are recorded on every event.

---

## 5. Request lifecycle of a mutation

```
client form
   └─ server action  ──► defineAction({ name, permission, input, resource, handler, audit })
                            1. requireActor()             → 401 if absent
                            2. zod parse                  → field errors, no throw
                            3. authorize(actor, perm, …)  → 403, scope-aware
                            4. tenantDb(actor.tenantId)   → every query scoped
                            5. handler(input, ctx)        → business rules
                            6. recordAudit(…)             → append-only
                            7. ActionResult<T>            → i18n key, never English
```

Errors are `AppError`s carrying an i18n **key**, never a user-facing English
string, so a Spanish user sees a Spanish failure.

---

## 6. Financial engine

All money is integer cents; all percentages are basis points.

```
commissionableBase   = carrierGrossRate − approvedExcludedExpenses
dispatchFeeAmount    = commissionableBase × carrierDispatchFeeBps
netCarrierSettlement = carrierGrossRate + approvedReimbursables
                       − dispatchFeeAmount − carrierDeductions
grossMargin          = customerCharge − carrierGrossRate − tenantAbsorbedExpenses
dispatcherCommission = selectedBasis × dispatcherCommissionBps
```

- Only **approved** expenses affect the math.
- Permits and escorts ship as `excluded_from_commission` system categories;
  Admin may add more and choose each category's treatment.
- The dispatcher's commission is a cost to the dispatch company. It never
  reduces the carrier's settlement.
- Every input, percentage and output is written to `financial_snapshots` with a
  monotonically increasing `version`. A database trigger rejects updates to the
  computed columns, so history cannot be rewritten when settings change.

---

## 7. Compliance gates

A load cannot be dispatched while any gate is unmet. Gates are evaluated in one
place (`src/server/compliance/`) and return structured, translatable reasons:

| Gate | Blocks |
|---|---|
| Carrier onboarding approved, documents current | any load assignment |
| FMCSA authority valid, verification not stale (7 days) | carrier activation |
| Equipment VIN present on the approved COI | equipment assignment |
| ≥ 4 equipment photos | equipment activation |
| Equipment active, registration/inspection current | equipment assignment |
| Driver approved, licence + medical card unexpired | driver assignment |
| No overlapping commitment for truck/trailer/driver | resource assignment |
| Oversize evaluation validated by Admin | dispatch |
| Required permits issued and unexpired; escorts confirmed | dispatch |

Overrides exist where the business requires them (FMCSA mismatch, COI/VIN
mismatch) but only for Admin and Accounting, only with a written reason, and
always recorded as `verification.override` in the audit trail.

---

## 8. Background work

`job_queue` is a durable table drained by Vercel Cron routes under
`/api/cron/*`, authenticated with `CRON_SECRET`. Every handler:

- is **idempotent** (a `dedupeKey` makes double-enqueue harmless),
- is **tenant-aware** (it iterates tenants explicitly; there is no ambient one),
- retries with backoff up to `maxAttempts`, then moves to `dead_letter`.

Scheduled work: FMCSA reverification (7-day), document-expiration sweep,
notification delivery, Stripe webhook processing, invoice overdue transitions,
PDF and watermark generation, OCR/VIN extraction, route and oversize
evaluation, tracking ingestion, public-link expiry, retention archival,
permanent deletion, report exports.

---

## 9. Retention

| Class | Active | Then | Purge |
|---|---|---|---|
| Operational records | 24 months | protected archive | 5 years after archival |
| `loads` specifically | 24 months | protected archive | 5 years after archival, **anonymized, not deleted** — see below |
| Financial, invoices, signed agreements, signature certificates | — | — | never before 7 years |
| `signature_records` / `signature_audit_events` specifically | — | — | **never** — see below |

A `legal_holds` row blocks archival and purge for its scope. `TenantDb.purge()`
refuses to run without an explicit `legalHoldChecked` proof, which makes an
accidental hard delete a compile-time visible mistake.

**Two tables cannot be hard-deleted, by design, and the retention pipeline
does not try to work around either:**

- **`loads` are anonymized, not deleted.** `load_status_history` and
  `financial_snapshots` are append-only children of a load —
  `drizzle/custom/0001_audit_immutability.sql` rejects every `UPDATE`/`DELETE`
  against them unconditionally, on purpose, so a bug or a compromised
  application role can never rewrite a settled load's history. Both cascade
  from `loads.id`, so once a load has gone through even one status
  transition, a real `DELETE FROM loads` can never succeed. Weakening the
  trigger to permit a "retention-authorized" delete would reopen exactly the
  hole it exists to close, so the retention job does not do that either. A
  load past its purge-eligible date is instead **soft-deleted and
  redacted**: `retention-purge.ts`'s weekly sweep sets `deletedAt` (which
  drops it out of every ordinary tenant-scoped query, the same as a
  user-initiated delete) and clears its free-text columns
  (`customerReference`, `poNumber`, `specialInstructions`,
  `internalNotes`, `cancellationReason`), while leaving its id, dates,
  financial columns and FKs intact. `financial_snapshots` — the actual
  source of truth for a load's money — is unaffected either way; it is
  already independently retained under the financial 7-year floor above.
  `@/server/retention/policy.ts`'s `classifyEntity('loads').purgeStrategy`
  (`'anonymize'`) is the one place this decision lives; the job reads it
  rather than re-deciding locally.
- **`signature_records` (and their `signature_audit_events`) are never
  purged, at any age.** They are executed legal instruments — a hash chain
  and integrity seal whose evidentiary value must never expire —  and
  `signature_records_guard` forbids their deletion unconditionally, with no
  anonymize fallback. This is a permanent retention rule, not a gap: no
  purge path is implemented for them, and none should be.

---

## 10. Internationalization

- URL carries the locale: `/{en|es}/…`. Shareable, cacheable, indexable.
- Messages are namespaced JSON under `src/i18n/messages/{locale}/`.
- English is the fallback; a Spanish gap renders English, never a raw key.
- Dates render in the **stop's** local timezone with the tenant timezone
  available; money is USD; measurements are imperial.
- Emails, SMS and generated PDFs all resolve through the same dictionaries.

---

## 11. Environments

| | Development | Staging | Production |
|---|---|---|---|
| Database | local Postgres or Supabase branch | Supabase staging project | Supabase production |
| Storage | `STORAGE_DRIVER=local` | private S3 bucket | private S3 bucket |
| Stripe | `mock` or test keys | test keys | live keys |
| Twilio / Mailgun / Google / FMCSA | `mock` | sandbox keys | live keys |
| Jobs | `npm run jobs:run` | Vercel Cron | Vercel Cron |
| Seed | demo data | anonymized subset | none |

`ALLOW_DEMO_SEED` must be `false` outside development; the seed refuses to run
against `APP_ENV=production`.

---

## 12. Conventions

- **Files**: `kebab-case.ts`. Components `PascalCase` exports.
- **No client-side authorization.** `can()` in a component controls *visibility
  only*; the server action re-checks.
- **No placeholder UI.** Every visible control either works or renders the
  `comingSoon` state, which names the provider it is waiting on.
- **No hard-coded user-facing text.** Every string resolves through `t()`.
- **Soft delete by default.** Hard deletion only via the retention pipeline.
- **Every table gets tenant, status and foreign-key indexes**; search columns
  are stored pre-normalized (`companyNameNormalized`, `vinNormalized`,
  `phoneNormalized`) so lookups stay index-backed.
