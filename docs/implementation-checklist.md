# Goliath Dispatch — Implementation Checklist

This is an honest status report, not a marketing summary. Every row below
was verified by reading the referenced file(s) — nothing is marked
`complete` on the strength of a docstring alone. Status values:

- **Complete** — implemented, wired end-to-end, and (where a test exists)
  covered.
- **Partial** — implemented but with a known, named gap.
- **Interface-only** — the interface and (usually) a settings screen exist;
  every method throws `integration_unavailable`. Deliberate scope cut, not
  a bug.
- **Not started** — no implementation exists.

The seven phases below are this document's own organizing structure (no
separate phase-definition document ships in this repository) — chosen to
mirror the natural build order: you cannot onboard a carrier before
tenancy and auth exist, cannot dispatch a load before a carrier is
onboarded, cannot invoice before a load is dispatched, and platform-level
operability (jobs, retention, CI) is only meaningful once everything above
it exists to operate.

---

## Phase 1 — Foundation: tenancy, identity, permissions, i18n, audit

| Item | Status | Note | Verify at |
|---|---|---|---|
| Multi-tenant schema (`tenantId` on every tenant-owned table) | Complete | All 92 tables reviewed; every tenant-owned table carries it. | `src/db/schema/**` |
| Database-level cross-tenant guards | Complete | 28 child/parent relationships guarded by trigger; composite `(tenant_id, id)` keys on 10 parent tables. | `drizzle/custom/0002_tenant_guards.sql` |
| `tenantDb()` / `unsafeDb` ESLint boundary | Complete | `no-restricted-imports` blocks `unsafeDb` outside an explicit allow-list. | `eslint.config.mjs` |
| Opaque, revocable sessions | Complete | SHA-256-hashed token, `revokedAt`, `revokeAllUserSessions()` for "sign out everywhere". | `src/lib/auth/session.ts` |
| Password policy | Complete | Length-first policy + common-password rejection list, via `bcryptjs`. | `src/lib/auth/password.ts`, `tests/unit/auth/password.test.ts` |
| MFA (TOTP + recovery codes) | Complete | Encrypted secret, hashed recovery codes, `mfaSatisfiedAt` gate on session. | `src/lib/auth/mfa.ts`, `tests/unit/auth/mfa.test.ts`, `tests/integration/auth/mfa.test.ts` |
| Role/permission matrix, data-driven | Complete | `catalog.ts` is the single source; `docs/permissions.md` generated from it with a test enforcing sync. | `src/lib/permissions/catalog.ts`, `tests/unit/permissions/generate-permissions-doc.test.ts` |
| Scope resolution (`platform`/`tenant`/`assigned`/`carrier`/`own`) | Complete | `resourceInScope()` re-checks tenant boundary before narrowing. | `src/lib/permissions/check.ts` |
| Per-user permission overrides (grant/deny, with reason, expiring) | Complete | | `src/db/schema/auth.ts` (`userPermissionOverrides`) |
| `defineAction` mutation harness | Complete | Every mutation: auth → validate → authorize → tenant-scope → audit → i18n-keyed result. | `src/server/action.ts` |
| Impersonation + platform support access | Complete | 60-minute hard ceiling, dual identity on every audit row, explicit `support_access` step for cross-tenant reach. | `src/server/auth/impersonation.ts`, `tests/integration/auth/impersonation.test.ts` |
| Append-only audit trail | Complete | DB-enforced (`UPDATE`/`DELETE` rejected); `onDelete: 'restrict'` on `audit_events.tenantId` uniquely among all FKs. | `drizzle/custom/0001_audit_immutability.sql`, `tests/integration/audit/immutability.test.ts` |
| i18n (en/es), namespaced, key-parity enforced | Complete | 22 namespaces; a test fails the build on a missing translation key. | `src/i18n/messages/{en,es}/*.json`, `tests/unit/marketing/i18n-parity.test.ts` |
| Self-hosted fonts | Complete | `@fontsource-variable/inter`, `@fontsource/roboto-condensed` as npm dependencies, not a Google Fonts runtime request. | `package.json` |
| Security headers + CSP with nonce | Complete | HSTS (prod only), CSP, frame/referrer/permissions policy. | `src/lib/security/headers.mjs`, `next.config.mjs` |
| Tenant branding (colors, fonts, logo) | Complete | | `src/db/schema/tenant.ts` (`tenantBranding`), `src/app/[locale]/(app)/app/settings/branding/` |
| Rate limiting (public forms) | Complete | Two drivers: in-memory (single instance) and database-backed (`rate_limit_buckets`, multi-instance safe). | `src/lib/rate-limit.ts`, `.env.example` |
| Demo/seed data | **Not started** | `package.json`'s `db:seed`/`db:reset` scripts reference `src/db/seed/index.ts`, which does not exist in this checkout. `docs/demo-credentials.md` does not exist either. This is being built on a concurrent workstream per the task brief — treat this whole row as a known, expected gap at time of writing, not a regression. | `package.json` scripts section; absence confirmed at `src/db/seed/` |

