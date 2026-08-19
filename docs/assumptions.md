# Goliath Dispatch — Assumptions

Every judgement call below is one the brief did not settle explicitly, and
the implementation resolved it one specific way. For each: the assumption,
why it was made (as best reconstructed from the code's own comments and
structure), and what would change if it turns out to be wrong.

---

### Self-hosted, database-backed sessions instead of JWTs

**Assumption:** authentication uses an opaque token in an `httpOnly` cookie,
hashed and stored in `sessions`, rather than a signed JWT the server can
validate without a database round trip.

**Why:** `docs/architecture.md` §2 states the reasoning directly —
suspension, "sign out everywhere," and ending a support-access session must
take effect *immediately*. A JWT is only as revocable as its expiry window;
a compromised or leaked token would remain valid until it naturally
expired. `src/lib/auth/session.ts`'s `revokeAllUserSessions()` is only
possible because the session is a row, not a self-contained token.

**If wrong:** a JWT would remove one database read per authenticated
request (a real latency win at scale) at the cost of a genuine revocation
mechanism — a short-lived JWT plus a refresh-token-with-revocation hybrid is
the usual compromise, but that is a materially different auth architecture,
not a config flip. Revisit only if session-lookup latency is measured to be
a real bottleneck, not preemptively.

### Self-hosted fonts (npm packages, not a Google Fonts CDN request)

**Assumption:** `@fontsource-variable/inter` and `@fontsource/roboto-condensed`
ship as npm dependencies bundled into the build, rather than a `<link>` to
`fonts.googleapis.com`.

**Why:** `docs/architecture.md` §2: no third-party runtime request, no CSP
exception needed for a font CDN, and CI builds without network access to
Google. This also means the CSP's `style-src`/`font-src` directives
(`src/lib/security/headers.mjs`) still list `fonts.googleapis.com`/
`fonts.gstatic.com` as an allowance — that's a residual permissiveness worth
tightening if self-hosting is confirmed complete and no code path still
expects the Google Fonts origin.

**If wrong:** if a tenant's custom branding needs a font neither package
ships, the branding form's `headingFont`/`bodyFont` columns accept
arbitrary strings today with no validation against what's actually
available — a tenant could set a font name that silently doesn't render.
Revisit by either constraining the settings form to the self-hosted font
list, or adding a real web-font-loading path (with its own CSP
implications) for custom fonts.

### Customers get tracking links, not accounts

**Assumption:** `customers` has no corresponding user/login path this
release; the schema comment in `src/db/schema/customer.ts` says the columns
and relations are "shaped so a future customer portal can be added without
a migration of operational data," but no such portal exists. Customer
visibility into a shipment is entirely through `publicTrackingLinks` — a
signed, expiring, no-account URL exposing a deliberately narrow projection
of one load.

**Why:** a customer portal is a large surface (its own auth, its own
permission scope, its own UI) for a persona that, in this product's early
market, primarily wants "where is my freight" rather than ongoing
self-service account management. A tracking link is dramatically cheaper to
build and ship first.

**If wrong:** the schema is deliberately future-proofed for this — adding a
`customer` role/membership path would extend `roleEnum`, add a scope, and
build a portal shell, without needing to reshape `customers`,
`customer_contacts`, or `customer_locations`. This is a genuine "add," not
a migration of existing data — treat that as validated design intent, not
just a hope.

### Per-tenant carrier records (no global carrier registry)

**Assumption:** a carrier that works with three dispatch companies using
this product is three independent `carriers` rows in three tenants — DOT
uniqueness is enforced per tenant (`carriers_tenant_dot_uq`), not globally.

**Why:** stated directly in `carrier.ts`'s docstring, and reinforced by
architecture.md §3. Each tenant's relationship with a carrier (its own
dispatch fee, its own onboarding decision, its own document review) is
independent — a global carrier entity would need to reconcile conflicting
per-tenant facts (different fee percentages, different onboarding
approval), which the product does not need to solve for.

