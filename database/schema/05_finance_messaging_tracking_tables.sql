-- ============================================================================
-- Goliath Dispatch — Finance / Messaging / Tracking domain
-- Tables only. NO foreign keys here — see
-- 84_finance_messaging_tracking_foreign_keys.sql for the reason (several FKs
-- point at tables owned by other domains: tenants, users, carriers,
-- factoring_companies, documents, customers, loads, drivers, trucks).
--
-- Conventions (see docs/mysql-port.md for the verified rationale):
--   * char(36) UUID primary keys.
--   * Every tenant-owned table also carries unique key <table>_tenant_id_uq
--     (tenant_id, id) so a child row can structurally reference (tenant_id,
--     id) of its parent. stripe_events.tenant_id is the one exception to
--     "owned" — see the comment on that table for why it is nullable and
--     still carries the unique key.
--   * datetime(3) for every date/time column, never timestamp (2038
--     ceiling). Invoice due dates, settlement periods and the seven-year
--     financial retention window are routinely future-dated; a 2039 date is
--     normal data here, not an edge case.
--   * Enums are varchar(n) + CHECK (col IN (...)); the PHP backed enum in
--     app/Enums/ is the application-side source of truth and must list the
--     exact same values (see docs/port-notes-finance-messaging-tracking.md
--     for how that agreement is guaranteed and verified). Only columns typed
--     as a real Drizzle pgEnum in the source get a CHECK — plain varchar
--     columns that merely carry an explanatory comment (e.g.
--     dispatcher_commissions.status, carrier_settlements.status,
--     invoice_line_items.kind, conversations.kind, messages.origin,
--     integration_connections.category/health_status,
--     tracking_sessions.health_status, stripe_events.processing_status) stay
--     plain, matching the precedent set by the other three domains.
--   * Money is signed bigint cents. Per the task's explicit list, CHECK
--     (col >= 0) is added to exactly five columns in this domain:
--     expenses.amount_cents, invoices.total_cents, invoices.amount_paid_cents,
--     payments.amount_cents, invoice_line_items.amount_cents. Every other
--     cents column — including ones that intuitively look like they should
--     never go negative (financial_snapshots.customer_charge_cents,
--     financial_snapshots.carrier_gross_rate_cents,
--     payments.refunded_amount_cents, invoices.subtotal_cents/
--     adjustments_cents/balance_cents, carrier_settlements.*,
--     dispatcher_commissions.*, carrier_settlement_lines.*) — is left as
--     plain signed bigint with no floor. This mirrors the precedent set by
--     the loads/routes/permits domain (routes.estimated_toll_cents,
--     rate_confirmation_acceptances.rated_amount_cents were left
--     unconstrained there for the identical reason): the task's explicit
--     column list is authoritative, not intuition about which columns "feel"
--     non-negative. gross_margin_cents and net_carrier_settlement_cents in
--     particular are legitimately negative business events (a load sold
--     below cost; a carrier whose deductions exceed their rate) and MUST NOT
--     be constrained — see financial_snapshots below.
--   * Percentages are basis points (int) with CHECK (col BETWEEN 0 AND
--     10000). This applies universally, independent of the cents-column
--     rule above: financial_snapshots.carrier_dispatch_fee_bps,
--     financial_snapshots.dispatcher_commission_bps,
--     dispatcher_commissions.percentage_bps.
--   * Hash/token columns are char(64) charset ascii collate ascii_bin:
--     message_attachments.sha256, stripe_events.payload_digest,
--     public_tracking_links.token_hash. public_tracking_links.token_hash in
--     particular is a security boundary — an accent-insensitive collation
--     would let two distinct tokens collide.
--   * integration_connections.credentials_encrypted is text (envelope-
--     encrypted ciphertext blob) and is never widened to plaintext or
--     narrowed to varchar.
-- ============================================================================

