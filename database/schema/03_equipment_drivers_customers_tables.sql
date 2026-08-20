-- ============================================================================
-- Goliath Dispatch — Equipment / Drivers / Customers domain
-- Tables only. NO foreign keys here — see
-- 82_equipment_drivers_customers_foreign_keys.sql for the reason (several FKs
-- point at tables owned by other domains: tenants, users, carriers,
-- documents, equipment_types).
--
-- Conventions (see docs/mysql-port.md for the verified rationale):
--   * char(36) UUID primary keys.
--   * Every tenant-owned table also carries unique key <table>_tenant_id_uq
--     (tenant_id, id) so a child row can structurally reference (tenant_id,
--     id) of its parent.
--   * datetime(3) for every date/time column, never timestamp (2038 ceiling)
--     — except drivers.date_of_birth, which is a plain `date`: it is a
--     calendar fact with no time-of-day component, and the application only
--     ever renders an age from it.
--   * Enums are varchar(n) + CHECK (col IN (...)); the PHP backed enum in
--     app/Enums/ is the application-side source of truth and must list the
--     exact same values (see docs/port-notes-equipment-drivers-customers.md
--     for how that agreement is guaranteed and verified).
--   * Columns whose Postgres source has no pgEnum type — only a comment
--     documenting the intended values (e.g. equipment_media.angle,
--     equipment_media.media_kind, customers.status) — are ported as plain
--     varchar with NO CHECK constraint, exactly mirroring the fact that
--     Postgres itself does not enforce them either.
--   * Hash/token/digest columns are char(64) charset ascii collate ascii_bin:
--     hex digests only need ascii, and ascii_bin makes comparisons
--     case-sensitive — an ai_ci collation would treat two hashes differing
--     only in case as equal, which is a defect (not a convenience) on a
--     blind-index / tamper-evidence column. This applies to
--     drivers.license_number_hash (an HMAC blind index) and
--     equipment_media.sha256 (a content digest), even though neither is
--     literally named "hash" the way carrier document hashes are.
--   * Money is signed bigint cents; CHECK (>= 0) only where the source value
--     cannot be legitimately negative (customers.credit_limit_cents).
--   * Dimensions are plain integers in inches, capacities in pounds —
--     imperial units throughout, exactly as the source declares them, with
--     no CHECK (the source has none either).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Trucks
-- ────────────────────────────────────────────────────────────────────────────
create table trucks (
  id                          char(36)     not null,
  tenant_id                   char(36)     not null,
  carrier_id                  char(36)     not null,
  unit_number                 varchar(40)  not null,
  vin                         varchar(17)  not null,
  -- Uppercased, O/I/Q-normalized VIN used for exact COI matching. This is what
  -- catches the duplicate a carrier creates by typing "O" where the real VIN
  -- has a "0" — the two VINs differ as typed but fold to the same normalized
  -- value, and the unique index below rejects the second insert.
  vin_normalized               varchar(17)  not null,
  year                        int              null,
  make                        varchar(60)      null,
  model                       varchar(60)      null,
  equipment_type_id           char(36)         null,
  plate_number                varchar(20)      null,
  plate_state                 varchar(2)       null,
  status                      varchar(30)  not null default 'pending_verification',
  vin_decode_source           varchar(40)      null,
  vin_decoded_at              datetime(3)      null,
  registration_number         varchar(60)      null,
  registration_expires_at     datetime(3)      null,
  last_inspection_at          datetime(3)      null,
  next_inspection_due_at      datetime(3)      null,
  last_maintenance_at         datetime(3)      null,
  next_maintenance_due_at     datetime(3)      null,
  coi_verification_status     varchar(30)  not null default 'not_started',
  out_of_service_reason       text             null,
  notes                       text             null,

  created_at                  datetime(3)  not null default current_timestamp(3),
  updated_at                  datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                  datetime(3)      null,
  deleted_by                  char(36)         null,
  deletion_reason             text             null,
  archived_at                 datetime(3)      null,
  purge_eligible_at           datetime(3)      null,
  legal_hold                  tinyint(1)   not null default 0,

  -- Partial-unique emulation. Fleets sell and re-acquire equipment; a VIN must not be burned by a delete.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_vin_key` varchar(17) generated always as (
    case when `deleted_at` is null then `vin_normalized` end
  ) stored,
  -- Partial-unique emulation. Unit numbers are reassigned routinely as equipment rotates out.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_unit_key` varchar(40) generated always as (
    case when `deleted_at` is null then `unit_number` end
  ) stored,
  primary key (id),
  unique key trucks_tenant_id_uq (tenant_id, id),
  -- Per-tenant VIN uniqueness: catches the O-vs-0 typo duplicate within one
  -- tenant while allowing the same truck to legitimately exist as two
  -- independent rows across two different dispatch companies.
  unique key `trucks_tenant_vin_uq` (`tenant_id`, `live_vin_key`),
  unique key `trucks_tenant_carrier_unit_uq` (`tenant_id`, `carrier_id`, `live_unit_key`),
  key trucks_tenant_idx (tenant_id),
  key trucks_carrier_idx (carrier_id),
  key trucks_status_idx (tenant_id, status),
  -- Drives the registration-expiration background sweep; do not lose this index.
  key trucks_registration_exp_idx (tenant_id, registration_expires_at),

  constraint chk_trucks_status check (status in (
    'pending_verification','active','out_of_service','archived'
  )),
  constraint chk_trucks_coi_verification_status check (coi_verification_status in (
    'not_started','pending','verified','mismatch','failed','manually_overridden','expired'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Trailers
-- ────────────────────────────────────────────────────────────────────────────
create table trailers (
  id                          char(36)     not null,
  tenant_id                   char(36)     not null,
  carrier_id                  char(36)     not null,
  unit_number                 varchar(40)  not null,
  vin                         varchar(17)  not null,
  vin_normalized               varchar(17)  not null,
  year                        int              null,
  make                        varchar(60)      null,
  model                       varchar(60)      null,
  equipment_type_id           char(36)         null,
  plate_number                varchar(20)      null,
  plate_state                 varchar(2)       null,

  -- Dimensions in inches; capacity in pounds. Imperial units throughout.
  length_inches                int              null,
  width_inches                 int              null,
  deck_height_inches           int              null,
  well_length_inches           int              null,
  capacity_pounds              int              null,
  axle_count                   int              null,
  axle_configuration           varchar(60)      null,
  removable_gooseneck          tinyint(1)   not null default 0,
  is_extendable                tinyint(1)   not null default 0,

  status                      varchar(30)  not null default 'pending_verification',
  registration_number         varchar(60)      null,
  registration_expires_at     datetime(3)      null,
  last_inspection_at          datetime(3)      null,
  next_inspection_due_at      datetime(3)      null,
  last_maintenance_at         datetime(3)      null,
  next_maintenance_due_at     datetime(3)      null,
  coi_verification_status     varchar(30)  not null default 'not_started',
  out_of_service_reason       text             null,
  notes                       text             null,

  created_at                  datetime(3)  not null default current_timestamp(3),
  updated_at                  datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                  datetime(3)      null,
  deleted_by                  char(36)         null,
  deletion_reason             text             null,
  archived_at                 datetime(3)      null,
  purge_eligible_at           datetime(3)      null,
  legal_hold                  tinyint(1)   not null default 0,

  -- Partial-unique emulation. Fleets sell and re-acquire equipment; a VIN must not be burned by a delete.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_vin_key` varchar(17) generated always as (
    case when `deleted_at` is null then `vin_normalized` end
  ) stored,
  -- Partial-unique emulation. Unit numbers are reassigned routinely as equipment rotates out.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_unit_key` varchar(40) generated always as (
    case when `deleted_at` is null then `unit_number` end
  ) stored,
  primary key (id),
  unique key trailers_tenant_id_uq (tenant_id, id),
  unique key `trailers_tenant_vin_uq` (`tenant_id`, `live_vin_key`),
  unique key `trailers_tenant_carrier_unit_uq` (`tenant_id`, `carrier_id`, `live_unit_key`),
  key trailers_tenant_idx (tenant_id),
  key trailers_carrier_idx (carrier_id),
  key trailers_status_idx (tenant_id, status),
  key trailers_type_idx (tenant_id, equipment_type_id),

  constraint chk_trailers_status check (status in (
    'pending_verification','active','out_of_service','archived'
  )),
  constraint chk_trailers_coi_verification_status check (coi_verification_status in (
    'not_started','pending','verified','mismatch','failed','manually_overridden','expired'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Equipment media
-- equipment_type is a polymorphic discriminator, not a foreign key: it says
-- which table equipment_id points into (trucks or trailers).
-- ────────────────────────────────────────────────────────────────────────────
create table equipment_media (
  id                    char(36)     not null,
  tenant_id             char(36)     not null,
  equipment_type        varchar(10)  not null, -- truck | trailer
  equipment_id          char(36)     not null,
  -- front | rear | driver_side | passenger_side | interior | detail | video
  -- (comment-only in the source, not a pgEnum type; no CHECK, matching that.)
  angle                 varchar(20)  not null,
  media_kind            varchar(10)  not null default 'photo', -- photo | video (comment-only, no CHECK)
  storage_key           text         not null,
  content_type          varchar(120) not null,
  byte_size             bigint       not null,
  sha256                char(64) charset ascii collate ascii_bin not null,
  caption               varchar(200)     null,
  sort_order            int          not null default 0,
  uploaded_by_user_id   char(36)         null,

  created_at            datetime(3)  not null default current_timestamp(3),
  updated_at            datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at            datetime(3)      null,
  deleted_by            char(36)         null,
  deletion_reason       text             null,
  archived_at           datetime(3)      null,
  purge_eligible_at     datetime(3)      null,
  legal_hold            tinyint(1)   not null default 0,

  primary key (id),
  unique key equipment_media_tenant_id_uq (tenant_id, id),
  key equipment_media_tenant_idx (tenant_id),
  key equipment_media_owner_idx (tenant_id, equipment_type, equipment_id),

  constraint chk_equipment_media_equipment_type check (equipment_type in ('truck','trailer'))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Equipment verifications (COI / VIN verification ledger)
-- Only ...timestamps is spread in the source (no soft-delete, no retention):
-- a verification attempt is a fact about a point in time, not an
-- operational record that gets archived or purged independently.
-- ────────────────────────────────────────────────────────────────────────────
create table equipment_verifications (
  id                        char(36)     not null,
  tenant_id                 char(36)     not null,
  equipment_type            varchar(10)  not null, -- truck | trailer
  equipment_id              char(36)     not null,
  carrier_id                char(36)     not null,
  -- COI the VINs were extracted from.
  coi_document_id           char(36)         null,
  coi_document_version_id   char(36)         null,
  status                    varchar(30)  not null default 'pending',
  extracted_vins            json         not null default (json_array()),
  matched_vin               varchar(17)      null,
  ocr_provider               varchar(40)      null,
  ocr_confidence             int              null,
  media_count                int          not null default 0,
  -- Explicit list of unmet gates, e.g. ['vin_not_on_coi','insufficient_media'].
  blocking_reasons           json         not null default (json_array()),
  overridden_by_user_id      char(36)         null,
  override_reason            text             null,
  overridden_at               datetime(3)      null,
  verified_at                 datetime(3)      null,

  created_at                 datetime(3)  not null default current_timestamp(3),
  updated_at                 datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),

  primary key (id),
  unique key equipment_verifications_tenant_id_uq (tenant_id, id),
  key equipment_verifications_tenant_idx (tenant_id),
  key equipment_verifications_equipment_idx (tenant_id, equipment_type, equipment_id),
  key equipment_verifications_carrier_idx (carrier_id),

  constraint chk_equipment_verifications_equipment_type check (equipment_type in ('truck','trailer')),
  constraint chk_equipment_verifications_status check (status in (
    'not_started','pending','verified','mismatch','failed','manually_overridden','expired'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Drivers
-- ────────────────────────────────────────────────────────────────────────────
create table drivers (
  id                            char(36)     not null,
  tenant_id                     char(36)     not null,
  -- Optional login. A driver record can exist before the person has an account.
  user_id                       char(36)         null,

  first_name                    varchar(100) not null,
  last_name                     varchar(100) not null,
  -- Calendar fact, not a point in time: `date`, not datetime(3). The
  -- application only ever renders an age from it.
  date_of_birth                 date             null,
  email                         varchar(255)     null,
  phone                         varchar(32)      null,
  preferred_locale               varchar(2)   not null default 'en',

  license_state                  varchar(2)       null,
  -- License number is encrypted at rest; only the last four are displayed.
  -- Never widen either column to plaintext.
  license_number_encrypted       text             null,
  license_number_last4           varchar(4)       null,
  -- Blind index (HMAC) so duplicates can be detected without decryption.
  -- ascii_bin (not ai_ci): an accent-insensitive collation would collapse
  -- two distinct hashes differing only in case.
  license_number_hash            char(64) charset ascii collate ascii_bin null,
  cdl_class                      varchar(4)       null,
  endorsements                   json         not null default (json_array()),
  restrictions                   json         not null default (json_array()),
  license_expires_at             datetime(3)      null,

  medical_card_expires_at        datetime(3)      null,

  status                         varchar(20)  not null default 'available',
  verification_status            varchar(30)  not null default 'not_started',
  verified_by_user_id            char(36)         null,
  verified_at                    datetime(3)      null,
  verification_notes             text             null,

  tracking_consent_granted_at    datetime(3)      null,
  sms_consent_granted_at         datetime(3)      null,

  notes                          text             null,

  created_at                     datetime(3)  not null default current_timestamp(3),
  updated_at                     datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                     datetime(3)      null,
  deleted_by                     char(36)         null,
  deletion_reason                text             null,
  archived_at                    datetime(3)      null,
  purge_eligible_at              datetime(3)      null,
  legal_hold                     tinyint(1)   not null default 0,

  -- Partial-unique emulation. Drivers leave and come back. Their CDL number must not be permanently taken.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_license_key` varchar(64) generated always as (
    case when `deleted_at` is null and `license_number_hash` is not null then `license_number_hash` end
  ) stored,
  primary key (id),
  unique key drivers_tenant_id_uq (tenant_id, id),
  key drivers_tenant_idx (tenant_id),
  key drivers_tenant_status_idx (tenant_id, status),
  key drivers_tenant_name_idx (tenant_id, last_name, first_name),
  -- Drives the license/medical-card expiration background sweeps; do not
  -- lose these indexes.
  key drivers_license_expiry_idx (tenant_id, license_expires_at),
  key drivers_medical_expiry_idx (tenant_id, medical_card_expires_at),
  -- Per-tenant blind-index uniqueness: the same license (by HMAC) can exist
  -- once per tenant; NULL hashes (no license on file yet) are never treated
  -- as duplicates of one another, in MySQL exactly as in Postgres.
  unique key `drivers_tenant_license_hash_uq` (`tenant_id`, `live_license_key`),
  key drivers_user_idx (user_id),

  constraint chk_drivers_preferred_locale check (preferred_locale in ('en','es')),
  constraint chk_drivers_status check (status in (
    'available','on_load','off_duty','inactive'
  )),
  constraint chk_drivers_verification_status check (verification_status in (
    'not_started','pending','verified','mismatch','failed','manually_overridden','expired'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Driver <-> carrier relationships
-- A driver may run for several carriers. The relationship — not the driver —
-- is what a carrier sees, and it always stays inside one tenant.
-- ────────────────────────────────────────────────────────────────────────────
create table driver_carrier_relationships (
  id                     char(36)     not null,
  tenant_id              char(36)     not null,
  driver_id              char(36)     not null,
  carrier_id             char(36)     not null,
  is_primary             tinyint(1)   not null default 0,
  start_date             datetime(3)  not null default current_timestamp(3),
  end_date               datetime(3)      null,
  approved_by_user_id    char(36)         null,
  approved_at            datetime(3)      null,

  created_at             datetime(3)  not null default current_timestamp(3),
  updated_at             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at             datetime(3)      null,
  deleted_by             char(36)         null,
  deletion_reason        text             null,

  primary key (id),
  unique key driver_carrier_relationships_tenant_id_uq (tenant_id, id),
  unique key driver_carrier_uq (tenant_id, driver_id, carrier_id, start_date),
  key driver_carrier_tenant_idx (tenant_id),
  key driver_carrier_driver_idx (driver_id),
  key driver_carrier_carrier_idx (carrier_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Customers
-- Customers are companies. They do not receive user accounts in this
-- release — the columns and relations here are shaped so a future customer
-- portal can be added without a migration of operational data.
-- ────────────────────────────────────────────────────────────────────────────
create table customers (
  id                             char(36)     not null,
  tenant_id                      char(36)     not null,
  company_name                   varchar(200) not null,
  -- Lowercased, punctuation-stripped name used for duplicate detection.
  company_name_normalized        varchar(200) not null,
  dot_number                     varchar(12)      null,
  mc_number                      varchar(12)      null,
  website                        varchar(255)     null,
  phone                          varchar(32)      null,
  phone_normalized               varchar(20)      null,
  email                          varchar(255)     null,
  email_normalized               varchar(255)     null,

  physical_line1                 varchar(200)     null,
  physical_line2                 varchar(200)     null,
  physical_city                  varchar(120)     null,
  physical_state                 varchar(2)       null,
  physical_postal_code           varchar(12)      null,
  physical_place_id              varchar(255)     null,

  billing_same_as_physical       tinyint(1)   not null default 1,
  billing_line1                  varchar(200)     null,
  billing_line2                  varchar(200)     null,
  billing_city                   varchar(120)     null,
  billing_state                  varchar(2)       null,
  billing_postal_code            varchar(12)      null,

  -- Tax ID is encrypted at rest; only the last four are displayed. Never
  -- widen either column to plaintext.
  tax_id_encrypted               text             null,
  tax_id_last4                   varchar(4)       null,

  credit_limit_cents             bigint           null,
  credit_approved                tinyint(1)   not null default 0,
  credit_notes                   text             null,
  payment_terms_days             int          not null default 30,

  uses_factoring                 tinyint(1)   not null default 0,
  factoring_company_name         varchar(200)     null,

  status                         varchar(20)  not null default 'active', -- active | on_hold | inactive (comment-only, no CHECK)
  notes                          text             null,

  -- Recorded when a user proceeded past a duplicate warning.
  duplicate_override_by_user_id  char(36)         null,
  duplicate_override_reason      text             null,

  created_at                     datetime(3)  not null default current_timestamp(3),
  updated_at                     datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                     datetime(3)      null,
  deleted_by                     char(36)         null,
  deletion_reason                text             null,
  archived_at                    datetime(3)      null,
  purge_eligible_at              datetime(3)      null,
  legal_hold                     tinyint(1)   not null default 0,

  primary key (id),
  unique key customers_tenant_id_uq (tenant_id, id),
  key customers_tenant_idx (tenant_id),
  -- The following five indexes back the three-tier duplicate detector
  -- (exact name, phone, email match) and MUST keep these exact names.
  key customers_tenant_name_idx (tenant_id, company_name_normalized),
  key customers_tenant_dot_idx (tenant_id, dot_number),
  key customers_tenant_mc_idx (tenant_id, mc_number),
  key customers_tenant_phone_idx (tenant_id, phone_normalized),
  key customers_tenant_email_idx (tenant_id, email_normalized),
  key customers_tenant_status_idx (tenant_id, status),

  constraint chk_customers_credit_limit_cents check (credit_limit_cents is null or credit_limit_cents >= 0)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Customer locations
-- ────────────────────────────────────────────────────────────────────────────
create table customer_locations (
  id             char(36)     not null,
  tenant_id      char(36)     not null,
  customer_id    char(36)     not null,
  name           varchar(200) not null,
  line1          varchar(200)     null,
  line2          varchar(200)     null,
  city           varchar(120)     null,
  state          varchar(2)       null,
  postal_code    varchar(12)      null,
  country        varchar(2)       null default 'US',
  latitude       text             null,
  longitude      text             null,
  place_id       varchar(255)     null,
  timezone       varchar(64)      null,
  phone          varchar(32)      null,
  hours          varchar(200)     null,
  instructions   text             null,
  is_primary     tinyint(1)   not null default 0,

  created_at     datetime(3)  not null default current_timestamp(3),
  updated_at     datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at     datetime(3)      null,
  deleted_by     char(36)         null,
  deletion_reason text            null,

  primary key (id),
  unique key customer_locations_tenant_id_uq (tenant_id, id),
  key customer_locations_tenant_idx (tenant_id),
  key customer_locations_customer_idx (customer_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Customer contacts
-- Exactly one primary contact per customer is enforced by the service layer
-- in the source, but this port also enforces it structurally: PostgreSQL's
-- partial unique index (`where is_primary = true and deleted_at is null`)
-- has no MySQL equivalent, so a generated column that is NULL whenever the
-- predicate is false stands in for it — MySQL never treats NULLs as
-- duplicates in a unique index, so only the true "one primary, not
-- soft-deleted" case ever collides. STORED (not VIRTUAL): this column feeds
-- a unique index that is checked on every write to this table, and a STORED
-- column avoids recomputing it on every one of those checks.
-- ────────────────────────────────────────────────────────────────────────────
create table customer_contacts (
  id                  char(36)     not null,
  tenant_id           char(36)     not null,
  customer_id         char(36)     not null,
  first_name          varchar(100) not null,
  last_name           varchar(100) not null,
  email               varchar(255)     null,
  phone               varchar(32)      null,
  phone_extension     varchar(10)      null,
  position            varchar(120)     null,
  is_primary          tinyint(1)   not null default 0,
  notes               text             null,

  created_at          datetime(3)  not null default current_timestamp(3),
  updated_at          datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at          datetime(3)      null,
  deleted_by          char(36)         null,
  deletion_reason     text             null,

  primary_contact_key char(36) as (
    case when is_primary = 1 and deleted_at is null then customer_id end
  ) stored,

  primary key (id),
  unique key customer_contacts_tenant_id_uq (tenant_id, id),
  key customer_contacts_tenant_idx (tenant_id),
  key customer_contacts_customer_idx (customer_id),
  -- At most one primary contact per customer, ignoring soft-deleted rows.
  unique key customer_contacts_primary_uq (primary_contact_key)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Customer contact <-> location join
-- ────────────────────────────────────────────────────────────────────────────
create table customer_contact_locations (
  id             char(36)    not null,
  tenant_id      char(36)    not null,
  contact_id     char(36)    not null,
  location_id    char(36)    not null,

  created_at     datetime(3) not null default current_timestamp(3),
  updated_at     datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at     datetime(3)     null,
  deleted_by     char(36)        null,
  deletion_reason text            null,

  primary key (id),
  unique key customer_contact_locations_tenant_id_uq (tenant_id, id),
  unique key customer_contact_locations_uq (contact_id, location_id),
  key customer_contact_locations_tenant_idx (tenant_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;