**If wrong:** if a future feature wants "verify this carrier once, reuse
across tenants" (e.g. a shared FMCSA verification cache), that is an
additive service sitting *above* today's per-tenant `carriers` table (a
lookup cache keyed by DOT number, consulted before a live FMCSA call), not
a change to the tenancy model itself — the per-tenant row stays the source
of truth for the *relationship*, only the *verification result* would be
shared.

### Oversize rule baselines are operator-maintained, not authoritative

**Assumption:** `oversizeRules` is "seeded with representative federal/
state values" (the schema's own comment) and is fully tenant-editable —
the application treats it as guidance a dispatcher/admin reviews, never as
a legal determination it can stand behind unassisted.

**Why:** state oversize/overweight/permit regulations change, vary by
route and season (harvest restrictions, holiday travel bans), and carry
real legal and safety consequences if wrong. No commercial product should
claim automated legal authority here without a maintained, licensed data
feed — the code's own naming (`permitLikelyRequired`, `escortLikelyRequired`
— "likely," not certain) reflects this restraint, and the human-validation
gate (`oversizeEvaluations.humanValidationStatus`) exists specifically
because the evaluation is advisory.

**If wrong (i.e. if a tenant treats this as authoritative without review):**
this is a real operational risk, not just a documentation nuance — a
dispatcher who dispatches based solely on `outcome = 'clear'` without the
required Admin validation, or a tenant that never reviews/updates
`oversizeRules` against current state DOT publications, is relying on
"representative" seed values that may be stale. `requireOversizeAdminValidation`
defaults to `true` for exactly this reason; do not let a tenant disable it
without understanding what they're giving up.

### Dispatcher commission basis defaults to `dispatch_fee_amount`

**Assumption:** `tenantSettings.dispatcherCommissionBasis` defaults to
`'dispatch_fee_amount'` (the dispatcher earns a percentage of what the
tenant charged the carrier), not `'carrier_gross_rate'` or
`'commissionable_base'`.

**Why:** this ties a dispatcher's incentive directly to the revenue line
the dispatch company actually earns (the dispatch fee), rather than to the
carrier's gross rate (a number the dispatcher doesn't control and that
doesn't represent the company's own revenue) or the commissionable base
(a close second choice, but one step more removed from "what did this load
actually earn the company").

**If wrong:** this is purely a per-tenant setting
(`dispatcherCommissionBasis`, tenant-editable) and every load snapshots its
own basis at calculation time — changing the default does not require a
migration, only changing which value new tenants start with. No structural
change needed.

### What "current" means for a document

**Assumption:** `documents.currentVersionId` points at the **most recently
uploaded** version, not the most recently *approved* one.
`src/server/documents/service.ts`'s upload path sets `currentVersionId` to
the brand-new version immediately, before any review has happened —
`reviewStatus` resets to reflect the new version's pending state, but the
"current" pointer moves right away.

**Why:** this is the simpler, more predictable behavior for a user who just
replaced an expired COI — they expect the app to show their new upload,
not a stale approved one, while it's under review. The alternative (keep
showing the last-approved version as "current" until the new one clears
review) would require the UI to distinguish "current-for-display" from
"current-for-compliance," which the schema doesn't separate today.

**If wrong:** a compliance gate that checks "is there a current, approved
COI" needs to check `reviewStatus = 'approved'` on the current version
explicitly, not just "does a `currentVersionId` exist" — verify every
compliance-gate consumer in `src/server/compliance/` does this correctly
before relying on this document's characterization in an audit context; if
any gate checks presence-of-current-version without also checking its
review status, that is a real bug this assumption would have masked.

### The 60-minute impersonation ceiling, no renewal

**Assumption:** every impersonation session
(`IMPERSONATION_DURATION_MINUTES = 60`) expires hard at 60 minutes with no
extension mechanism — a support agent mid-task simply loses impersonated
authority and must start a new session (with a new `reason`, newly
audited).

