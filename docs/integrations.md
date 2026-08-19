# Goliath Dispatch — Integrations

Every third-party system is reached through an interface in
`src/integrations/<family>/provider.ts`, resolved by a driver switch (an env
var read once, memoized) in `src/integrations/<family>/index.ts`. Nothing
outside `src/integrations/**` imports a provider SDK directly. A mock
adapter is the default for every family so the whole product — including
every test — runs with zero third-party credentials.

Status labels used below are exact:

- **Live** — a real adapter exists, calls the real API, and is selectable in
  production today.
- **Mock** — the default; deterministic in-memory behavior for dev/test.
- **Interface-only** — the class exists, implements the interface, and every
  method throws `integration_unavailable`. This is not an accidental stub;
  each one documents, in its own header comment, exactly what a real
  implementation would need to do.

## Summary

| Family | Driver env var | Default | Live adapter | Status this release |
|---|---|---|---|---|
| FMCSA carrier data | `FMCSA_DRIVER` | `mock` | QCMobile (`qcmobile`) | **Live** |
| Google Places/Geocoding/Routes | `GEO_DRIVER` | `mock` | Google Maps Platform (`google`) | **Live** |
| Tolls | *(no driver — always TollGuru)* | — | none | **Interface-only** |
| OCR / document extraction | `OCR_DRIVER` | `mock` | Amazon Textract (`textract`), Google Document AI (`docai`) | **Live** (SDK loaded lazily; neither package is an installed dependency) |
| Email | `EMAIL_DRIVER` | `mock` | Mailgun (`mailgun`) | **Live** |
| SMS | `SMS_DRIVER` | `mock` | Twilio (`twilio`) | **Live** |
| Payments / billing | `STRIPE_DRIVER` | `mock` | Stripe (`live`) | **Live** |
| Malware scanning | `MALWARE_SCAN_DRIVER` | `noop` | ClamAV (`clamav`) | **Interface-only** (constructor throws; no clamd socket wired) |
| Tracking — Trucker Tools | `TRACKING_DEFAULT_PROVIDER` / per-carrier `integration_connections` | `mock` | Trucker Tools | **Interface-only** (settings screen + interface only) |
| Tracking — MacroPoint | same | `mock` | MacroPoint (Descartes) | **Interface-only** (settings screen + interface only) |
| Tracking — Highway | same | `mock` | Highway | **Interface-only** (settings screen + interface only) |
| Object storage | `STORAGE_DRIVER` | `local` | S3-compatible (`s3`) | **Live** (also serves MinIO / R2 / Supabase Storage) |
| Background jobs | `JOBS_DRIVER` | `database` | QStash (`qstash`) | **Not implemented** — `qstash` is accepted by the env schema but no QStash adapter exists; the only working driver is `database` (the durable Postgres queue, see `docs/operations.md`) |
| Rate limiting | `RATE_LIMIT_DRIVER` | `memory` | Database-backed (`database`) | **Live** (`rate_limit_buckets` table) |

---

## FMCSA carrier data

**Used for:** verifying a carrier's DOT/MC authority, safety rating, and
insurance-on-file status at onboarding and on a recurring re-verification
cadence (`tenantSettings.fmcsaReverificationDays`, default 7 days).

**Interface:** `src/integrations/fmcsa/provider.ts` — `FmcsaProvider` with
`lookupByDot(dot)` and `lookupByMc(mc)`, both returning `FmcsaLookupResult`
(`ProviderResult<FmcsaCarrierSnapshot>`).

**Adapters:**
- `src/integrations/fmcsa/mock-adapter.ts` (`FMCSA_DRIVER=mock`, default) —
  five deterministic fixtures, keyed by DOT number:

  | DOT | MC | Scenario |
  |---|---|---|
  | `1000001` | `500001` | Clean, active carrier ("Summit Heavy Haul LLC"). Active authority, insurance on file. The happy path. |
  | `1000002` | `500002` | Reported legal name ("Summit Heavy Haul Logistics Incorporated") differs from what a tenant would plausibly enter ("Summit Heavy Haul LLC") — drives `compareEnteredToReported()` into a non-blocking `mismatch`. |
  | `1000003` | `500003` | No active operating authority (revoked). Always blocking. |
  | `1000004` | `500004` | Active authority but no insurance on file. Non-blocking mismatch the UI should still flag. |
  | `1000005` | `500005` | Not on file at FMCSA at all — lookup returns `not_found`. |

  Do not invent new fixture DOTs elsewhere in tests or the seed — extend this
  map instead (`src/integrations/fmcsa/mock-adapter.ts`).