-- ============================================================================
-- Finance
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Expense categories & expenses
-- ────────────────────────────────────────────────────────────────────────────
create table expense_categories (
  id                 char(36)     not null,
  tenant_id          char(36)     not null,
  code               varchar(40)  not null,
  label_en           varchar(120) not null,
  label_es           varchar(120) not null,
  -- Drives the money formulas — see docs/port-notes-finance-messaging-tracking.md.
  treatment          varchar(30)  not null default 'tenant_absorbed',
  -- Permits and escorts ship as excluded-by-default system categories.
  is_system          tinyint(1)   not null default 0,
  requires_receipt   tinyint(1)   not null default 1,
  active             tinyint(1)   not null default 1,
  sort_order         int          not null default 0,

  created_at         datetime(3)  not null default current_timestamp(3),
  updated_at         datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at         datetime(3)      null,
  deleted_by         char(36)         null,
  deletion_reason    text             null,

  -- Partial-unique emulation. Codes are user-chosen labels; deleting one must free the code.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_code_key` varchar(40) generated always as (
    case when `deleted_at` is null then `code` end
  ) stored,
  primary key (id),
  unique key expense_categories_tenant_id_uq (tenant_id, id),
  unique key `expense_categories_tenant_code_uq` (`tenant_id`, `live_code_key`),
  key expense_categories_tenant_idx (tenant_id),

  constraint chk_expense_categories_treatment check (treatment in (
    'excluded_from_commission','reimbursable_to_carrier','tenant_absorbed','carrier_deduction'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table expenses (
  id                        char(36)     not null,
  tenant_id                 char(36)     not null,
  load_id                   char(36)         null,
  carrier_id                char(36)         null,
  category_id               char(36)     not null,
  -- Snapshotted so a later category edit cannot rewrite settled math.
  treatment_snapshot        varchar(30)  not null,
  amount_cents               bigint      not null,
  description                text            null,
  incurred_on                datetime(3)     null,
  receipt_document_id        char(36)        null,
  status                     varchar(20)  not null default 'submitted',
  submitted_by_user_id       char(36)     not null,
  reviewed_by_user_id        char(36)        null,
  reviewed_at                datetime(3)     null,
  rejection_reason           text            null,

  created_at                 datetime(3)  not null default current_timestamp(3),
  updated_at                 datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                 datetime(3)      null,
  deleted_by                 char(36)         null,
  deletion_reason             text            null,
  archived_at                 datetime(3)     null,
  purge_eligible_at           datetime(3)     null,
  legal_hold                  tinyint(1)  not null default 0,

  primary key (id),
  unique key expenses_tenant_id_uq (tenant_id, id),
  key expenses_tenant_idx (tenant_id),
  key expenses_load_idx (load_id),
  key expenses_carrier_idx (carrier_id),
  key expenses_status_idx (tenant_id, status),

  constraint chk_expenses_treatment_snapshot check (treatment_snapshot in (
    'excluded_from_commission','reimbursable_to_carrier','tenant_absorbed','carrier_deduction'
  )),
  constraint chk_expenses_status check (status in (
    'submitted','approved','rejected','reimbursed'
  )),
  constraint chk_expenses_amount_cents check (amount_cents >= 0)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Financial snapshots
-- Immutable calculation history. Every change to any input writes a new
-- row; rows are never updated, so historical results stay reproducible even
-- after tenant settings, fee percentages or category treatments change.
-- See 95_finance_messaging_tracking_triggers.sql for the guard that enforces
-- this: DELETE is refused outright, and UPDATE is refused if load_id,
-- version, or any computed money column changes. The retention columns
-- (archived_at, purge_eligible_at, legal_hold) stay updatable so the
-- archival job can do its work.
-- ────────────────────────────────────────────────────────────────────────────
create table financial_snapshots (
  id                                        char(36)     not null,
  tenant_id                                 char(36)     not null,
  load_id                                   char(36)     not null,
  version                                   int          not null,

  -- Inputs (snapshotted)
  customer_charge_cents                     bigint       not null,
  carrier_gross_rate_cents                  bigint       not null,
  carrier_dispatch_fee_bps                  int          not null,
  dispatcher_commission_bps                 int          not null,
  dispatcher_commission_basis               varchar(30)  not null,
  approved_excluded_expenses_cents          bigint       not null default 0,
  approved_reimbursable_expenses_cents      bigint       not null default 0,
  tenant_absorbed_expenses_cents            bigint       not null default 0,
  carrier_deductions_cents                  bigint       not null default 0,

  -- Outputs
  commissionable_base_cents                 bigint       not null,
  dispatch_fee_amount_cents                 bigint       not null,
  net_carrier_settlement_cents              bigint       not null,
  gross_margin_cents                        bigint       not null,
  dispatcher_commission_amount_cents        bigint       not null,

  -- Every expense that fed this snapshot, by id and treatment.
  expense_breakdown                         json         not null default (JSON_ARRAY()),
  formula_version                           varchar(20)  not null default 'v1',
  reason                                    varchar(120)     null,
  computed_by_user_id                       char(36)         null,
  computed_at                               datetime(3)  not null default current_timestamp(3),

  created_at                                datetime(3)  not null default current_timestamp(3),
  updated_at                                datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  archived_at                               datetime(3)      null,
  purge_eligible_at                         datetime(3)      null,
  legal_hold                                tinyint(1)   not null default 0,

  primary key (id),
  unique key financial_snapshots_tenant_id_uq (tenant_id, id),
  unique key financial_snapshots_load_version_uq (load_id, version),
  key financial_snapshots_tenant_idx (tenant_id),
  key financial_snapshots_load_idx (load_id, computed_at),

  constraint chk_financial_snapshots_dispatcher_commission_basis check (dispatcher_commission_basis in (
    'dispatch_fee_amount','carrier_gross_rate','commissionable_base'
  )),
  constraint chk_financial_snapshots_carrier_dispatch_fee_bps check (carrier_dispatch_fee_bps between 0 and 10000),
  constraint chk_financial_snapshots_dispatcher_commission_bps check (dispatcher_commission_bps between 0 and 10000)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table dispatcher_commissions (
  id                     char(36)     not null,
  tenant_id              char(36)     not null,
  load_id                char(36)     not null,
  dispatcher_user_id     char(36)     not null,
  financial_snapshot_id  char(36)     not null,
  basis                  varchar(30)  not null,
  basis_amount_cents     bigint       not null,
  percentage_bps         int          not null,
  amount_cents           bigint       not null,
  -- accrued | approved | paid | voided
  status                 varchar(20)  not null default 'accrued',
  paid_at                datetime(3)      null,

  created_at             datetime(3)  not null default current_timestamp(3),
  updated_at             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at             datetime(3)      null,
  deleted_by             char(36)         null,
  deletion_reason        text             null,
  archived_at            datetime(3)      null,
  purge_eligible_at      datetime(3)      null,
  legal_hold             tinyint(1)   not null default 0,

  primary key (id),
  unique key dispatcher_commissions_tenant_id_uq (tenant_id, id),
  key dispatcher_commissions_tenant_idx (tenant_id),
  key dispatcher_commissions_user_idx (tenant_id, dispatcher_user_id),
  unique key dispatcher_commissions_snapshot_uq (financial_snapshot_id, dispatcher_user_id),

  constraint chk_dispatcher_commissions_basis check (basis in (
    'dispatch_fee_amount','carrier_gross_rate','commissionable_base'
  )),
  constraint chk_dispatcher_commissions_percentage_bps check (percentage_bps between 0 and 10000)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Invoices
-- Goliath Dispatch invoices the CARRIER for the dispatch fee.
-- ────────────────────────────────────────────────────────────────────────────
create table invoices (
  id                        char(36)     not null,
  tenant_id                 char(36)     not null,
  invoice_number            varchar(40)  not null,
  carrier_id                char(36)     not null,
  -- Optional: some tenants also bill the customer directly.
  customer_id                char(36)        null,
  load_id                    char(36)        null,
  status                      varchar(20)  not null default 'draft',

  subtotal_cents              bigint       not null default 0,
  adjustments_cents           bigint       not null default 0,
  total_cents                 bigint       not null default 0,
  amount_paid_cents           bigint       not null default 0,
  balance_cents                bigint      not null default 0,

  issue_date                   datetime(3)     null,
  due_date                     datetime(3)     null,
  payment_terms_days           int          not null default 30,
  sent_at                      datetime(3)     null,
  paid_at                      datetime(3)     null,
  voided_at                    datetime(3)     null,
  void_reason                  text            null,
  disputed_at                  datetime(3)     null,
  dispute_reason               text            null,
  uncollectable_at             datetime(3)     null,

  pdf_document_id               char(36)       null,
  stripe_invoice_id             varchar(255)   null,
  stripe_payment_intent_id      varchar(255)   null,
  notes                         text           null,

  created_at                    datetime(3)  not null default current_timestamp(3),
  updated_at                    datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                    datetime(3)      null,
  deleted_by                    char(36)         null,
  deletion_reason                text            null,
  archived_at                    datetime(3)     null,
  purge_eligible_at              datetime(3)     null,
  legal_hold                     tinyint(1)  not null default 0,

  primary key (id),
  unique key invoices_tenant_id_uq (tenant_id, id),
  unique key invoices_tenant_number_uq (tenant_id, invoice_number),
  key invoices_tenant_idx (tenant_id),
  key invoices_tenant_status_idx (tenant_id, status),
  key invoices_carrier_idx (tenant_id, carrier_id),
  -- Backs the overdue sweep. Do not lose this index.
  key invoices_due_idx (tenant_id, due_date),
  key invoices_load_idx (load_id),

  constraint chk_invoices_status check (status in (
    'draft','sent','due','paid','overdue','disputed','voided','uncollectable'
  )),
  constraint chk_invoices_total_cents check (total_cents >= 0),
  constraint chk_invoices_amount_paid_cents check (amount_paid_cents >= 0)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table invoice_line_items (
  id                 char(36)     not null,
  tenant_id          char(36)     not null,
  invoice_id         char(36)     not null,
  load_id            char(36)         null,
  sequence           int          not null default 0,
  description_en     varchar(255) not null,
  description_es     varchar(255)     null,
  quantity           int          not null default 1,
  unit_amount_cents  bigint       not null,
  amount_cents       bigint       not null,
  -- dispatch_fee | expense | adjustment | credit
  kind               varchar(20)  not null default 'dispatch_fee',

  created_at         datetime(3)  not null default current_timestamp(3),
  updated_at         datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at         datetime(3)      null,
  deleted_by         char(36)         null,
  deletion_reason    text             null,

  primary key (id),
  unique key invoice_line_items_tenant_id_uq (tenant_id, id),
  key invoice_line_items_tenant_idx (tenant_id),
  key invoice_line_items_invoice_idx (invoice_id, sequence),

  constraint chk_invoice_line_items_amount_cents check (amount_cents >= 0)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Payments
-- ────────────────────────────────────────────────────────────────────────────
create table payments (
  id                          char(36)     not null,
  tenant_id                   char(36)     not null,
  invoice_id                  char(36)     not null,
  amount_cents                bigint       not null,
  method                      varchar(20)  not null,
  status                      varchar(20)  not null default 'pending',
  reference                   varchar(120)     null,
  stripe_payment_intent_id    varchar(255)     null,
  stripe_charge_id            varchar(255)     null,
  received_at                 datetime(3)      null,
  refunded_amount_cents       bigint       not null default 0,
  refunded_at                 datetime(3)      null,
  disputed_at                 datetime(3)      null,
  dispute_reason               text            null,
  recorded_by_user_id          char(36)        null,
  notes                        text            null,

  created_at                   datetime(3)  not null default current_timestamp(3),
  updated_at                   datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                   datetime(3)      null,
  deleted_by                   char(36)         null,
  deletion_reason               text            null,
  archived_at                   datetime(3)     null,
  purge_eligible_at             datetime(3)     null,
  legal_hold                    tinyint(1)  not null default 0,

  primary key (id),
  unique key payments_tenant_id_uq (tenant_id, id),
  key payments_tenant_idx (tenant_id),
  key payments_invoice_idx (invoice_id),
  key payments_status_idx (tenant_id, status),
  unique key payments_stripe_intent_uq (stripe_payment_intent_id),

  constraint chk_payments_method check (method in (
    'card','ach','check','wire','cash','offset','other'
  )),
  constraint chk_payments_status check (status in (
    'pending','processing','succeeded','failed','refunded','partially_refunded','disputed','cancelled'
  )),
  constraint chk_payments_amount_cents check (amount_cents >= 0)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table payment_attempts (
  id                    char(36)     not null,
  tenant_id             char(36)     not null,
  invoice_id            char(36)     not null,
  payment_id            char(36)         null,
  method                varchar(20)  not null,
  amount_cents          bigint       not null,
  status                varchar(20)  not null,
  failure_code          varchar(80)      null,
  failure_message       text             null,
  idempotency_key       varchar(120)     null,
  provider_reference    varchar(255)     null,
  attempted_at          datetime(3)  not null default current_timestamp(3),

  created_at            datetime(3)  not null default current_timestamp(3),
  updated_at            datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),

  primary key (id),
  unique key payment_attempts_tenant_id_uq (tenant_id, id),
  key payment_attempts_tenant_idx (tenant_id),
  key payment_attempts_invoice_idx (invoice_id, attempted_at),
  unique key payment_attempts_idempotency_uq (idempotency_key),

  constraint chk_payment_attempts_method check (method in (
    'card','ach','check','wire','cash','offset','other'
  )),
  constraint chk_payment_attempts_status check (status in (
    'pending','processing','succeeded','failed','refunded','partially_refunded','disputed','cancelled'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Stripe webhook ledger — the idempotency guard for event replay.
--
-- tenant_id is nullable: a webhook can legitimately arrive before the
-- application has resolved which tenant it belongs to (e.g. a Connect
-- account event that must be looked up first), so the FK
-- (84_finance_messaging_tracking_foreign_keys.sql) is on a nullable column,
-- mirroring the source's `.references(() => tenants.id, { onDelete:
-- 'cascade' })` with no `.notNull()`. stripe_events_tenant_id_uq is still
-- declared for structural consistency with every other tenant-owned table
-- in this port (MySQL never treats two NULLs in a unique index as
-- duplicates, so rows with a still-unresolved tenant_id are unconstrained
-- by it — the row's own primary key already guarantees id uniqueness
-- regardless). Nothing in this schema needs to compound-reference
-- stripe_events via (tenant_id, id); the real idempotency guarantee is
-- stripe_events_event_id_uq below.
--
-- See 95_finance_messaging_tracking_triggers.sql for the tamper-evident
-- guard: DELETE is refused, UPDATE is refused if stripe_event_id,
-- event_type or payload_digest change, but processing_status/processed_at/
-- attempts/error_message remain updatable — that is how webhook idempotency
-- is recorded (a retried delivery advances the same row's processing state).
-- ────────────────────────────────────────────────────────────────────────────
create table stripe_events (
  id                  char(36)     not null,
  tenant_id           char(36)         null,
  stripe_event_id     varchar(255) not null,
  event_type          varchar(120) not null,
  api_version         varchar(40)      null,
  -- received | processed | ignored | failed
  processing_status   varchar(20)  not null default 'received',
  payload_digest      char(64) charset ascii collate ascii_bin null,
  payload             json             null,
  processed_at        datetime(3)      null,
  error_message       text             null,
  attempts            int          not null default 0,

  created_at          datetime(3)  not null default current_timestamp(3),
  updated_at          datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),

  primary key (id),
  unique key stripe_events_tenant_id_uq (tenant_id, id),
  unique key stripe_events_event_id_uq (stripe_event_id),
  key stripe_events_type_idx (event_type),
  key stripe_events_status_idx (processing_status)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Settlements
-- ────────────────────────────────────────────────────────────────────────────
create table carrier_settlements (
  id                       char(36)     not null,
  tenant_id                char(36)     not null,
  carrier_id               char(36)     not null,
  settlement_number        varchar(40)  not null,
  period_start             datetime(3)  not null,
  period_end               datetime(3)  not null,
  gross_rate_cents         bigint       not null default 0,
  reimbursements_cents     bigint       not null default 0,
  dispatch_fees_cents      bigint       not null default 0,
  deductions_cents         bigint       not null default 0,
  net_amount_cents         bigint       not null default 0,
  -- draft | issued | paid | voided
  status                   varchar(20)  not null default 'draft',
  factoring_company_id     char(36)         null,
  -- Manual factoring: the platform records, it does not fund.
  factoring_submitted_at   datetime(3)      null,
  pdf_document_id          char(36)         null,
  issued_at                datetime(3)      null,
  paid_at                  datetime(3)      null,
  notes                    text             null,

  created_at               datetime(3)  not null default current_timestamp(3),
  updated_at               datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                datetime(3)     null,
  deleted_by                char(36)        null,
  deletion_reason            text           null,
  archived_at                datetime(3)    null,
  purge_eligible_at          datetime(3)    null,
  legal_hold                 tinyint(1)  not null default 0,

  primary key (id),
  unique key carrier_settlements_tenant_id_uq (tenant_id, id),
  unique key carrier_settlements_tenant_number_uq (tenant_id, settlement_number),
  key carrier_settlements_tenant_idx (tenant_id),
  key carrier_settlements_carrier_idx (tenant_id, carrier_id, period_end)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table carrier_settlement_lines (
  id                       char(36)     not null,
  tenant_id                char(36)     not null,
  settlement_id            char(36)     not null,
  load_id                  char(36)         null,
  financial_snapshot_id    char(36)         null,
  description_en           varchar(255) not null,
  description_es           varchar(255)     null,
  gross_rate_cents         bigint       not null default 0,
  reimbursements_cents     bigint       not null default 0,
  dispatch_fee_cents       bigint       not null default 0,
  deductions_cents         bigint       not null default 0,
  net_cents                bigint       not null default 0,

  created_at               datetime(3)  not null default current_timestamp(3),
  updated_at               datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                datetime(3)     null,
  deleted_by                 char(36)       null,
  deletion_reason             text          null,

  primary key (id),
  unique key carrier_settlement_lines_tenant_id_uq (tenant_id, id),
  key carrier_settlement_lines_tenant_idx (tenant_id),
  key carrier_settlement_lines_settlement_idx (settlement_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ============================================================================
-- Messaging
-- ============================================================================

create table conversations (
  id                    char(36)     not null,
  tenant_id             char(36)     not null,
  subject               varchar(200)     null,
  load_id               char(36)         null,
  carrier_id            char(36)         null,
  -- direct | load | broadcast
  kind                  varchar(20)  not null default 'direct',
  -- Flags operationally sensitive threads for audit retention.
  is_operational        tinyint(1)   not null default 0,
  last_message_at       datetime(3)      null,
  created_by_user_id    char(36)         null,

  created_at            datetime(3)  not null default current_timestamp(3),
  updated_at            datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at             datetime(3)     null,
  deleted_by              char(36)       null,
  deletion_reason          text          null,
  archived_at              datetime(3)   null,
  purge_eligible_at        datetime(3)   null,
  legal_hold               tinyint(1) not null default 0,

  primary key (id),
  unique key conversations_tenant_id_uq (tenant_id, id),
  key conversations_tenant_idx (tenant_id),
  key conversations_load_idx (load_id),
  key conversations_last_message_idx (tenant_id, last_message_at)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table conversation_participants (
  id                 char(36)     not null,
  tenant_id          char(36)     not null,
  conversation_id    char(36)     not null,
  user_id            char(36)     not null,
  role               varchar(30)  not null,
  last_read_at       datetime(3)      null,
  muted_at           datetime(3)      null,
  left_at            datetime(3)      null,

  created_at         datetime(3)  not null default current_timestamp(3),
  updated_at         datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at         datetime(3)      null,
  deleted_by         char(36)         null,
  deletion_reason    text             null,

  primary key (id),
  unique key conversation_participants_tenant_id_uq (tenant_id, id),
  unique key conversation_participants_uq (conversation_id, user_id),
  key conversation_participants_tenant_idx (tenant_id),
  key conversation_participants_user_idx (tenant_id, user_id),

  constraint chk_conversation_participants_role check (role in (
    'platform_super_admin','admin','accounting','dispatcher','carrier','driver'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table messages (
  id                 char(36)     not null,
  tenant_id          char(36)     not null,
  conversation_id    char(36)     not null,
  sender_user_id     char(36)         null,
  -- user | system — system messages narrate status changes in the thread.
  origin             varchar(12)  not null default 'user',
  body               text         not null,
  -- For system messages: i18n key + params instead of hard-coded text.
  system_key         varchar(80)      null,
  system_params      json             null,
  edited_at          datetime(3)      null,

  created_at         datetime(3)  not null default current_timestamp(3),
  updated_at         datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at          datetime(3)     null,
  deleted_by           char(36)       null,
  deletion_reason       text          null,
  archived_at            datetime(3) null,
  purge_eligible_at      datetime(3) null,
  legal_hold              tinyint(1) not null default 0,

  primary key (id),
  unique key messages_tenant_id_uq (tenant_id, id),
  key messages_tenant_idx (tenant_id),
  key messages_conversation_idx (conversation_id, created_at)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table message_attachments (
  id             char(36)     not null,
  tenant_id      char(36)     not null,
  message_id     char(36)     not null,
  storage_key    text         not null,
  filename       varchar(255) not null,
  content_type   varchar(120) not null,
  byte_size      bigint       not null,
  sha256         char(64) charset ascii collate ascii_bin not null,

  created_at     datetime(3)  not null default current_timestamp(3),
  updated_at     datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at      datetime(3)     null,
  deleted_by       char(36)       null,
  deletion_reason   text          null,
  archived_at        datetime(3) null,
  purge_eligible_at  datetime(3) null,
  legal_hold          tinyint(1) not null default 0,

  primary key (id),
  unique key message_attachments_tenant_id_uq (tenant_id, id),
  key message_attachments_tenant_idx (tenant_id),
  key message_attachments_message_idx (message_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Notifications
-- Event-driven. New event types are added to the catalog, not to the
-- delivery pipeline — templates and preferences resolve by event_key at
-- send time.
-- ────────────────────────────────────────────────────────────────────────────
create table notification_templates (
  id                 char(36)     not null,
  tenant_id          char(36)     not null,
  event_key          varchar(80)  not null,
  channel            varchar(10)  not null,
  locale             varchar(5)   not null,
  subject            varchar(255)     null,
  body               text         not null,
  -- Tokens the template may reference, e.g. {{loadNumber}}.
  available_tokens   json         not null default (JSON_ARRAY()),
  active             tinyint(1)   not null default 1,

  created_at         datetime(3)  not null default current_timestamp(3),
  updated_at         datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at         datetime(3)      null,
  deleted_by         char(36)         null,
  deletion_reason    text             null,

  primary key (id),
  unique key notification_templates_tenant_id_uq (tenant_id, id),
  unique key notification_templates_uq (tenant_id, event_key, channel, locale),
  key notification_templates_tenant_idx (tenant_id),

  constraint chk_notification_templates_channel check (channel in ('in_app','email','sms')),
  constraint chk_notification_templates_locale check (locale in ('en','es'))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table notification_preferences (
  id            char(36)     not null,
  tenant_id     char(36)     not null,
  user_id       char(36)     not null,
  event_key     varchar(80)  not null,
  in_app        tinyint(1)   not null default 1,
  email         tinyint(1)   not null default 1,
  sms           tinyint(1)   not null default 0,

  created_at    datetime(3)  not null default current_timestamp(3),
  updated_at    datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at    datetime(3)      null,
  deleted_by    char(36)         null,
  deletion_reason text           null,

  primary key (id),
  unique key notification_preferences_tenant_id_uq (tenant_id, id),
  unique key notification_preferences_uq (tenant_id, user_id, event_key),
  key notification_preferences_tenant_user_idx (tenant_id, user_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table notifications (
  id                     char(36)     not null,
  tenant_id              char(36)     not null,
  user_id                char(36)     not null,
  event_key              varchar(80)  not null,
  channel                varchar(10)  not null,
  status                 varchar(20)  not null default 'queued',
  locale                 varchar(5)   not null default 'en',
  title                  varchar(255) not null,
  body                   text         not null,
  -- Deep link into the app, e.g. /en/app/loads/<id>.
  action_url             varchar(500)     null,
  -- Polymorphic subject for grouping and dedupe.
  subject_type           varchar(30)      null,
  subject_id             char(36)         null,
  -- Stable key that makes repeat sweeps idempotent.
  dedupe_key             varchar(200)     null,
  provider_message_id    varchar(255)     null,
  failure_reason         text             null,
  sent_at                datetime(3)      null,
  read_at                datetime(3)      null,

  created_at             datetime(3)  not null default current_timestamp(3),
  updated_at             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at              datetime(3)     null,
  deleted_by               char(36)       null,
  deletion_reason           text          null,
  archived_at                datetime(3) null,
  purge_eligible_at          datetime(3) null,
  legal_hold                  tinyint(1) not null default 0,

  primary key (id),
  unique key notifications_tenant_id_uq (tenant_id, id),
  key notifications_tenant_idx (tenant_id),
  -- Backs the notification bell. Do not lose this index.
  key notifications_user_unread_idx (tenant_id, user_id, read_at),
  key notifications_event_idx (tenant_id, event_key),
  -- Stops the daily expiry sweep from re-notifying every morning.
  unique key notifications_dedupe_uq (dedupe_key, user_id, channel),

  constraint chk_notifications_channel check (channel in ('in_app','email','sms')),
  constraint chk_notifications_status check (status in (
    'queued','sent','delivered','failed','read','suppressed'
  )),
  constraint chk_notifications_locale check (locale in ('en','es'))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ============================================================================
-- Tracking
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Integration credentials
-- ────────────────────────────────────────────────────────────────────────────
create table integration_connections (
  id                       char(36)     not null,
  tenant_id                char(36)     not null,
  -- tracking | maps | fmcsa | ocr | email | sms | payments | tolls
  category                 varchar(30)  not null,
  provider                 varchar(40)  not null,
  display_name             varchar(120)     null,
  enabled                  tinyint(1)   not null default 0,
  -- Envelope-encrypted credential blob. Never returned to the client.
  credentials_encrypted    text             null,
  -- Non-secret configuration, safe to render in settings.
  config                   json         not null default (JSON_OBJECT()),
  -- unknown | healthy | degraded | failing
  health_status            varchar(20)  not null default 'unknown',
  last_checked_at          datetime(3)      null,
  last_error_message       text             null,

  created_at               datetime(3)  not null default current_timestamp(3),
  updated_at               datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at               datetime(3)      null,
  deleted_by               char(36)         null,
  deletion_reason          text             null,

  primary key (id),
  unique key integration_connections_tenant_id_uq (tenant_id, id),
  unique key integration_connections_uq (tenant_id, category, provider),
  key integration_connections_tenant_idx (tenant_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Tracking
-- ────────────────────────────────────────────────────────────────────────────
create table tracking_sessions (
  id                        char(36)     not null,
  tenant_id                 char(36)     not null,
  load_id                   char(36)     not null,
  driver_id                 char(36)         null,
  truck_id                  char(36)         null,
  provider                  varchar(20)  not null default 'mock',
  provider_session_id       varchar(255)     null,
  -- No location is ingested until consent is recorded.
  consent_granted_at        datetime(3)      null,
  consent_revoked_at        datetime(3)      null,
  consent_user_id           char(36)         null,
  started_at                datetime(3)      null,
  ended_at                  datetime(3)      null,
  -- unknown | healthy | stale | lost | ended
  health_status             varchar(20)  not null default 'unknown',
  last_event_at             datetime(3)      null,
  last_latitude             text             null,
  last_longitude            text             null,
  last_location_label       varchar(200)     null,
  route_progress_percent    int              null,
  remaining_miles           int              null,
  eta_at                    datetime(3)      null,

  created_at                datetime(3)  not null default current_timestamp(3),
  updated_at                datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                 datetime(3)     null,
  deleted_by                  char(36)       null,
  deletion_reason               text        null,
  archived_at                    datetime(3) null,
  purge_eligible_at              datetime(3) null,
  legal_hold                      tinyint(1) not null default 0,

  primary key (id),
  unique key tracking_sessions_tenant_id_uq (tenant_id, id),
  key tracking_sessions_tenant_idx (tenant_id),
  key tracking_sessions_load_idx (load_id),
  key tracking_sessions_health_idx (tenant_id, health_status),
  unique key tracking_sessions_provider_uq (provider, provider_session_id),

  constraint chk_tracking_sessions_provider check (provider in (
    'mock','trucker_tools','macropoint','highway','manual'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table tracking_events (
  id                        char(36)     not null,
  tenant_id                 char(36)     not null,
  session_id                char(36)     not null,
  load_id                   char(36)     not null,
  provider                  varchar(20)  not null,
  event_type                varchar(30)  not null,
  latitude                  text             null,
  longitude                 text             null,
  speed_mph                 int              null,
  heading_degrees           int              null,
  location_label            varchar(200)     null,
  -- No FK: the source declares stop_id as a plain uuid with no
  -- .references() call — a load's stops are not necessarily loaded when a
  -- tracking event is ingested, and the app resolves this loosely.
  stop_id                   char(36)         null,
  -- Provider's own event id — the idempotency key for ingestion.
  raw_provider_reference    varchar(255)     null,
  raw_payload                json            null,
  occurred_at                datetime(3)  not null,
  ingested_at                 datetime(3)  not null default current_timestamp(3),

  created_at                  datetime(3)  not null default current_timestamp(3),
  updated_at                  datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  archived_at                  datetime(3)     null,
  purge_eligible_at            datetime(3)     null,
  legal_hold                    tinyint(1)  not null default 0,

  primary key (id),
  unique key tracking_events_tenant_id_uq (tenant_id, id),
  key tracking_events_tenant_idx (tenant_id),
  -- Backs the event timeline. Do not lose this index.
  key tracking_events_session_idx (session_id, occurred_at),
  key tracking_events_load_idx (load_id, occurred_at),
  unique key tracking_events_provider_ref_uq (provider, raw_provider_reference),

  constraint chk_tracking_events_provider check (provider in (
    'mock','trucker_tools','macropoint','highway','manual'
  )),
  constraint chk_tracking_events_event_type check (event_type in (
    'session_started','consent_granted','consent_revoked','location_update',
    'geofence_enter','geofence_exit','arrived_pickup','departed_pickup',
    'arrived_delivery','departed_delivery','stopped','session_ended','error'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Customers have no accounts; they receive a signed, expiring link that
-- exposes a deliberately narrow projection of one load.
-- ────────────────────────────────────────────────────────────────────────────
create table public_tracking_links (
  id                    char(36)     not null,
  tenant_id             char(36)     not null,
  load_id               char(36)     not null,
  token_hash            char(64) charset ascii collate ascii_bin not null,
  label                 varchar(120)     null,
  recipient_email       varchar(255)     null,
  expires_at            datetime(3)  not null,
  revoked_at            datetime(3)      null,
  view_count            int          not null default 0,
  last_viewed_at        datetime(3)      null,
  created_by_user_id    char(36)         null,

  created_at            datetime(3)  not null default current_timestamp(3),
  updated_at            datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at            datetime(3)      null,
  deleted_by            char(36)         null,
  deletion_reason       text             null,

  primary key (id),
  unique key public_tracking_links_tenant_id_uq (tenant_id, id),
  unique key public_tracking_links_token_uq (token_hash),
  key public_tracking_links_tenant_idx (tenant_id),
  key public_tracking_links_load_idx (load_id),
  -- Backs the link-expiry job. Do not lose this index.
  key public_tracking_links_expiry_idx (expires_at)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;