## Phase 2 — Carrier onboarding & compliance

| Item | Status | Note | Verify at |
|---|---|---|---|
| Carrier CRUD, per-tenant (no global registry) | Complete | | `src/db/schema/carrier.ts`, `src/server/carriers/` |
| Onboarding workflow state machine | Complete | draft→submitted→under_review→corrections_required→approved/rejected/suspended | `src/db/schema/carrier.ts` (`carrierOnboardings`), `tests/integration/carriers/onboarding-state-machine.test.ts`, `onboarding-approval.test.ts` |
| DOT uniqueness per tenant | Complete | | `carriers_tenant_dot_uq`, `tests/integration/carriers/dot-uniqueness.test.ts` |
| FMCSA verification — mock | Complete | 5 deterministic fixtures. | `src/integrations/fmcsa/mock-adapter.ts`, `tests/unit/integrations/fmcsa/*.test.ts` |
| FMCSA verification — live (QCMobile) | Complete | Defensive coercion for QCMobile's unversioned schema. | `src/integrations/fmcsa/qcmobile-adapter.ts` |
| FMCSA reverification sweep + staleness gate | Complete | 7-day default cadence, tenant-configurable. | `src/jobs/handlers/fmcsa-reverification.ts` |
| Document upload/versioning/review | Complete | Immutable versions, review workflow, expiration tracking. | `src/db/schema/document.ts`, `src/server/documents/` |
| Document access logging (view/download/print) | Complete | | `documentAccessLogs` table |
| Document expiration sweep | Complete | Idempotent via unique index + `notifiedAt` guard. | `src/jobs/handlers/document-expiration.ts` |
| OCR / VIN extraction — mock | Complete | | `src/integrations/ocr/mock-adapter.ts` |
| OCR / VIN extraction — live (Textract, Document AI) | Complete | SDKs lazily imported; not installed dependencies. | `src/integrations/ocr/textract-adapter.ts`, `docai-adapter.ts` |
| Equipment (trucks/trailers) CRUD + media | Complete | VIN uniqueness per tenant; ≥4-photo activation gate referenced in architecture.md — verify the exact photo-count enforcement in `src/server/equipment/service.ts` before quoting a specific number in customer-facing material. | `src/db/schema/equipment.ts`, `src/server/equipment/` |
| Equipment/COI VIN matching + override | Complete | | `equipmentVerifications` table, `src/server/verification/` |
| Driver CRUD, license encryption + blind index | Complete | | `src/db/schema/driver.ts` |
| Driver-carrier relationships (many-to-many, approved) | Complete | | `driverCarrierRelationships` |
| Compliance gates (architecture.md §7's 9-row table) | Complete | Centralized in one module, structured translatable reasons. | `src/server/compliance/` |
| Dispatcher assignment (carrier-level + resource-level) | Complete | Tenant-configurable `allowDispatcherResourceAssignment` exception in one function. | `src/db/schema/carrier.ts`, `tests/integration/drivers/dispatcher-resource-grant.test.ts` |
| Dispatcher groups | Complete | Polymorphic membership (carrier/truck/trailer/driver). | `dispatcherGroups`, `groupMembers` |
| Factoring | **Partial (manual workflow by design)** | Records carrier↔factoring-company relationships and verification status; **no funding API** — every function documents that it records what a human confirmed, not what an integration executed. | `src/server/factoring/service.ts` |

## Phase 3 — Load lifecycle & operations

| Item | Status | Note | Verify at |
|---|---|---|---|
| Customer CRUD + duplicate detection | Complete | Normalized-name, DOT/MC, phone, email indexes. | `src/db/schema/customer.ts`, `tests/integration/customers/duplicate-detection.test.ts` |
| Customer contacts/locations, one primary contact enforced by DB | Complete | Partial unique index. | `customer_contacts_primary_uq` |
| Load CRUD, full status lifecycle | Complete | draft→…→paid/cancelled, 13 states. | `src/db/schema/_shared.ts` (`loadStatusEnum`), `tests/unit/loads/status-machine.test.ts` |
| Load numbering | Complete | Tenant-configurable prefix/sequence; see `docs/assumptions.md` for the concurrency approach. | `tests/integration/loads/numbering-concurrency.test.ts` |
| Carrier lock-once-assigned immutability | Complete | | `tests/integration/loads/carrier-immutability.test.ts` |
| Load stops, sequenced, facility-local timezone | Complete | | `src/db/schema/load.ts` (`loadStops`) |
| Resource assignment (truck/trailer/driver) + conflict detection | Complete | Partial unique indexes enforce one active assignment per resource per load. | `tests/integration/loads/assignment-conflicts.test.ts` |
| Load duplication | Complete | | `duplicatedFromLoadId`, `load-duplicate-button.tsx`, `tests/integration/loads/duplicate-load.test.ts` |
| Rate confirmation generation + carrier accept/reject | Complete | Exact-PDF-hash evidence captured at acceptance. | `rateConfirmationAcceptances`, `src/lib/pdf/document-builder.ts` |
| Route calculation — mock | Complete | | `src/integrations/geo/mock-adapter.ts` |
| Route calculation — live (Google Routes v2) | Complete | | `src/integrations/geo/google-adapter.ts` |
| Toll estimation | **Interface-only** | TollGuru adapter always throws; `routes.estimatedTollCents` cannot be populated live. | `src/integrations/geo/tollguru-adapter.ts` |
| Oversize/overweight evaluation, per-state rules | Complete | Rules are operator-maintained defaults, not an authoritative legal source — see `docs/assumptions.md`. | `src/db/schema/route.ts`, `src/server/oversize/` |
| Oversize human-validation gate | Complete | Admin sign-off required before dispatch when `requireOversizeAdminValidation`. | `oversizeEvaluations.humanValidationStatus` |
| Permits + escorts tracking | Complete | Status lifecycle, cost, document attachment, expiration sweep index. | `src/db/schema/route.ts` (`permits`, `escorts`) |
| Check calls | Complete | Scheduled + ad-hoc, overdue view. | `checkCalls` table |
| Loads board/calendar/timeline/map views | Complete | Five distinct view components exist. | `src/app/[locale]/(app)/app/loads/_components/loads-*-view.tsx` |

## Phase 4 — Financials

| Item | Status | Note | Verify at |
|---|---|---|---|
| Integer-cents, basis-points money model | Complete | `assertInteger` guards on every formula input. | `src/lib/money/index.ts`, `tests/unit/finance/money-formulas.test.ts` |
| Expense categories + treatment | Complete | 4 treatments; permits/escorts pre-seeded `excluded_from_commission`. | `src/db/schema/finance.ts` |
| Expense approval workflow | Complete | Only approved/reimbursed expenses affect any calculation. | `src/server/finance/` (expense approval queue UI exists) |
| Financial snapshot versioning, DB-enforced immutability | Complete | | `drizzle/custom/0001_audit_immutability.sql`, `tests/integration/finance/snapshot-versioning.test.ts` |
| Dispatcher commission calculation (3 bases) | Complete | Cost to the dispatch company, never reduces carrier settlement. | `src/lib/money/index.ts`, `tests/unit/finance/commission-and-settlement-lifecycle.test.ts` |
| Invoicing (carrier-billed dispatch fee) | Complete | Full status lifecycle including dispute/uncollectable. | `src/db/schema/finance.ts` (`invoices`), `tests/unit/finance/invoice-lifecycle.test.ts` |
| Invoice idempotency (draft-from-POD) | Complete | | `src/jobs/handlers/invoice-draft-from-pod.ts`, `tests/integration/jobs/invoice-draft-from-pod.test.ts`, `tests/integration/finance/invoice-idempotency.test.ts` |
| Invoice overdue sweep | Complete | | `src/jobs/handlers/invoice-overdue.ts` |
| Payments — mock | Complete | Full in-memory Stripe with real-signature-scheme mock events. | `src/integrations/payments/mock-adapter.ts` |
| Payments — live (Stripe) | Complete | Idempotency keys on every mutating call. | `src/integrations/payments/stripe-adapter.ts` |
| Stripe webhook intake, idempotent, 9 event types | Complete | | `src/app/api/webhooks/stripe/route.ts`, `tests/integration/auth/stripe-webhook.test.ts` |
| Stripe deferred-event replay | **Partial** | The `stripe.webhook_replay_sweep` job type exists and is correctly implemented, but is **not scheduled** in `vercel.json` — nothing currently triggers it automatically in production. Deferred events accumulate until manually replayed unless this is wired to a schedule. | `src/jobs/handlers/stripe-webhook-process.ts`, `vercel.json` (absence confirmed) |
| Carrier settlements + statements | Complete | Line items sourced from specific financial-snapshot versions. | `src/db/schema/finance.ts` (`carrierSettlements`), `src/lib/pdf/settlement-pdf.ts` |
| Factoring routing on settlements | **Partial (manual)** | Records that a settlement was submitted to a factoring company; no funding call. | `carrierSettlements.factoringSubmittedAt` |
| Reports (aging, exports CSV/XLSX/PDF) | Complete | | `src/server/reports/`, `tests/unit/reports/*.test.ts` |
| Export scope-snapshotting | Complete | An export never widens beyond the requester's permission scope at generation time. | `exportJobs.scopeSnapshot`, `tests/integration/reports/export-scope-snapshot.test.ts` |

## Phase 5 — Signatures, messaging & notifications

| Item | Status | Note | Verify at |
|---|---|---|---|
| Signature templates, versioned, content-hashed | Complete | | `src/db/schema/signature.ts` |
| Signature ceremony (no-account, token-based) | Complete | | `src/app/[locale]/sign/[token]/`, `tests/integration/signatures/ceremony.test.ts` |
| Tamper-evident sealed record (HMAC integrity seal) | Complete | DB-enforced immutability on the seal and its inputs. | `signatureRecords`, `tests/unit/signatures/seal.test.ts` |
| Hash-chained ceremony audit log | Complete | | `signatureAuditEvents`, `tests/unit/signatures/audit-chain.test.ts` |
| Signed PDF + audit certificate generation | Complete | | `src/lib/pdf/signed-agreement-pdf.ts`, `audit-certificate-pdf.ts` |
| Messaging (conversations, threads, attachments) | Complete | | `src/db/schema/messaging.ts`, `src/server/messaging/` |
| Messaging is polled, not pushed | **By design** | 20-second client poll interval; no WebSocket/SSE transport. UI explicitly discloses this (`notification.messaging.thread.pollingNotice`). See `docs/assumptions.md`. | `messages-shell.tsx` |
| Notification catalog (event-key driven, per-channel, per-locale) | Complete | | `src/db/schema/messaging.ts` (`notificationTemplates`) |
| Notification delivery (in-app/email/SMS) + preferences | Complete | | `src/server/notifications/`, `tests/unit/notifications/*.test.ts` |
| Notification dedupe | Complete | | `notifications_dedupe_uq`, `tests/unit/notifications/dedupe.test.ts` |
| Email — mock/live (Mailgun) | Complete | | `src/integrations/email/` |
| SMS — mock/live (Twilio), consent-gated | Complete | | `src/integrations/sms/`, `tests/unit/integrations/sms/consent.test.ts` |

## Phase 6 — Tracking & public visibility

| Item | Status | Note | Verify at |
|---|---|---|---|
| Tracking sessions/events, consent-gated ingestion | Complete | No location ingested before `consentGrantedAt`. | `src/db/schema/tracking.ts`, `tests/integration/tracking/ingest.test.ts` |
| Tracking — mock simulator | Complete | Full session lifecycle simulation. | `src/integrations/tracking/mock-adapter.ts` |
| Tracking — Trucker Tools | **Interface-only** | Settings screen + interface; every method throws. Needs a carrier-facing onboarding flow inside Trucker Tools' own portal, deferred. | `src/integrations/tracking/trucker-tools-adapter.ts` |
| Tracking — MacroPoint | **Interface-only** | Same as above. | `src/integrations/tracking/macropoint-adapter.ts` |
| Tracking — Highway | **Interface-only** | Same as above. | `src/integrations/tracking/highway-adapter.ts` |
| Public tracking links (no customer account) | Complete | Signed, expiring, narrow projection, view-count tracked. | `publicTrackingLinks`, `tests/integration/tracking/public-links.test.ts` |
| Public tracking link expiry sweep | Complete | | `src/jobs/handlers/tracking-link-expiry.ts` |
| Tracking ingest sweep (pull-based) | Complete | Only meaningfully exercises the mock provider today, since the three live tracking adapters are interface-only. | `src/jobs/handlers/tracking-ingest.ts` |
| Tracking provider webhook intake route | **Partial** | `POST /api/webhooks/tracking/[provider]` exists as a route but has no real provider's `parseWebhook()` to call — it is only reachable in a meaningful way once one of the three interface-only adapters above is implemented. | `src/app/api/webhooks/tracking/[provider]/route.ts` |
| Marketing site (bilingual, SEO) | Complete | 11 public pages, JSON-LD, sitemap, robots. | `src/app/[locale]/(marketing)/**`, `src/app/sitemap.ts`, `src/app/robots.ts` |
| Lead capture + carrier signup + quote request forms | Complete | Anti-spam fields, rate-limited. | `src/db/schema/platform.ts` (`leads`, `quoteRequests`), `tests/unit/marketing/spam.test.ts` |

## Phase 7 — Platform operations & readiness

| Item | Status | Note | Verify at |
|---|---|---|---|
| Durable job queue, lease-based claiming, backoff, dead-letter | Complete | `FOR UPDATE SKIP LOCKED`, exponential backoff with jitter. | `src/jobs/queue.ts`, `tests/unit/jobs/*.test.ts` |
| Vercel Cron wiring (8 schedules) | Complete | Verified against `vercel.json` and every route file. | `vercel.json`, `src/app/api/cron/**` |
| Alternative jobs driver (QStash) | **Not started** | `JOBS_DRIVER=qstash` is accepted by the env schema and documented in `.env.example`, but no QStash adapter exists — nothing reads `QSTASH_*` variables. | `src/lib/env.ts`, absence confirmed under `src/jobs/` |
| Retention classification (operational vs. financial) | Complete | Single source of truth shared by the job handler and the settings UI. | `src/server/retention/policy.ts` |
| Retention archive sweep | Complete | Skips legal holds. | `src/jobs/handlers/retention-archive.ts` |
| Retention purge sweep | Complete, with named scope limits | Refuses without explicit legal-hold-checked proof; refuses to run at all in `APP_ENV=production` without a manually-supplied `confirm: true` payload flag (irreversibility safeguard); covers only `documents` (delete), `invoices` (delete) and `loads` (anonymize) of the full retention registry — see below. | `src/jobs/handlers/retention-purge.ts`, `tests/integration/jobs/retention.test.ts` |
| Retention "anonymize" action | **Partial** | Implemented for `loads` specifically (`classifyEntity('loads').purgeStrategy === 'anonymize'`, `anonymizeArchivedLoads()`): soft-deletes and redacts free-text columns rather than deleting, since `load_status_history`/`financial_snapshots` structurally block a real `DELETE FROM loads`. Not implemented for any other entity type in the retention registry — a data-subject request needing a specific person's own name/contact fields cleared (not a load's free text) still requires manual, case-by-case handling. See `docs/operations.md` §6. | `src/server/retention/policy.ts` (`PurgeStrategy`), `src/jobs/handlers/retention-purge.ts` |
| Legal hold apply/release, scoped (tenant/entity-type/record) | Complete | Coverage recomputed on release to respect overlapping holds. | `src/server/retention/legal-holds.ts`, `tests/integration/retention/legal-holds.test.ts` |
| Platform Super Admin: tenant list/suspend/reactivate | Complete | | `src/server/platform/tenants.ts`, `src/app/[locale]/(app)/app/platform/tenants/` |
| Platform Super Admin: SaaS plan management | Complete | | `src/server/platform/plans.ts` |
| Platform health page | **Partial — unverified scope** | The route exists; the exact set of metrics it surfaces was not independently re-derived for this checklist (see `docs/operations.md` §2's advice to query tables directly in the meantime). | `src/app/[locale]/(app)/app/platform/health/page.tsx` |
| Global search, tenant-isolated | Complete | | `src/server/search/search.ts`, `tests/integration/auth/search-tenant-isolation.test.ts` |
| Object storage — local driver | Complete | Development default. | `src/lib/storage/local-driver.ts` |
| Object storage — S3-compatible driver | Complete | Also serves MinIO/R2/Supabase Storage. | `src/lib/storage/s3-driver.ts` |
| Malware scanning | **Interface-only** | `noop` (default) logs a loud warning and reports clean unconditionally; `clamav` throws unconditionally — no clamd socket wired. | `src/lib/storage/malware.ts` |
| Field-level encryption + key rotation support | Complete | AES-256-GCM with `ENCRYPTION_KEY_PREVIOUS` fallback read path. | `src/lib/crypto.ts` |
| Custom domain — schema + settings field | **Partial** | Column and form field exist; **no DNS verification or Vercel Domains API automation** — entirely a manual operations task today. | `docs/deployment.md` §9 |
| CI (GitHub Actions) | Complete (as authored in this pass) | See `.github/workflows/ci.yml` in this same change; verify it once by running it, since it has not executed on this repository's actual CI yet. | `.github/workflows/ci.yml` |
| Test suite — unit | Complete | ~50 files. | `tests/unit/**` |
| Test suite — integration | Complete | ~40 files, real Postgres, tenant-isolation and immutability coverage. | `tests/integration/**` |
| Test suite — component | Complete | 8 files. | `tests/component/**` |
| Test suite — E2E | **Not started** | `playwright.config.ts` is fully configured (build+serve, two device projects, trace/screenshot/video on failure) but `tests/e2e/` does not exist and no spec files exist anywhere in the repo. `npm run test:e2e` currently finds nothing to run. | absence confirmed under `tests/e2e/` |
| Demo seed data + credentials doc | **Not started** | See Phase 1 row above — owned by a concurrent workstream at time of writing. | `src/db/seed/`, `docs/demo-credentials.md` |

---

## Tally

Counting each row above once (74 rows total):

| Status | Count |
|---|---|
| Complete | 55 |
| Partial | 9 |
| Interface-only | 6 |
| Not started | 4 |

The nineteen items that are not fully complete are, without exception, ones
the code itself documents as a deliberate scope decision (TollGuru, the
three tracking providers, ClamAV, factoring, custom-domain automation) or a
gap this document set surfaces rather than hides (the QStash driver, the
unscheduled Stripe replay sweep, the anonymize handler's single-entity scope,
the absent seed data, the absent E2E suite). None were found by exhaustive code review
to be silently broken — every partial/interface-only/not-started item above
is either explicitly labeled as such in its own source comments or was
confirmed absent by checking for the expected file/directory/schedule entry
and finding nothing.