- `src/integrations/fmcsa/qcmobile-adapter.ts` (`FMCSA_DRIVER=qcmobile`) —
  live adapter for the public FMCSA QCMobile API. Every field on the raw
  response is treated as optional and coerced defensively (numeric fields
  sometimes arrive as strings; small/inactive carriers are frequently
  missing fields) because QCMobile has no formal, versioned schema
  guarantee.

**Env vars:** `FMCSA_DRIVER` (`mock`|`qcmobile`), `FMCSA_WEBKEY`,
`FMCSA_BASE_URL` (defaults to `https://mobile.fmcsa.dot.gov/qc/services`).
The live adapter's constructor throws `integration_unavailable` immediately
if `FMCSA_WEBKEY` is unset — selecting `qcmobile` without a key fails at
first use, not silently.

**Failure mode:** every call goes through the shared HTTP client
(`src/integrations/_shared/http.ts`): 8-second timeout, up to 3 attempts,
exponential backoff with full jitter (250ms base, 4s cap), retrying only on
429/5xx/network failure/timeout — never on 4xx. A 404 maps to a domain
`not_found` result (not an error); any other exhausted failure throws
`integration_unavailable`. Results are cached for 24 hours
(`cacheTtlSeconds`) at the adapter level, but the application's own
re-verification cadence (7 days by default) is what actually governs how
often a lookup is re-run — the 24h figure only bounds accidental double
calls within a day.