**Why:** a hard ceiling bounds the blast radius of a support session that
is forgotten-but-not-ended, without needing a separate "did they remember
to end it" monitoring process. 60 minutes is long enough for a typical
support task, short enough that an abandoned session self-heals within the
hour.

**If wrong:** if 60 minutes proves too short for legitimate complex support
work, the fix is either a longer ceiling (a one-line constant change) or a
renewal flow that itself requires a fresh, audited justification (not a
silent extension) — silently extending an existing session without a new
recorded reason would undermine the audit property this design is built
around.

### Messaging is polled, not pushed

**Assumption:** the in-app messaging UI refreshes on a 20-second client-side
poll (`POLL_INTERVAL_MS` in `messages-shell.tsx`); there is no WebSocket or
Server-Sent-Events transport.

**Why:** the component's own comment states this plainly: it's a deliberate
simplification, disclosed to the user via
`notification.messaging.thread.pollingNotice` rather than hidden behind a
"real-time" claim the product doesn't back up. A polling transport needs no
persistent-connection infrastructure (no WebSocket server, no sticky
sessions across serverless instances) — a meaningful simplicity win for a
Vercel-deployed Next.js app.

**If wrong (i.e. if near-real-time messaging turns out to matter):** this
is a genuine infrastructure addition, not a config flip — Vercel's
serverless functions don't hold long-lived WebSocket connections natively;
a real-time transport would need a separate service (Pusher/Ably-style
managed service, or a dedicated WebSocket-capable deployment target) sitting
alongside the current architecture, not replacing it.

### Load numbering under concurrency

**Assumption:** `allocateLoadNumber()` takes an explicit `SELECT … FOR
UPDATE` row lock on the tenant's single `tenant_settings` row before
reading/incrementing `loadNumberNextSequence`, serializing concurrent
`createLoad` calls within a tenant rather than risking two loads receiving
the same number.

**Why:** the alternative (an application-level read-then-write without a
lock) is a textbook race condition under real concurrency (two dispatchers
creating loads within milliseconds of each other) — the row lock is the
correct, minimal fix, matching the same idiom used for signature audit
chain appends and signature request locking elsewhere in the codebase.

**If wrong / cost to know about:** every `createLoad` call inside the same
tenant now serializes on this one row for the duration of the transaction —
under very high concurrent load-creation volume within a single tenant,
this is a real (if narrow) contention point. `tests/integration/loads/numbering-concurrency.test.ts`
exists specifically to catch a regression here; if load-creation throughput
for a single large tenant ever becomes a bottleneck, the fix is a
database sequence per tenant rather than a locked counter row, which is a
schema change, not a quick patch.

### Per-tenant custom domain has no automated verification

Documented in full in `docs/deployment.md` §9 — the schema and settings
form exist; DNS verification and TLS issuance are entirely manual today.
Flagged here because it's exactly the kind of "looks done in the UI, isn't
actually automated" gap this document set exists to surface.

### Factoring is entirely manual (no funding API)

Documented in full in `docs/integrations.md`. Worth repeating here as an
assumption in its own right: the product records what a human confirmed
happened with a factoring company, and never calls out to any funding
integration. If a tenant's workflow assumes automated funding
verification, that expectation needs to be corrected before go-live, not
discovered afterward.

### Malware scanning defaults to `noop`

**Assumption:** `MALWARE_SCAN_DRIVER=noop` is the default, and it always
reports every upload as clean — loudly logging that it did so, but never
blocking an upload.

**Why:** no ClamAV daemon is available in the reference environment this
was built against, and the team's stated position (in the adapter's own
comment) is that an unreachable scanner must block an upload, never
silently report "clean" — which is exactly why `clamav` throws instead of
degrading. The `noop` default is honest about scanning nothing, rather than
pretending to.

**If wrong:** this is a genuine production risk if left at the default —
see the go-live checklist in `docs/deployment.md` §10, and note that
malware scanning is **not** on that checklist explicitly today; it should
be added as an explicit go-live gate for any deployment that accepts
carrier/driver-uploaded documents (which is to say: every real deployment).
