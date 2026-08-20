-- ============================================================================
-- Goliath Dispatch — Carriers / Documents / Signatures domain
-- Tables only. NO foreign keys here — see 81_carriers_documents_signatures_foreign_keys.sql
-- for the reason (several FKs point at tables owned by other domains: tenants, users).
--
-- Conventions (see docs/mysql-port.md for the verified rationale):
--   * char(36) UUID primary keys.
--   * Every tenant-owned table also carries unique key <table>_tenant_id_uq
--     (tenant_id, id) so a child row can structurally reference (tenant_id, id)
--     of its parent.
--   * datetime(3) for every date/time column, never timestamp (2038 ceiling).
--   * Enums are varchar(n) + CHECK (col IN (...)); the PHP backed enum in
--     app/Enums/ is the application-side source of truth and must list the
--     exact same values (see docs/port-notes-carriers-documents-signatures.md
--     for how that agreement is guaranteed and verified).
--   * Percentages are basis points (int) with CHECK (col BETWEEN 0 AND 10000).
--   * Hash/token/digest columns are char(64) charset ascii collate ascii_bin:
--     hex digests only need ascii, and ascii_bin makes comparisons
--     case-sensitive — an ai_ci collation would treat two hashes differing
--     only in case as equal, which is a defect, not a convenience, on
--     tamper-evidence columns.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Carriers
-- A carrier that works with two dispatch companies exists as two independent
-- rows — one per tenant. There is no global carrier registry by design.
-- ────────────────────────────────────────────────────────────────────────────
create table carriers (
  id                          char(36)     not null,
  tenant_id                   char(36)     not null,
  legal_name                  varchar(200) not null,
  dba                         varchar(200)     null,
  dot_number                  varchar(12)  not null,
  mc_number                   varchar(12)      null,
  -- EIN is encrypted at rest; only the last four are ever rendered. Never widen this to plaintext.
  ein_encrypted               text             null,
  ein_last4                   varchar(4)       null,

  contact_first_name          varchar(100) not null,
  contact_last_name           varchar(100) not null,
  email                       varchar(255) not null,
  phone                       varchar(32)  not null,
  website                     varchar(255)     null,
  preferred_locale            varchar(2)   not null default 'en',

  physical_line1              varchar(200)     null,
  physical_line2              varchar(200)     null,
  physical_city                varchar(120)     null,
  physical_state              varchar(2)       null,
  physical_postal_code        varchar(12)      null,
  physical_country            varchar(2)       null default 'US',
  physical_place_id           varchar(255)     null,

  mailing_same_as_physical    tinyint(1)   not null default 1,
  mailing_line1               varchar(200)     null,
  mailing_line2               varchar(200)     null,
  mailing_city                varchar(120)     null,
  mailing_state               varchar(2)       null,
  mailing_postal_code         varchar(12)      null,
  mailing_country              varchar(2)       null default 'US',

  -- Percentage the dispatch company charges this carrier, in basis points.
  dispatch_fee_bps            int          not null default 1000,

  onboarding_status           varchar(30)  not null default 'draft',
  fmcsa_status                varchar(30)  not null default 'not_started',
  fmcsa_last_verified_at      datetime(3)      null,
  fmcsa_next_verification_at  datetime(3)      null,

  approved_at                 datetime(3)      null,
  approved_by_user_id         char(36)         null,
  suspended_at                datetime(3)      null,
  suspension_reason           text             null,

  uses_factoring              tinyint(1)   not null default 0,
  notes                       text             null,
  last_activity_at            datetime(3)      null,

  created_at                  datetime(3)  not null default current_timestamp(3),
  updated_at                  datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                  datetime(3)      null,
  deleted_by                  char(36)         null,
  deletion_reason             text             null,
  archived_at                 datetime(3)      null,
  purge_eligible_at           datetime(3)      null,
  legal_hold                  tinyint(1)   not null default 0,

  -- Partial-unique emulation. A carrier removed by mistake must be re-addable under the same USDOT number.
  -- Postgres held a plain unique on (tenant_id, dot_number), which burned the
  -- number permanently once deleted_at was set. See docs/mysql-port.md.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_dot_key` varchar(12) generated always as (
    case when `deleted_at` is null then `dot_number` end
  ) stored,
  primary key (id),
  unique key carriers_tenant_id_uq (tenant_id, id),
  -- DOT is unique per tenant, NOT globally: the same carrier working with
  -- three dispatch companies is three independent rows.
  unique key `carriers_tenant_dot_uq` (`tenant_id`, `live_dot_key`),
  key carriers_tenant_idx (tenant_id),
  key carriers_tenant_status_idx (tenant_id, onboarding_status),
  key carriers_tenant_mc_idx (tenant_id, mc_number),
  key carriers_legal_name_idx (tenant_id, legal_name),
  -- Drives the FMCSA reverification background sweep; do not lose this index.
  key carriers_next_verification_idx (fmcsa_next_verification_at),

  constraint chk_carriers_preferred_locale check (preferred_locale in ('en','es')),
  constraint chk_carriers_onboarding_status check (onboarding_status in (
    'draft','submitted','under_review','corrections_required','approved','rejected','suspended'
  )),
  constraint chk_carriers_fmcsa_status check (fmcsa_status in (
    'not_started','pending','verified','mismatch','failed','manually_overridden','expired'
  )),
  constraint chk_carriers_dispatch_fee_bps check (dispatch_fee_bps between 0 and 10000)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Carrier users
-- ────────────────────────────────────────────────────────────────────────────
create table carrier_users (
  id           char(36)     not null,
  tenant_id    char(36)     not null,
  carrier_id   char(36)     not null,
  user_id      char(36)     not null,
  is_primary   tinyint(1)   not null default 0,
  title        varchar(120)     null,

  created_at   datetime(3)  not null default current_timestamp(3),
  updated_at   datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at   datetime(3)      null,
  deleted_by   char(36)         null,
  deletion_reason text          null,

  primary key (id),
  unique key carrier_users_tenant_id_uq (tenant_id, id),
  unique key carrier_users_uq (tenant_id, carrier_id, user_id),
  key carrier_users_tenant_idx (tenant_id),
  key carrier_users_user_idx (user_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Onboarding workflow
-- ────────────────────────────────────────────────────────────────────────────
create table carrier_onboardings (
  id                          char(36)     not null,
  tenant_id                   char(36)     not null,
  carrier_id                  char(36)     not null,
  status                      varchar(30)  not null default 'draft',
  submitted_at                datetime(3)      null,
  review_started_at           datetime(3)      null,
  decided_at                  datetime(3)      null,
  decided_by_user_id          char(36)         null,
  corrections_requested_at    datetime(3)      null,
  correction_notes            text             null,
  rejection_reason            text             null,
  required_document_types     json         not null default (JSON_ARRAY()),
  checklist                   json         not null default (JSON_ARRAY()),

  created_at                  datetime(3)  not null default current_timestamp(3),
  updated_at                  datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                  datetime(3)      null,
  deleted_by                  char(36)         null,
  deletion_reason              text             null,
  archived_at                 datetime(3)      null,
  purge_eligible_at           datetime(3)      null,
  legal_hold                  tinyint(1)   not null default 0,

  primary key (id),
  unique key carrier_onboardings_tenant_id_uq (tenant_id, id),
  -- One active onboarding record per carrier.
  unique key carrier_onboardings_carrier_uq (carrier_id),
  key carrier_onboardings_tenant_idx (tenant_id),
  key carrier_onboardings_tenant_status_idx (tenant_id, status),

  constraint chk_carrier_onboardings_status check (status in (
    'draft','submitted','under_review','corrections_required','approved','rejected','suspended'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table carrier_onboarding_events (
  id              char(36)    not null,
  tenant_id       char(36)    not null,
  onboarding_id   char(36)    not null,
  from_status     varchar(30)     null,
  to_status       varchar(30) not null,
  actor_user_id   char(36)        null,
  reason          text            null,

  created_at      datetime(3) not null default current_timestamp(3),
  updated_at      datetime(3) not null default current_timestamp(3) on update current_timestamp(3),

  primary key (id),
  unique key carrier_onboarding_events_tenant_id_uq (tenant_id, id),
  key carrier_onboarding_events_onboarding_idx (onboarding_id),

  constraint chk_carrier_onboarding_events_from_status check (from_status is null or from_status in (
    'draft','submitted','under_review','corrections_required','approved','rejected','suspended'
  )),
  constraint chk_carrier_onboarding_events_to_status check (to_status in (
    'draft','submitted','under_review','corrections_required','approved','rejected','suspended'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Dispatcher profiles, assignments, groups
-- ────────────────────────────────────────────────────────────────────────────
create table dispatcher_profiles (
  id               char(36)     not null,
  tenant_id        char(36)     not null,
  user_id          char(36)     not null,
  -- Commission percentage in basis points (2500 = 25.00%).
  commission_bps   int          not null default 2500,
  employee_code    varchar(40)      null,
  hired_on         datetime(3)      null,
  active           tinyint(1)   not null default 1,
  notes            text             null,

  created_at       datetime(3)  not null default current_timestamp(3),
  updated_at       datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at       datetime(3)      null,
  deleted_by       char(36)         null,
  deletion_reason  text             null,

  primary key (id),
  unique key dispatcher_profiles_tenant_id_uq (tenant_id, id),
  unique key dispatcher_profiles_tenant_user_uq (tenant_id, user_id),
  key dispatcher_profiles_tenant_idx (tenant_id),

  constraint chk_dispatcher_profiles_commission_bps check (commission_bps between 0 and 10000)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table carrier_dispatcher_assignments (
  id                    char(36)     not null,
  tenant_id             char(36)     not null,
  carrier_id            char(36)     not null,
  dispatcher_user_id    char(36)     not null,
  is_primary            tinyint(1)   not null default 0,
  start_date            datetime(3)  not null default current_timestamp(3),
  end_date              datetime(3)      null,
  assigned_by_user_id   char(36)         null,
  reason                text             null,

  created_at            datetime(3)  not null default current_timestamp(3),
  updated_at            datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at            datetime(3)      null,
  deleted_by            char(36)         null,
  deletion_reason       text             null,

  primary key (id),
  unique key carrier_dispatcher_assignments_tenant_id_uq (tenant_id, id),
  key carrier_dispatcher_tenant_idx (tenant_id),
  key carrier_dispatcher_carrier_idx (carrier_id),
  key carrier_dispatcher_user_idx (dispatcher_user_id),
  key carrier_dispatcher_active_idx (tenant_id, dispatcher_user_id, end_date)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table dispatcher_groups (
  id                          char(36)     not null,
  tenant_id                   char(36)     not null,
  name                        varchar(120) not null,
  description                 text             null,
  owner_dispatcher_user_id    char(36)         null,
  active                      tinyint(1)   not null default 1,

  created_at                  datetime(3)  not null default current_timestamp(3),
  updated_at                  datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                  datetime(3)      null,
  deleted_by                  char(36)         null,
  deletion_reason             text             null,

  -- Partial-unique emulation. Group names are user-facing labels; deleting one must free the name.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_name_key` varchar(200) generated always as (
    case when `deleted_at` is null then `name` end
  ) stored,
  primary key (id),
  unique key dispatcher_groups_tenant_id_uq (tenant_id, id),
  unique key `dispatcher_groups_tenant_name_uq` (`tenant_id`, `live_name_key`),
  key dispatcher_groups_tenant_idx (tenant_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- A group can hold carriers, trucks, trailers and drivers — one row per member.
create table group_members (
  id                char(36)    not null,
  tenant_id         char(36)    not null,
  group_id          char(36)    not null,
  member_type       varchar(20) not null, -- carrier|truck|trailer|driver
  member_id         char(36)    not null,
  added_by_user_id  char(36)        null,

  created_at        datetime(3) not null default current_timestamp(3),
  updated_at        datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at        datetime(3)     null,
  deleted_by        char(36)        null,
  deletion_reason   text            null,

  primary key (id),
  unique key group_members_tenant_id_uq (tenant_id, id),
  unique key group_members_uq (group_id, member_type, member_id),
  key group_members_tenant_idx (tenant_id),
  key group_members_lookup_idx (tenant_id, member_type, member_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- Explicit resource-level grants for dispatchers. A dispatcher assigned to a
-- carrier may still only edit the trucks/trailers/drivers granted here (or the
-- ones reachable through a group they own).
create table dispatcher_resource_assignments (
  id                    char(36)    not null,
  tenant_id             char(36)    not null,
  dispatcher_user_id    char(36)    not null,
  resource_type         varchar(20) not null, -- truck|trailer|driver|group
  resource_id           char(36)    not null,
  start_date            datetime(3) not null default current_timestamp(3),
  end_date              datetime(3)     null,
  assigned_by_user_id   char(36)        null,
  reason                text            null,

  created_at            datetime(3) not null default current_timestamp(3),
  updated_at            datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at            datetime(3)     null,
  deleted_by            char(36)        null,
  deletion_reason       text            null,

  primary key (id),
  unique key dispatcher_resource_assignments_tenant_id_uq (tenant_id, id),
  key dispatcher_resource_tenant_idx (tenant_id),
  key dispatcher_resource_user_idx (tenant_id, dispatcher_user_id),
  unique key dispatcher_resource_uq (tenant_id, dispatcher_user_id, resource_type, resource_id, start_date)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- FMCSA verification ledger
-- ────────────────────────────────────────────────────────────────────────────
create table fmcsa_verifications (
  id                      char(36)    not null,
  tenant_id               char(36)    not null,
  carrier_id              char(36)    not null,
  provider                varchar(40) not null default 'mock',
  dot_number               varchar(12) not null,
  mc_number               varchar(12)     null,
  status                  varchar(20) not null,
  -- Normalized, provider-independent projection used by the application.
  normalized              json            null,
  -- Field-by-field comparison against the tenant-entered data.
  mismatches              json        not null default (JSON_ARRAY()),
  raw_reference           text            null,
  raw_payload_digest      char(64) charset ascii collate ascii_bin null,
  attempt                 int         not null default 1,
  error_message           text            null,
  checked_at              datetime(3) not null default current_timestamp(3),
  overridden_by_user_id   char(36)        null,
  override_reason         text            null,
  overridden_at           datetime(3)     null,

  created_at              datetime(3) not null default current_timestamp(3),
  updated_at              datetime(3) not null default current_timestamp(3) on update current_timestamp(3),

  primary key (id),
  unique key fmcsa_verifications_tenant_id_uq (tenant_id, id),
  key fmcsa_verifications_tenant_idx (tenant_id),
  key fmcsa_verifications_carrier_idx (carrier_id, checked_at),
  key fmcsa_verifications_dot_idx (dot_number),

  constraint chk_fmcsa_verifications_status check (status in (
    'not_started','pending','verified','mismatch','failed','manually_overridden','expired'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Factoring
-- ────────────────────────────────────────────────────────────────────────────
create table factoring_companies (
  id                     char(36)     not null,
  tenant_id              char(36)     not null,
  name                   varchar(200) not null,
  contact_name           varchar(200)     null,
  email                  varchar(255)     null,
  phone                  varchar(32)      null,
  address_line1          varchar(200)     null,
  address_city           varchar(120)     null,
  address_state          varchar(2)       null,
  address_postal_code    varchar(12)      null,
  funding_instructions   text             null,
  active                 tinyint(1)   not null default 1,

  created_at             datetime(3)  not null default current_timestamp(3),
  updated_at             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at             datetime(3)      null,
  deleted_by             char(36)         null,
  deletion_reason        text             null,

  -- Partial-unique emulation. Names are user-facing labels; deleting one must free the name.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_name_key` varchar(200) generated always as (
    case when `deleted_at` is null then `name` end
  ) stored,
  primary key (id),
  unique key factoring_companies_tenant_id_uq (tenant_id, id),
  unique key `factoring_companies_tenant_name_uq` (`tenant_id`, `live_name_key`),
  key factoring_companies_tenant_idx (tenant_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table factoring_assignments (
  id                                char(36)    not null,
  tenant_id                         char(36)    not null,
  carrier_id                        char(36)    not null,
  factoring_company_id              char(36)    not null,
  -- Manual workflow: nothing here is settled through a factoring API.
  verification_status               varchar(20) not null default 'not_started',
  notice_of_assignment_document_id  char(36)        null,
  change_of_payee_document_id       char(36)        null,
  effective_from                    datetime(3)     null,
  effective_to                      datetime(3)     null,
  verified_by_user_id               char(36)        null,
  verified_at                       datetime(3)     null,
  notes                             text            null,

  created_at                        datetime(3) not null default current_timestamp(3),
  updated_at                        datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                        datetime(3)     null,
  deleted_by                        char(36)        null,
  deletion_reason                   text            null,
  archived_at                       datetime(3)     null,
  purge_eligible_at                 datetime(3)     null,
  legal_hold                        tinyint(1)  not null default 0,

  primary key (id),
  unique key factoring_assignments_tenant_id_uq (tenant_id, id),
  key factoring_assignments_tenant_idx (tenant_id),
  key factoring_assignments_carrier_idx (carrier_id),

  constraint chk_factoring_assignments_verification_status check (verification_status in (
    'not_started','pending','verified','mismatch','failed','manually_overridden','expired'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ============================================================================
-- Documents
-- ============================================================================

-- One logical document (e.g. "this carrier's COI") with an ordered chain of
-- immutable versions. The current_version_id pointer is what the UI renders;
-- superseded versions are retained for the audit trail. (current_version_id
-- deliberately carries no foreign key in the source schema either — it points
-- forward into document_versions, which points back at documents, and pinning
-- it structurally would create a circular dependency.)
create table documents (
  id                     char(36)     not null,
  tenant_id              char(36)     not null,
  document_type          varchar(30)  not null,
  -- Polymorphic owner: carrier | truck | trailer | driver | load | tenant | invoice
  owner_type             varchar(20)  not null,
  owner_id               char(36)     not null,
  title                  varchar(200)     null,
  description            text             null,
  current_version_id     char(36)         null,
  review_status          varchar(20)  not null default 'pending',
  issue_date             datetime(3)      null,
  expiration_date        datetime(3)      null,
  -- True when the type is required for the owner's compliance gate.
  is_required            tinyint(1)   not null default 0,
  -- Denormalized for fast expiration sweeps.
  expires_soon_at        datetime(3)      null,
  uploaded_by_user_id    char(36)         null,

  created_at             datetime(3)  not null default current_timestamp(3),
  updated_at             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at             datetime(3)      null,
  deleted_by             char(36)         null,
  deletion_reason        text             null,
  archived_at            datetime(3)      null,
  purge_eligible_at      datetime(3)      null,
  legal_hold             tinyint(1)   not null default 0,

  primary key (id),
  unique key documents_tenant_id_uq (tenant_id, id),
  key documents_tenant_idx (tenant_id),
  key documents_owner_idx (tenant_id, owner_type, owner_id),
  key documents_type_idx (tenant_id, document_type),
  key documents_review_status_idx (tenant_id, review_status),
  -- Expiration-sweep indexes: background jobs scan by these. Losing either
  -- turns an indexed sweep into a table scan.
  key documents_expiration_idx (tenant_id, expiration_date),
  key documents_expires_soon_idx (expires_soon_at),

  constraint chk_documents_document_type check (document_type in (
    'certificate_of_authority','certificate_of_insurance','w9','notice_of_assignment',
    'change_of_payee','carrier_agreement','other_onboarding',
    'truck_registration','trailer_registration','annual_inspection','equipment_photo','equipment_video',
    'cdl_front','cdl_back','medical_card','driver_other',
    'bol','pod','rate_confirmation','permit','escort_document','route_survey','receipt','invoice',
    'lumper_receipt','scale_ticket','other'
  )),
  constraint chk_documents_review_status check (review_status in (
    'pending','in_review','approved','rejected','expired','superseded'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table document_versions (
  id                      char(36)     not null,
  tenant_id               char(36)     not null,
  document_id             char(36)     not null,
  version_number          int          not null,
  -- Private object key. Always prefixed `tenants/<tenantId>/…` — see storage layer.
  storage_key             text         not null,
  original_filename       varchar(255) not null,
  content_type            varchar(120) not null,
  byte_size               bigint       not null,
  sha256                  char(64) charset ascii collate ascii_bin not null,
  page_count              int              null,
  malware_scan_status     varchar(20)  not null default 'not_scanned',
  malware_scan_at         datetime(3)      null,
  -- Structured output of OCR/extraction (e.g. VINs found on a COI).
  extraction              json             null,
  extraction_status       varchar(20)  not null default 'not_started',
  uploaded_by_user_id     char(36)         null,

  created_at              datetime(3)  not null default current_timestamp(3),
  updated_at              datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at              datetime(3)      null,
  deleted_by              char(36)         null,
  deletion_reason         text             null,
  archived_at             datetime(3)      null,
  purge_eligible_at       datetime(3)      null,
  legal_hold              tinyint(1)   not null default 0,

  primary key (id),
  unique key document_versions_tenant_id_uq (tenant_id, id),
  unique key document_versions_doc_version_uq (document_id, version_number),
  key document_versions_tenant_idx (tenant_id),
  key document_versions_sha_idx (tenant_id, sha256)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table document_reviews (
  id                     char(36)     not null,
  tenant_id              char(36)     not null,
  document_id            char(36)     not null,
  document_version_id    char(36)     not null,
  status                 varchar(20)  not null,
  reviewer_user_id       char(36)     not null,
  notes                  text             null,
  -- Required by policy whenever status = 'rejected'.
  rejection_reason       text             null,
  reviewed_at            datetime(3)  not null default current_timestamp(3),

  created_at             datetime(3)  not null default current_timestamp(3),
  updated_at             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),

  primary key (id),
  unique key document_reviews_tenant_id_uq (tenant_id, id),
  key document_reviews_tenant_idx (tenant_id),
  key document_reviews_document_idx (document_id, reviewed_at),

  constraint chk_document_reviews_status check (status in (
    'pending','in_review','approved','rejected','expired','superseded'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- Materialized expiration notices so the sweep job stays idempotent.
create table document_expirations (
  id                   char(36)    not null,
  tenant_id            char(36)    not null,
  document_id          char(36)    not null,
  expiration_date      datetime(3) not null,
  warning_days         int         not null,
  -- `warning` when approaching, `expired` once past due.
  kind                 varchar(12) not null,
  first_detected_at    datetime(3) not null default current_timestamp(3),
  notified_at          datetime(3)     null,
  resolved_at          datetime(3)     null,

  created_at           datetime(3) not null default current_timestamp(3),
  updated_at           datetime(3) not null default current_timestamp(3) on update current_timestamp(3),

  primary key (id),
  unique key document_expirations_tenant_id_uq (tenant_id, id),
  unique key document_expirations_uq (document_id, kind, expiration_date),
  key document_expirations_tenant_idx (tenant_id),
  key document_expirations_unresolved_idx (tenant_id, resolved_at)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- Every read of a private object is recorded — required by the retention policy.
create table document_access_logs (
  id                     char(36)    not null,
  tenant_id              char(36)    not null,
  document_id            char(36)    not null,
  document_version_id    char(36)        null,
  user_id                char(36)        null,
  action                 varchar(20) not null, -- view | download | print
  watermarked            tinyint(1)  not null default 0,
  ip_address             varchar(45)     null,
  user_agent             text            null,

  created_at             datetime(3) not null default current_timestamp(3),
  updated_at             datetime(3) not null default current_timestamp(3) on update current_timestamp(3),

  primary key (id),
  unique key document_access_logs_tenant_id_uq (tenant_id, id),
  key document_access_logs_tenant_idx (tenant_id),
  key document_access_logs_document_idx (document_id, created_at)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ============================================================================
-- Signatures
-- ============================================================================

-- Versioned agreement templates. Bumping `version` invalidates prior signatures
-- for compliance purposes and triggers a re-signature request.
create table signature_templates (
  id                  char(36)     not null,
  tenant_id           char(36)     not null,
  -- notice_of_assignment | change_of_payee | carrier_agreement | custom
  template_key        varchar(60)  not null,
  version              int          not null default 1,
  title_en            varchar(200) not null,
  title_es            varchar(200) not null,
  -- Markdown-ish body with {{token}} placeholders, one per locale.
  body_en             text         not null,
  body_es             text         not null,
  -- Tenant-editable legal copy shown during the ceremony.
  consent_copy_en     text         not null,
  consent_copy_es     text         not null,
  -- SHA-256 of the canonical template content — pinned into every signature.
  content_hash        char(64) charset ascii collate ascii_bin not null,
  required_tokens     json         not null default (JSON_ARRAY()),
  active              tinyint(1)   not null default 1,
  effective_from      datetime(3)  not null default current_timestamp(3),
  retired_at          datetime(3)      null,

  created_at          datetime(3)  not null default current_timestamp(3),
  updated_at          datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at          datetime(3)      null,
  deleted_by          char(36)         null,
  deletion_reason     text             null,
  archived_at         datetime(3)      null,
  purge_eligible_at   datetime(3)      null,
  legal_hold          tinyint(1)   not null default 0,

  primary key (id),
  unique key signature_templates_tenant_id_uq (tenant_id, id),
  unique key signature_templates_tenant_key_version_uq (tenant_id, template_key, version),
  key signature_templates_tenant_idx (tenant_id),
  key signature_templates_active_idx (tenant_id, template_key, active)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table signature_requests (
  id                         char(36)     not null,
  tenant_id                  char(36)     not null,
  template_id                char(36)     not null,
  template_version            int          not null,
  template_content_hash      char(64) charset ascii collate ascii_bin not null,
  -- Polymorphic subject: carrier | load | tenant
  subject_type               varchar(20)  not null,
  subject_id                 char(36)     not null,
  carrier_id                 char(36)         null,
  signer_user_id             char(36)         null,
  signer_email               varchar(255) not null,
  signer_legal_name          varchar(200)     null,
  locale                     varchar(2)   not null default 'en',
  status                     varchar(20)  not null default 'pending',
  -- Resolved token values rendered into the document.
  token_values                json         not null default (JSON_OBJECT()),
  -- SHA-256 of the access token; the raw token is emailed, never stored.
  access_token_hash          char(64) charset ascii collate ascii_bin null,
  requested_by_user_id       char(36)         null,
  requested_at               datetime(3)  not null default current_timestamp(3),
  first_viewed_at            datetime(3)      null,
  completed_at               datetime(3)      null,
  declined_at                datetime(3)      null,
  decline_reason             text             null,
  expires_at                 datetime(3)      null,
  voided_at                  datetime(3)      null,
  void_reason                text             null,
  -- Set when a newer template version supersedes this request. No FK: it is
  -- a forward self-reference that would otherwise require deferred constraints.
  superseded_by_request_id   char(36)         null,

  created_at                 datetime(3)  not null default current_timestamp(3),
  updated_at                 datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                 datetime(3)      null,
  deleted_by                 char(36)         null,
  deletion_reason            text             null,
  archived_at                datetime(3)      null,
  purge_eligible_at          datetime(3)      null,
  legal_hold                 tinyint(1)   not null default 0,

  primary key (id),
  unique key signature_requests_tenant_id_uq (tenant_id, id),
  key signature_requests_tenant_idx (tenant_id),
  key signature_requests_subject_idx (tenant_id, subject_type, subject_id),
  key signature_requests_status_idx (tenant_id, status),
  key signature_requests_carrier_idx (carrier_id),
  unique key signature_requests_token_uq (access_token_hash),

  constraint chk_signature_requests_locale check (locale in ('en','es')),
  constraint chk_signature_requests_status check (status in (
    'pending','viewed','signed','declined','expired','voided','superseded'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- The tamper-evident artifact. See 92_carriers_documents_signatures_triggers.sql
-- for the guard: DELETE is refused outright; UPDATE is refused only when a
-- tamper-relevant column changes. Retention columns stay updatable so the
-- archival job can run.
create table signature_records (
  id                                    char(36)     not null,
  tenant_id                             char(36)     not null,
  request_id                            char(36)     not null,

  signer_user_id                        char(36)         null,
  signer_legal_name                     varchar(200) not null,
  signer_email                          varchar(255) not null,
  signer_title                          varchar(120)     null,

  method                                varchar(10)  not null,
  -- Data URL (drawn) or rendered typed mark; stored as a private object.
  signature_storage_key                 text         not null,
  -- SHA-256 of the raw signature bytes.
  signature_sha256                      char(64) charset ascii collate ascii_bin not null,
  typed_name_value                      varchar(200)     null,

  consent_accepted                      tinyint(1)   not null,
  consent_copy_hash                     char(64) charset ascii collate ascii_bin not null,

  -- SHA-256 of the flattened, signed PDF bytes.
  document_sha256                       char(64) charset ascii collate ascii_bin not null,
  signed_document_id                    char(36)         null,
  audit_certificate_document_id         char(36)         null,

  -- HMAC over (templateHash, documentSha256, signatureSha256, signer identity,
  -- timestamp) keyed by SIGNATURE_HASH_PEPPER. Any later edit breaks the seal.
  integrity_seal                        char(64) charset ascii collate ascii_bin not null,
  seal_algorithm                        varchar(40)  not null default 'HMAC-SHA256',

  ip_address                            varchar(45)  not null,
  user_agent                            text         not null,
  locale                                varchar(2)   not null default 'en',
  signed_at                             datetime(3)  not null default current_timestamp(3),

  created_at                            datetime(3)  not null default current_timestamp(3),
  updated_at                            datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  -- Retention columns only — signature_records carries no soft-delete columns
  -- by design: the record is tamper-evident, not disposable.
  archived_at                           datetime(3)      null,
  purge_eligible_at                     datetime(3)      null,
  legal_hold                            tinyint(1)   not null default 0,

  primary key (id),
  unique key signature_records_tenant_id_uq (tenant_id, id),
  unique key signature_records_request_uq (request_id),
  key signature_records_tenant_idx (tenant_id),
  key signature_records_signed_at_idx (tenant_id, signed_at),

  constraint chk_signature_records_method check (method in ('drawn','typed')),
  constraint chk_signature_records_locale check (locale in ('en','es'))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- Append-only ceremony log. Rows are never updated or deleted — enforced by
-- triggers in 92_carriers_documents_signatures_triggers.sql.
create table signature_audit_events (
  id                     char(36)     not null,
  tenant_id              char(36)     not null,
  request_id             char(36)     not null,
  record_id              char(36)         null,
  -- requested | emailed | opened | viewed | consent_shown | consent_accepted |
  -- signature_captured | document_generated | sealed | emailed_copy | declined |
  -- voided | superseded | certificate_downloaded
  event_type             varchar(40)  not null,
  actor_user_id          char(36)         null,
  actor_email            varchar(255)     null,
  ip_address             varchar(45)      null,
  user_agent             text             null,
  detail                 json             null,
  -- Hash chain: sha256(previousHash || canonical(this event)).
  previous_event_hash    char(64) charset ascii collate ascii_bin null,
  event_hash             char(64) charset ascii collate ascii_bin not null,
  occurred_at            datetime(3)  not null default current_timestamp(3),

  created_at             datetime(3)  not null default current_timestamp(3),
  updated_at             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  archived_at            datetime(3)      null,
  purge_eligible_at      datetime(3)      null,
  legal_hold             tinyint(1)   not null default 0,

  primary key (id),
  unique key signature_audit_events_tenant_id_uq (tenant_id, id),
  key signature_audit_events_tenant_idx (tenant_id),
  key signature_audit_events_request_idx (request_id, occurred_at),
  unique key signature_audit_events_hash_uq (event_hash)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;