**Going live:** obtain a QCMobile web key from FMCSA
(https://mobile.fmcsa.dot.gov/QCDevsite/), set `FMCSA_WEBKEY`, set
`FMCSA_DRIVER=qcmobile`. No package install required — it is a plain HTTPS
JSON API.

---

## Google Places, Geocoding, Time Zone & Routes

**Used for:** address autocomplete/resolution for carrier, customer and
stop addresses; timezone resolution for stop-local display; route
calculation (miles, duration, states crossed) that feeds oversize
evaluation.

**Interface:** `src/integrations/geo/provider.ts` — `GeoProvider`
(`autocomplete`, `resolvePlace`, `geocode`, `timezoneAt`, `route`).

**Adapters:**
- `src/integrations/geo/mock-adapter.ts` (`GEO_DRIVER=mock`, default) —
  deterministic city fixtures (`MOCK_CITIES`) and an in-process geocoding
  memo for test/dev convenience — not a production cache.
- `src/integrations/geo/google-adapter.ts` (`GEO_DRIVER=google`) — Places
  Autocomplete (New) and Place Details (New) for typeahead, the legacy
  Geocoding and Time Zone APIs for free-text/coordinate resolution, and
  Routes API v2 for route calculation. The server key
  (`GOOGLE_MAPS_SERVER_API_KEY`) is sent as the `X-Goog-Api-Key` header for
  the newer Places/Routes APIs, so it never appears in a URL; for the legacy
  Geocoding/Time Zone APIs (which only accept a `key` query parameter) it is
  redacted from logs the same way FMCSA's `webKey` is.

**Env vars:** `GEO_DRIVER` (`mock`|`google`), `GOOGLE_MAPS_SERVER_API_KEY`
(server-side calls), `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` (client-side
map rendering only — a separate, browser-restricted key).

**Failure mode:** same shared HTTP client as FMCSA (8s timeout, 3 attempts,
backoff). No caching layer beyond the mock adapter's in-process memo — a
live Google call is made on every request; there is no TTL to configure.

**Going live:** enable the Places API (New), Geocoding API, Time Zone API
and Routes API in a Google Cloud project, create two API keys — one
unrestricted-by-referrer server key for `GOOGLE_MAPS_SERVER_API_KEY`, one
HTTP-referrer-restricted browser key for
`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` — and set `GEO_DRIVER=google`.

---

## Tolls (TollGuru)

**Used for:** would populate `routes.estimatedTollCents`.

**Interface:** `src/integrations/geo/provider.ts` — `TollProvider`
(`estimateTollCents`).

**Adapter:** `src/integrations/geo/tollguru-adapter.ts` — **interface-only**.
Every call throws `integration_unavailable`. This is a deliberate product
decision, not an oversight: live toll estimation needs a paid TollGuru
account and a per-route pricing policy the product has not settled. The
adapter's header comment states explicitly: do not "helpfully" approximate
tolls with a flat per-mile heuristic — a fabricated number would misrepresent
a settlement figure as if a real quote had been obtained.

**Env var:** `TOLLGURU_API_KEY` exists in `.env.example` but nothing reads it
yet.

**Going live:** would require writing a real `TollGuruAdapter`, obtaining a
TollGuru API key, and wiring `getTollProvider()` in `src/integrations/geo/index.ts`
to select it — currently that function always constructs the interface-only
class.

---

## OCR / document extraction

**Used for:** extracting VIN numbers from an uploaded Certificate of
Insurance (COI) so equipment can be auto-matched against the carrier's
insured vehicles (the "equipment verification" compliance gate).

**Interface:** `src/integrations/ocr/provider.ts` — `OcrProvider`
(`extractFromDocument(bytes, contentType)` → `ExtractionResult`).

**Adapters:**
- `src/integrations/ocr/mock-adapter.ts` (`OCR_DRIVER=mock`, default) —
  fixture COIs registered via `mockCoiWithVins()`.
- `src/integrations/ocr/textract-adapter.ts` (`OCR_DRIVER=textract`) — live
  adapter for Amazon Textract's `DetectDocumentText`. `@aws-sdk/client-textract`
  is **not** an installed dependency; it is loaded with a dynamic
  `await import(...)` inside `extractFromDocument()` so importing the OCR
  package never fails when the driver isn't selected, and selecting
  `textract` without the package installed fails clearly at first use
  (`integrations.ocr.sdkNotInstalled`) rather than at build time. Uses the
  standard AWS credential chain — no separate app-level API key.
- `src/integrations/ocr/docai-adapter.ts` (`OCR_DRIVER=docai`) — same lazy-
  import pattern for `@google-cloud/documentai`. Needs
  `GOOGLE_APPLICATION_CREDENTIALS` (a service account) and
  `DOCAI_PROCESSOR_NAME`.

**Env vars:** `OCR_DRIVER` (`mock`|`textract`|`docai`), `AWS_TEXTRACT_REGION`
(read directly from `process.env`, not part of the shared env contract,
since it's AWS SDK configuration).

**Failure mode:** the extraction is run inside the
`document.ocr_extract` job handler (`src/jobs/handlers/ocr-vin-extraction.ts`),
so a provider failure is a job failure — retried per the job's
`maxAttempts`, then dead-lettered. There is no synchronous OCR call in a
request path.

**Going live:** `npm install @aws-sdk/client-textract` (or
`@google-cloud/documentai`), provide credentials via the respective standard
mechanism, set the driver env var.

---

## Email (Mailgun)

**Used for:** every transactional email — invitations, password reset,
document expiration warnings, invoice sent/overdue, signature requests,
notification digests.

**Interface:** `src/integrations/email/provider.ts` — `EmailProvider`
(`send(input)` → `SendEmailResult`).

**Adapters:**
- `src/integrations/email/mock-adapter.ts` (`EMAIL_DRIVER=mock`, default) —
  writes to an in-memory outbox (`readOutbox()`/`clearOutbox()`) tests
  assert against.
- `src/integrations/email/mailgun-adapter.ts` (`EMAIL_DRIVER=mailgun`) —
  live adapter via the official `mailgun.js` + `form-data` packages (both
  installed dependencies already).

**Env vars:** `EMAIL_DRIVER` (`mock`|`mailgun`), `MAILGUN_API_KEY`,
`MAILGUN_DOMAIN`, `MAILGUN_REGION` (`us`|`eu` — selects the API base URL),
`EMAIL_FROM`.

**Failure mode:** delivered through the `email.send` job
(`src/jobs/handlers/email-send.ts`), retried and eventually dead-lettered on
repeated provider failure — never sent synchronously inline with a user
action, so a Mailgun outage delays delivery rather than failing the request
that triggered it.

**Going live:** create a Mailgun account, verify a sending domain, set
`MAILGUN_API_KEY`/`MAILGUN_DOMAIN`/`MAILGUN_REGION`, set
`EMAIL_DRIVER=mailgun`.

---

## SMS (Twilio)

**Used for:** driver-facing SMS notifications (load assignment, pickup/
delivery reminders) where the recipient has SMS opted in.

**Interface:** `src/integrations/sms/provider.ts` — `SmsProvider`
(`send(input)` → `SendSmsResult`).

**Adapters:**
- `src/integrations/sms/mock-adapter.ts` (`SMS_DRIVER=mock`, default) — same
  in-memory outbox pattern as email.
- `src/integrations/sms/twilio-adapter.ts` (`SMS_DRIVER=twilio`) — live
  adapter via the official `twilio` package. Requires either
  `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER` in addition to
  account credentials — the constructor throws `integration_unavailable` if
  neither is present.

**Env vars:** `SMS_DRIVER` (`mock`|`twilio`), `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_FROM_NUMBER`.

**Failure mode:** delivered through the `sms.send` job
(`src/jobs/handlers/sms-send.ts`) with a deliberately short retry budget — it
dead-letters quickly rather than retrying for long, and refuses to send at
all without a recorded, un-revoked SMS consent
(`consentRecords`/`drivers.smsConsentGrantedAt`).

**Going live:** create a Twilio account, provision a number or messaging
service, set the four env vars, set `SMS_DRIVER=twilio`.

---

## Payments & billing (Stripe)

**Used for:** SaaS subscription billing (tenant → platform) and, where a
tenant collects card/ACH payment on its own carrier invoices, payment
intents on those invoices.

**Interface:** `src/integrations/payments/provider.ts` — `PaymentProvider`
(customers, subscriptions, checkout sessions, payment intents, refunds,
webhook construction/verification).

**Adapters:**
- `src/integrations/payments/mock-adapter.ts` (`STRIPE_DRIVER=mock`,
  default) — a full in-memory Stripe: deterministic ids (`cus_mock_1`,
  `sub_mock_1`, …), and `emitMockEvent(type, object)` which builds a webhook
  payload and signs it with the **same HMAC scheme** production verifies
  against a real Stripe signature (only the algorithm's inputs differ — JSON
  body + `STRIPE_WEBHOOK_SECRET` — not the verification shape), so a test
  can drive the real webhook route end-to-end without a live Stripe account.
- `src/integrations/payments/stripe-adapter.ts` (`STRIPE_DRIVER=live`) —
  live adapter via the official `stripe` package. Every mutating call
  carries an idempotency key, caller-supplied when given
  (`CreateSubscriptionInput.idempotencyKey`, etc.) or generated per call
  otherwise. The constructor throws `integration_unavailable` if
  `STRIPE_SECRET_KEY` is unset or still the placeholder value.

**Env vars:** `STRIPE_DRIVER` (`mock`|`live`), `STRIPE_SECRET_KEY`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_STARTER`/`STRIPE_PRICE_GROWTH`/`STRIPE_PRICE_ENTERPRISE`.

**Webhook endpoint:** `POST /api/webhooks/stripe`
(`src/app/api/webhooks/stripe/route.ts`).

**Event types handled** (`src/integrations/payments/events.ts`,
`HANDLED_STRIPE_EVENT_TYPES`):

| Stripe event | Internal effect |
|---|---|
| `invoice.paid` | `invoice.mark_paid` |
| `invoice.payment_failed` | `invoice.mark_payment_failed` |
| `payment_intent.succeeded` | `payment.mark_succeeded` |
| `payment_intent.payment_failed` | `payment.mark_failed` |
| `charge.refunded` | `payment.mark_refunded` |
| `charge.dispute.created` | `payment.flag_disputed` |
| `customer.subscription.created` / `.updated` | `subscription.sync` |
| `customer.subscription.deleted` | `subscription.mark_cancelled` |

Any other event type is acknowledged (200) and marked `ignored` — Stripe
never retries an event this application deliberately does not handle.

**Idempotency:** the webhook route inserts into `stripe_events` keyed by
`stripeEventId` with `onConflictDoNothing`; a conflict (duplicate delivery —
Stripe retries anything but a 2xx) short-circuits to `{ received: true,
duplicate: true }` without re-running any effect. `stripe_events` is
narrowly mutable per `docs/data-model.md` §3 — its identity columns
(`stripeEventId`, `eventType`, `payloadDigest`) can never change once
written, and rows can never be deleted, so the idempotency guarantee cannot
be undone by a later bug.

**Three-state processing outcome:**
- `processed` — the effect ran (payment/subscription state updated, audit
  event written).
- `ignored` — a real Stripe event type this application does not act on.
- `deferred` — the event carries no resolvable `tenantId`/`invoiceId`
  metadata, or no `InvoicePaymentEffects` implementation is registered yet.
  The row stays `received`; `stripe.webhook_replay_sweep`
  (`src/jobs/handlers/stripe-webhook-process.ts`) periodically replays
  `received`/`failed` payment-domain events once the dependency is
  available. This is a successful receipt, not a failure — Stripe does not
  re-deliver it.

A processing exception leaves the row `failed` with an incremented
`attempts` count and returns HTTP 500, which causes Stripe's own retry-with-
backoff to redeliver.

**Testing with the Stripe CLI:**

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger invoice.paid
```

Set `STRIPE_WEBHOOK_SECRET` to the signing secret the CLI prints
(`whsec_...`) and `STRIPE_DRIVER=live` with real test-mode keys for this to
verify.

**Testing with the built-in mock** (no network, no Stripe account):

```ts
import { emitMockEvent } from '@/integrations/payments'

const { rawBody, signature } = emitMockEvent('invoice.paid', {
  id: 'in_mock_1',
  metadata: { tenantId, invoiceId },
  // ...
})

const res = await fetch('/api/webhooks/stripe', {
  method: 'POST',
  headers: { 'stripe-signature': signature },
  body: rawBody,
})
```

`tests/integration/auth/stripe-webhook.test.ts` and
`tests/unit/integrations/payments/stripe-mock.test.ts` are worked examples
of this exact pattern.

**Going live:** create a Stripe account, create the three subscription
Prices in the dashboard (or via the API) and set
`STRIPE_PRICE_STARTER`/`_GROWTH`/`_ENTERPRISE`, set
`STRIPE_SECRET_KEY`/`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from the API keys
page, add the webhook endpoint (see `docs/deployment.md`) and set
`STRIPE_WEBHOOK_SECRET` to its signing secret, set `STRIPE_DRIVER=live`.

---

## Malware scanning

**Used for:** every document/media upload is expected to pass through a
scanner before its bytes are written to storage.

**Interface:** `src/lib/storage/malware.ts` — `MalwareScanner.scan(buffer)`.

**Adapters:**
- `NoopMalwareScanner` (`MALWARE_SCAN_DRIVER=noop`, default) — always
  reports clean, but logs a `warn` on every call
  (`Malware scan skipped: MALWARE_SCAN_DRIVER=noop`) so a production
  deployment left on the default is visible in logs, not hidden in a config
  diff.
- `ClamAvMalwareScanner` (`MALWARE_SCAN_DRIVER=clamav`) — **interface-only**.
  `scan()` always throws `integration_unavailable`. The class's header
  comment documents the full INSTREAM protocol a real implementation would
  speak against `clamd` (4-byte length-prefixed chunks, `stream: OK` / `stream:
  <signature> FOUND` response), because no clamd daemon is available in this
  environment and the team decided an unreachable scanner must block the
  upload, never silently degrade to "clean".

**Going live:** stand up a `clamd` instance reachable from the app (a
sidecar container or managed ClamAV service), implement the socket protocol
described in the adapter's header comment, set `MALWARE_SCAN_DRIVER=clamav`.

---

## Tracking providers (Trucker Tools, MacroPoint, Highway)

**Used for:** real-time load location during transit, surfaced on the
dispatcher tracking dashboard and the customer's public tracking link.

**Interface:** `src/integrations/tracking/provider.ts` — `TrackingProvider`
(`startSession`, `endSession`, `getSession`, `pollEvents`, `parseWebhook`).

Unlike the other families, tracking is **not** selected by one global env
var — a tenant picks a provider per carrier connection
(`integration_connections` where `category = 'tracking'`), so
`getTrackingProvider(providerId)` takes an explicit id.
`TRACKING_DEFAULT_PROVIDER` only seeds the default shown in settings.

**Adapters, all three:**
- `src/integrations/tracking/mock-adapter.ts` (`mock`, default and the only
  one that works end-to-end) — a full simulator: starts a session, advances
  a synthetic route over time, emits `location_update`, `arrived_pickup`,
  `departed_pickup`, etc.
- `src/integrations/tracking/trucker-tools-adapter.ts`,
  `macropoint-adapter.ts`, `highway-adapter.ts` — **interface-only, plus a
  working settings screen** (`src/app/[locale]/(app)/app/settings/integrations/`)
  where a tenant can enter credentials and see connection status. Every
  method throws `integration_unavailable`. This is a deliberate scope cut,
  not an oversight: each of these three needs a carrier-facing onboarding
  flow inside the *provider's own portal* (the carrier's driver installs an
  app or opts in by SMS) that has no equivalent for the other integration
  families in this document, and building that cross-portal flow was
  deferred. Each adapter's header comment documents the real protocol in
  detail so implementing it later is additive:
  - **Trucker Tools** — per-tenant API key (`Authorization: Bearer`),
    `POST /v3/loads` to start a session, events delivered by webhook signed
    `X-TT-Signature: HMAC-SHA256` over the raw body.
  - **MacroPoint (Descartes)** — OAuth2 client-credentials grant,
    `POST /brokertracking/rest/loads`, both polling
    (`GET /rest/loads/{id}/tracking`) and webhook available, webhook uses a
    static shared-secret header.
  - **Highway** — per-tenant API key (`X-Api-Key`),
    `POST /v1/tracking/sessions`, webhook-only, signed
    `Highway-Signature: t=<ts>,v1=<hex>` (Stripe-style).

**Failure mode:** pull-based providers (only the mock qualifies today) are
polled by the `tracking.ingest_sweep` job every 5 minutes
(`vercel.json`); push-based delivery for the three real providers would
land on `POST /api/webhooks/tracking/[provider]`, which exists as a route
but has nothing to parse until a real adapter's `parseWebhook` is
implemented. A session's `healthStatus` (`unknown`→`healthy`→`stale`→`lost`→`ended`)
degrades if no event arrives within the sweep's expected cadence.

**Going live (any of the three):** implement the adapter per its header
comment, obtain a per-tenant API key from the provider's dashboard, wire the
tenant's `integration_connections` row, and implement the corresponding
branch of `POST /api/webhooks/tracking/[provider]` for webhook-based
providers.

---

## Object storage (S3-compatible)

**Used for:** every document, equipment photo/video, message attachment,
generated PDF (invoice, settlement, signed agreement, audit certificate),
and export artifact. The bucket is private; every read goes through a
short-lived signed URL.

**Interface:** `src/lib/storage/types.ts` — `StorageDriver` (`put`, `get`,
`delete`, `exists`, `copy`, `head`, `signedDownloadUrl`, `signedUploadUrl`).

**Adapters:**
- `src/lib/storage/local-driver.ts` (`STORAGE_DRIVER=local`, default) —
  writes to `LOCAL_STORAGE_ROOT` (`./.local-storage` by default) on disk,
  served back through `GET /api/documents/local/[...key]`. Development only.
- `src/lib/storage/s3-driver.ts` (`STORAGE_DRIVER=s3`) — AWS SDK v3 against
  real S3 or any S3-compatible endpoint (MinIO, Cloudflare R2, Supabase
  Storage) via `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`. Every `put`/`copy`/
  presigned upload sets `ServerSideEncryption: 'AES256'`.

**Env vars:** `STORAGE_DRIVER` (`local`|`s3`), `S3_REGION`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`,
`S3_FORCE_PATH_STYLE`, `SIGNED_URL_TTL_SECONDS` (default 300),
`LOCAL_STORAGE_ROOT`.

**Key structure:** always `tenants/{tenantId}/{ownerTypeSegment}/{ownerId}/{documentId}/v{n}-{filename}`
(`src/lib/storage/keys.ts`). `assertKeyBelongsToTenant` refuses to sign any
key that does not start with the caller's own tenant prefix — the second
line of defense, after the permission check, against a guessed or replayed
key.

**Going live:** see `docs/deployment.md`'s bucket-creation section for the
CORS policy, lifecycle rule, and minimal IAM policy JSON.

---

## Background jobs driver

**Used for:** every asynchronous effect in the product (see
`docs/operations.md` for the full catalog).

`JOBS_DRIVER=database` (the only implemented option) is the durable
`job_queue` table drained by the Vercel Cron `/api/cron/drain` route (every
minute) plus the per-sweep cron routes. `JOBS_DRIVER=qstash` is accepted by
the env schema and `.env.example` documents the three `QSTASH_*` variables,
but **no QStash adapter exists in this codebase** — nothing reads those
variables today, and setting this driver has no effect on job execution.
Treat it as a reserved value for a future alternative transport, not a
working option.

---

## Rate limiting

**Used for:** public, unauthenticated form endpoints (marketing lead/quote
forms, carrier signup) — `PUBLIC_FORM_RATE_LIMIT_PER_HOUR` (default 10).

- `memory` (default) — in-process counter, resets on redeploy/restart;
  correct for a single long-lived process, not correct across multiple
  serverless instances.
- `database` — `rate_limit_buckets` table, correct across any number of
  instances. Use this in any deployment with more than one running
  instance, which in practice means every Vercel production deployment.
