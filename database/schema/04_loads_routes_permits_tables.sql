-- ============================================================================
-- Goliath Dispatch — Loads / Routes / Permits domain
-- Tables only. NO foreign keys here — see
-- 83_loads_routes_permits_foreign_keys.sql for the reason (several FKs point
-- at tables owned by other domains: tenants, users, carriers, documents,
-- document_versions, customers, customer_contacts, customer_locations,
-- drivers, trucks, trailers, equipment_types).
--
-- Conventions (see docs/mysql-port.md for the verified rationale):
--   * char(36) UUID primary keys.
--   * Every tenant-owned table also carries unique key <table>_tenant_id_uq
--     (tenant_id, id) so a child row can structurally reference (tenant_id, id)
--     of its parent.
--   * datetime(3) for every date/time column, never timestamp (2038 ceiling).
--     Appointment windows and permit expirations are routinely future-dated;
--     a 2039 delivery is normal data, not an edge case.
--   * Enums are varchar(n) + CHECK (col IN (...)); the PHP backed enum in
--     app/Enums/ is the application-side source of truth and must list the
--     exact same values (see docs/port-notes-loads-routes-permits.md for how
--     that agreement is guaranteed and verified).
--   * Money is signed bigint cents. CHECK (col >= 0) applies only where the
--     value cannot be negative by definition: loads.customer_charge_cents,
--     loads.carrier_gross_rate_cents, permits.cost_cents, escorts.cost_cents.
--   * Percentages are basis points (int) with CHECK (col BETWEEN 0 AND 10000).
--   * MySQL has no partial unique index. load_assignments needs three of
--     them (one truck, one trailer, one driver may be *actively* assigned to
--     a load at a time) — replaced by a STORED generated column that is NULL
--     unless the row is "live", plus a plain unique key over it. See the
--     comment on load_assignments below.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Loads
-- A load belongs to exactly one carrier and the link is immutable once
-- assigned (carrier_locked_at is set). That immutability rule — correction
-- requires cancelling or duplicating the load, never rewriting carrier_id —
-- is enforced in the application layer, not here. See
-- docs/port-notes-loads-routes-permits.md for why no trigger was added.
-- ────────────────────────────────────────────────────────────────────────────
create table loads (
  id                                  char(36)     not null,
  tenant_id                           char(36)     not null,
  -- Tenant-scoped human identifier, e.g. GD-1042.
  load_number                         varchar(40)  not null,
  customer_reference                  varchar(80)      null,
  po_number                           varchar(80)      null,

  customer_id                         char(36)     not null,
  customer_contact_id                 char(36)         null,
  carrier_id                          char(36)         null,
  carrier_locked_at                   datetime(3)      null,
  dispatcher_user_id                  char(36)         null,

  status                              varchar(30)  not null default 'draft',

  commodity                           varchar(200)     null,
  weight_pounds                       int              null,
  length_inches                       int              null,
  width_inches                        int              null,
  height_inches                       int              null,
  piece_count                         int              null,
  required_equipment_type_id          char(36)         null,
  is_oversize                         tinyint(1)   not null default 0,
  is_overweight                       tinyint(1)   not null default 0,
  axle_configuration                  varchar(60)      null,
  gross_vehicle_weight_pounds         int              null,

  -- Financials — every monetary column is integer cents.
  customer_charge_cents               bigint       not null default 0,
  carrier_gross_rate_cents            bigint       not null default 0,
  -- Percentages captured in basis points and snapshotted per load.
  carrier_dispatch_fee_bps            int          not null default 1000,
  dispatcher_commission_bps           int          not null default 2500,
  dispatcher_commission_basis         varchar(30)  not null default 'dispatch_fee_amount',

  miles                               int              null,
  deadhead_miles                      int              null,

  special_instructions                text             null,
  internal_notes                      text             null,

  -- Planning dates in UTC; display uses stop-local zones (see load_stops.timezone).
  planned_pickup_at                   datetime(3)      null,
  planned_delivery_at                 datetime(3)      null,
  actual_pickup_at                    datetime(3)      null,
  actual_delivery_at                  datetime(3)      null,
  pod_received_at                     datetime(3)      null,

  -- Compliance gates
  permit_ready_approved_by_user_id    char(36)         null,
  permit_ready_approved_at            datetime(3)      null,
  oversize_validated_by_user_id       char(36)         null,
  oversize_validated_at               datetime(3)      null,

  cancelled_at                        datetime(3)      null,
  cancellation_reason                 text             null,
  -- No FK: forward-pointing self-reference the source itself leaves
  -- unconstrained (no .references() call on duplicatedFromLoadId in load.ts).
  duplicated_from_load_id             char(36)         null,

  created_at                          datetime(3)  not null default current_timestamp(3),
  updated_at                          datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                          datetime(3)      null,
  deleted_by                          char(36)         null,
  deletion_reason                     text             null,
  archived_at                         datetime(3)      null,
  purge_eligible_at                   datetime(3)      null,
  legal_hold                          tinyint(1)   not null default 0,

  primary key (id),
  unique key loads_tenant_id_uq (tenant_id, id),
  unique key loads_tenant_number_uq (tenant_id, load_number),
  key loads_tenant_idx (tenant_id),
  key loads_tenant_status_idx (tenant_id, status),
  key loads_tenant_customer_idx (tenant_id, customer_id),
  key loads_tenant_carrier_idx (tenant_id, carrier_id),
  key loads_tenant_dispatcher_idx (tenant_id, dispatcher_user_id),
  -- Backs the calendar/board/timeline views. Do not lose these.
  key loads_tenant_pickup_idx (tenant_id, planned_pickup_at),
  key loads_tenant_delivery_idx (tenant_id, planned_delivery_at),
  key loads_tenant_reference_idx (tenant_id, customer_reference),
  key loads_oversize_idx (tenant_id, is_oversize),

  constraint chk_loads_status check (status in (
    'draft','available','assigned','dispatched','en_route_to_pickup','at_pickup',
    'in_transit','at_delivery','delivered','pod_received','invoiced','paid','cancelled'
  )),
  constraint chk_loads_dispatcher_commission_basis check (dispatcher_commission_basis in (
    'dispatch_fee_amount','carrier_gross_rate','commissionable_base'
  )),
  constraint chk_loads_customer_charge_cents check (customer_charge_cents >= 0),
  constraint chk_loads_carrier_gross_rate_cents check (carrier_gross_rate_cents >= 0),
  constraint chk_loads_carrier_dispatch_fee_bps check (carrier_dispatch_fee_bps between 0 and 10000),
  constraint chk_loads_dispatcher_commission_bps check (dispatcher_commission_bps between 0 and 10000)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Stops
-- ────────────────────────────────────────────────────────────────────────────
create table load_stops (
  id                     char(36)     not null,
  tenant_id              char(36)     not null,
  load_id                char(36)     not null,
  stop_type              varchar(10)  not null,
  sequence               int          not null,

  facility_name          varchar(200)     null,
  customer_location_id   char(36)         null,
  line1                  varchar(200)     null,
  line2                  varchar(200)     null,
  city                   varchar(120)     null,
  state                  varchar(2)       null,
  postal_code            varchar(12)      null,
  country                varchar(2)       null default 'US',
  latitude               text             null,
  longitude              text             null,
  place_id               varchar(255)     null,
  -- IANA zone of the facility — appointments display here first.
  timezone               varchar(64)  not null default 'America/New_York',

  contact_name           varchar(200)     null,
  contact_phone          varchar(32)      null,
  contact_email          varchar(255)     null,
  confirmation_number    varchar(80)      null,
  instructions           text             null,

  appointment_type       varchar(10)  not null default 'window',
  window_start           datetime(3)      null,
  window_end             datetime(3)      null,
  planned_arrival_at     datetime(3)      null,
  actual_arrival_at      datetime(3)      null,
  actual_departure_at    datetime(3)      null,
  detention_minutes      int              null,
  detention_notes        text             null,

  created_at             datetime(3)  not null default current_timestamp(3),
  updated_at             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at             datetime(3)      null,
  deleted_by             char(36)         null,
  deletion_reason        text             null,

  primary key (id),
  unique key load_stops_tenant_id_uq (tenant_id, id),
  -- Stop ordering integrity depends on this: two stops on the same load
  -- can never share a sequence number.
  unique key load_stops_load_sequence_uq (load_id, sequence),
  key load_stops_tenant_idx (tenant_id),
  key load_stops_load_idx (load_id),
  key load_stops_window_idx (tenant_id, window_start),
  key load_stops_state_idx (tenant_id, state),

  constraint chk_load_stops_stop_type check (stop_type in ('pickup','delivery')),
  constraint chk_load_stops_appointment_type check (appointment_type in ('exact','window','fcfs','open'))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Resource assignments
-- A load may use several trucks, trailers and drivers; one row per resource.
--
-- The source enforces "at most one *live* assignment of a given truck (or
-- trailer, or driver) to a given load" with three Postgres partial unique
-- indexes: unique(load_id, truck_id) where truck_id is not null and
-- unassigned_at is null (and the same shape for trailer_id / driver_id).
-- MySQL has no partial index. The replacement: a STORED generated column
-- that collapses to NULL whenever the row is not a "live" occupant of that
-- resource slot (resource absent, or already unassigned), plus a plain
-- unique key over (load_id, <key>) — MySQL never treats two NULLs in a
-- unique index as duplicates, so rows where the column is NULL are
-- unconstrained, exactly matching "the predicate excludes this row" in
-- Postgres. STORED, not VIRTUAL: this column backs a unique index that is
-- consulted on every assignment write.
--
-- This does NOT catch "same truck double-booked across two different
-- loads at overlapping times" — that scheduling-conflict detection has no
-- CHECK-with-subquery equivalent in either database and lives entirely in
-- the application layer, backed by tests (see docs/mysql-port.md, "Lo que
-- se pierde", point 1).
-- ────────────────────────────────────────────────────────────────────────────
create table load_assignments (
  id                     char(36)     not null,
  tenant_id              char(36)     not null,
  load_id                char(36)     not null,
  resource_type          varchar(10)  not null, -- truck|trailer|driver
  truck_id               char(36)         null,
  trailer_id             char(36)         null,
  driver_id              char(36)         null,
  is_primary             tinyint(1)   not null default 0,
  -- Window the resource is committed for — used by conflict detection.
  committed_from         datetime(3)      null,
  committed_to           datetime(3)      null,
  assigned_by_user_id    char(36)         null,
  unassigned_at          datetime(3)      null,
  unassigned_reason      text             null,
  -- Snapshot of the compliance evaluation at assignment time.
  compliance_snapshot    json             null,

  created_at             datetime(3)  not null default current_timestamp(3),
  updated_at             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at             datetime(3)      null,
  deleted_by             char(36)         null,
  deletion_reason        text             null,

  -- Generated columns backing the three partial-unique-index replacements.
  active_truck_key char(36) as (
    case when truck_id is not null and unassigned_at is null then truck_id end
  ) stored,
  active_trailer_key char(36) as (
    case when trailer_id is not null and unassigned_at is null then trailer_id end
  ) stored,
  active_driver_key char(36) as (
    case when driver_id is not null and unassigned_at is null then driver_id end
  ) stored,

  primary key (id),
  unique key load_assignments_tenant_id_uq (tenant_id, id),
  key load_assignments_tenant_idx (tenant_id),
  key load_assignments_load_idx (load_id),
  key load_assignments_truck_idx (tenant_id, truck_id, committed_from),
  key load_assignments_trailer_idx (tenant_id, trailer_id, committed_from),
  key load_assignments_driver_idx (tenant_id, driver_id, committed_from),
  unique key load_assignments_truck_uq (load_id, active_truck_key),
  unique key load_assignments_trailer_uq (load_id, active_trailer_key),
  unique key load_assignments_driver_uq (load_id, active_driver_key)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Status history — append-only. See
-- 94_loads_routes_permits_triggers.sql for the before update / before delete
-- guard that enforces it.
-- ────────────────────────────────────────────────────────────────────────────
create table load_status_history (
  id                 char(36)     not null,
  tenant_id          char(36)     not null,
  load_id            char(36)     not null,
  from_status        varchar(30)      null,
  to_status          varchar(30)  not null,
  actor_user_id      char(36)         null,
  -- user | tracking_provider | system_job | webhook — distinguishes a
  -- dispatcher's action from an automated tracking ingest in the audit trail.
  source             varchar(24)  not null default 'user',
  source_reference   varchar(120)     null,
  notes              text             null,
  ip_address         varchar(45)      null,
  user_agent         text             null,
  occurred_at        datetime(3)  not null default current_timestamp(3),

  created_at         datetime(3)  not null default current_timestamp(3),
  updated_at         datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),

  primary key (id),
  unique key load_status_history_tenant_id_uq (tenant_id, id),
  key load_status_history_tenant_idx (tenant_id),
  key load_status_history_load_idx (load_id, occurred_at),

  constraint chk_load_status_history_from_status check (from_status is null or from_status in (
    'draft','available','assigned','dispatched','en_route_to_pickup','at_pickup',
    'in_transit','at_delivery','delivered','pod_received','invoiced','paid','cancelled'
  )),
  constraint chk_load_status_history_to_status check (to_status in (
    'draft','available','assigned','dispatched','en_route_to_pickup','at_pickup',
    'in_transit','at_delivery','delivered','pod_received','invoiced','paid','cancelled'
  )),
  constraint chk_load_status_history_source check (source in (
    'user','tracking_provider','system_job','webhook'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Load documents & rate confirmation
-- ────────────────────────────────────────────────────────────────────────────
create table load_documents (
  id               char(36)     not null,
  tenant_id        char(36)     not null,
  load_id          char(36)     not null,
  document_id      char(36)     not null,
  document_type    varchar(30)  not null,
  stop_id          char(36)         null,

  created_at       datetime(3)  not null default current_timestamp(3),
  updated_at       datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at       datetime(3)      null,
  deleted_by       char(36)         null,
  deletion_reason  text             null,

  primary key (id),
  unique key load_documents_tenant_id_uq (tenant_id, id),
  unique key load_documents_uq (load_id, document_id),
  key load_documents_tenant_idx (tenant_id),
  key load_documents_load_type_idx (load_id, document_type),

  constraint chk_load_documents_document_type check (document_type in (
    'certificate_of_authority','certificate_of_insurance','w9','notice_of_assignment',
    'change_of_payee','carrier_agreement','other_onboarding',
    'truck_registration','trailer_registration','annual_inspection','equipment_photo','equipment_video',
    'cdl_front','cdl_back','medical_card','driver_other',
    'bol','pod','rate_confirmation','permit','escort_document','route_survey','receipt','invoice',
    'lumper_receipt','scale_ticket','other'
  ))
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table rate_confirmation_acceptances (
  id                     char(36)     not null,
  tenant_id              char(36)     not null,
  load_id                char(36)     not null,
  carrier_id             char(36)     not null,
  document_id            char(36)     not null,
  document_version_id    char(36)     not null,
  -- accepted | rejected | changes_requested
  decision               varchar(20)  not null,
  decision_reason        text             null,
  actor_user_id          char(36)     not null,
  -- SHA-256 of the exact PDF bytes the carrier saw.
  document_sha256        char(64) charset ascii collate ascii_bin not null,
  rated_amount_cents     bigint           null,
  ip_address             varchar(45)      null,
  user_agent             text             null,
  decided_at             datetime(3)  not null default current_timestamp(3),

  created_at             datetime(3)  not null default current_timestamp(3),
  updated_at             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  archived_at            datetime(3)      null,
  purge_eligible_at      datetime(3)      null,
  legal_hold             tinyint(1)   not null default 0,

  primary key (id),
  unique key rate_confirmation_acceptances_tenant_id_uq (tenant_id, id),
  key rate_confirmation_tenant_idx (tenant_id),
  key rate_confirmation_load_idx (load_id, decided_at)

  -- decision is a comment-only ('accepted'|'rejected'|'changes_requested')
  -- varchar in the source, not a pgEnum, so — matching the reference
  -- domain's treatment of the same pattern (owner_type, action, kind,
  -- event_type, ...) — no CHECK is added here.
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- Check calls
-- ────────────────────────────────────────────────────────────────────────────
create table check_calls (
  id                     char(36)     not null,
  tenant_id              char(36)     not null,
  load_id                char(36)     not null,
  scheduled_for          datetime(3)  not null,
  completed_at           datetime(3)      null,
  completed_by_user_id   char(36)         null,
  -- scheduled | provider_event | manual
  origin                 varchar(20)  not null default 'scheduled',
  notes                  text             null,
  location_summary       varchar(200)     null,

  created_at             datetime(3)  not null default current_timestamp(3),
  updated_at             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at             datetime(3)      null,
  deleted_by             char(36)         null,
  deletion_reason        text             null,

  primary key (id),
  unique key check_calls_tenant_id_uq (tenant_id, id),
  key check_calls_tenant_idx (tenant_id),
  key check_calls_load_idx (load_id, scheduled_for),
  key check_calls_due_idx (tenant_id, completed_at, scheduled_for)

  -- origin is a comment-only varchar in the source, not a pgEnum — no CHECK,
  -- same reasoning as decision above.
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ============================================================================
-- Routes
-- ============================================================================

create table routes (
  id                            char(36)     not null,
  tenant_id                     char(36)     not null,
  load_id                       char(36)     not null,
  provider                      varchar(40)  not null default 'mock',
  total_miles                   int              null,
  estimated_duration_minutes    int              null,
  estimated_toll_cents          bigint           null,
  -- Encoded polyline for map rendering.
  polyline                      text             null,
  legs                          json         not null default (JSON_ARRAY()),
  raw_reference                 text             null,
  calculated_at                 datetime(3)  not null default current_timestamp(3),
  is_current                    tinyint(1)   not null default 1,

  created_at                    datetime(3)  not null default current_timestamp(3),
  updated_at                    datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                    datetime(3)      null,
  deleted_by                    char(36)         null,
  deletion_reason                text             null,

  primary key (id),
  unique key routes_tenant_id_uq (tenant_id, id),
  key routes_tenant_idx (tenant_id),
  key routes_load_idx (load_id, calculated_at)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table route_states (
  id                char(36)    not null,
  tenant_id         char(36)    not null,
  route_id          char(36)    not null,
  state_code        varchar(2)  not null,
  sequence          int         not null,
  miles_in_state    int             null,

  created_at        datetime(3) not null default current_timestamp(3),
  updated_at        datetime(3) not null default current_timestamp(3) on update current_timestamp(3),

  primary key (id),
  unique key route_states_tenant_id_uq (tenant_id, id),
  unique key route_states_uq (route_id, state_code, sequence),
  key route_states_tenant_idx (tenant_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ============================================================================
-- Oversize rules & evaluation
-- ============================================================================

-- Per-state legal limits. Seeded with representative federal/state values and
-- fully tenant-editable — these drive guidance, never a legal determination.
create table oversize_rules (
  id                                     char(36)     not null,
  tenant_id                              char(36)     not null,
  state_code                             varchar(2)   not null,
  max_width_inches                       int          not null default 102,
  max_height_inches                      int          not null default 162,
  max_length_inches                      int          not null default 636,
  max_gross_weight_pounds                int          not null default 80000,
  max_axle_weight_pounds                 int          not null default 20000,
  -- Thresholds above which an escort is typically required.
  escort_width_threshold_inches          int              null,
  escort_height_threshold_inches         int              null,
  escort_length_threshold_inches         int              null,
  police_escort_width_threshold_inches   int              null,
  travel_restrictions                    json         not null default (JSON_OBJECT()),
  permit_required_above_legal            tinyint(1)   not null default 1,
  permit_authority_name                  varchar(200)     null,
  permit_authority_url                   varchar(255)     null,
  source_note                            text             null,
  last_reviewed_at                       datetime(3)      null,

  created_at                             datetime(3)  not null default current_timestamp(3),
  updated_at                             datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                             datetime(3)      null,
  deleted_by                             char(36)         null,
  deletion_reason                        text             null,

  primary key (id),
  unique key oversize_rules_tenant_id_uq (tenant_id, id),
  unique key oversize_rules_tenant_state_uq (tenant_id, state_code),
  key oversize_rules_tenant_idx (tenant_id)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table oversize_evaluations (
  id                                char(36)     not null,
  tenant_id                         char(36)     not null,
  load_id                           char(36)     not null,
  route_id                          char(36)         null,
  -- clear | oversize | overweight | oversize_overweight | insufficient_data
  outcome                           varchar(30)  not null,
  permit_likely_required            tinyint(1)   not null default 0,
  escort_likely_required            tinyint(1)   not null default 0,
  police_escort_likely_required     tinyint(1)   not null default 0,
  -- Inputs are snapshotted so a later dimension change cannot rewrite history.
  inputs                            json         not null default (JSON_OBJECT()),
  state_results                     json         not null default (JSON_ARRAY()),
  missing_data_warnings             json         not null default (JSON_ARRAY()),
  -- pending | validated | rejected — Admin sign-off, required before dispatch.
  human_validation_status           varchar(20)  not null default 'pending',
  validated_by_user_id              char(36)         null,
  validated_at                      datetime(3)      null,
  validation_notes                  text             null,
  evaluated_at                      datetime(3)  not null default current_timestamp(3),

  created_at                        datetime(3)  not null default current_timestamp(3),
  updated_at                        datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),

  primary key (id),
  unique key oversize_evaluations_tenant_id_uq (tenant_id, id),
  key oversize_evaluations_tenant_idx (tenant_id),
  key oversize_evaluations_load_idx (load_id, evaluated_at)

  -- outcome and human_validation_status are comment-only varchars in the
  -- source, not pgEnum types — no CHECK, same reasoning as decision/origin
  -- above.
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ============================================================================
-- Permits & escorts
-- ============================================================================

create table permits (
  id                            char(36)     not null,
  tenant_id                     char(36)     not null,
  load_id                       char(36)     not null,
  state_code                    varchar(2)   not null,
  permit_number                 varchar(80)      null,
  permit_type                   varchar(60)      null,
  issued_at                     datetime(3)      null,
  expires_at                    datetime(3)      null,
  cost_cents                    bigint       not null default 0,
  document_id                   char(36)         null,
  route_survey_document_id      char(36)         null,
  -- pending | requested | issued | expired | rejected | not_required
  status                        varchar(20)  not null default 'pending',
  notes                         text             null,

  created_at                    datetime(3)  not null default current_timestamp(3),
  updated_at                    datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at                    datetime(3)      null,
  deleted_by                    char(36)         null,
  deletion_reason                text             null,
  archived_at                   datetime(3)      null,
  purge_eligible_at             datetime(3)      null,
  legal_hold                    tinyint(1)   not null default 0,

  primary key (id),
  unique key permits_tenant_id_uq (tenant_id, id),
  key permits_tenant_idx (tenant_id),
  key permits_load_idx (load_id),
  -- Backs a background sweep for permits nearing/at expiration. Do not lose this index.
  key permits_expiry_idx (tenant_id, expires_at),
  unique key permits_load_state_number_uq (load_id, state_code, permit_number),

  -- status is a comment-only varchar in the source, not a pgEnum — no CHECK,
  -- same reasoning as decision/origin/outcome above.
  constraint chk_permits_cost_cents check (cost_cents >= 0)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table escorts (
  id                 char(36)     not null,
  tenant_id          char(36)     not null,
  load_id            char(36)     not null,
  -- pilot_car | police | height_pole | route_survey
  escort_type        varchar(20)  not null,
  state_code         varchar(2)       null,
  provider_name      varchar(200)     null,
  contact_name       varchar(200)     null,
  contact_phone      varchar(32)      null,
  contact_email      varchar(255)     null,
  agency_name        varchar(200)     null,
  scheduled_for      datetime(3)      null,
  cost_cents         bigint       not null default 0,
  document_id        char(36)         null,
  -- pending | confirmed | completed | cancelled | not_required
  status             varchar(20)  not null default 'pending',
  notes              text             null,

  created_at         datetime(3)  not null default current_timestamp(3),
  updated_at         datetime(3)  not null default current_timestamp(3) on update current_timestamp(3),
  deleted_at         datetime(3)      null,
  deleted_by         char(36)         null,
  deletion_reason    text             null,
  archived_at        datetime(3)      null,
  purge_eligible_at  datetime(3)      null,
  legal_hold         tinyint(1)   not null default 0,

  primary key (id),
  unique key escorts_tenant_id_uq (tenant_id, id),
  key escorts_tenant_idx (tenant_id),
  key escorts_load_idx (load_id),

  -- escort_type and status are comment-only varchars in the source, not
  -- pgEnum types — no CHECK, same reasoning as decision/origin/outcome above.
  constraint chk_escorts_cost_cents check (cost_cents >= 0)
) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;
