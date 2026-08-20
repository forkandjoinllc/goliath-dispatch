-- ────────────────────────────────────────────────────────────────────────────
-- Tenancy & Auth domain — tables only.
--
-- Ported from src/db/schema/{tenant,auth,platform}.ts (PostgreSQL/Drizzle).
-- Per docs/mysql-port.md: NO foreign keys here. Columns, keys, ordinary
-- indexes, CHECK constraints and generated columns only. Foreign keys live in
-- 80_tenancy_auth_foreign_keys.sql, triggers in 91_tenancy_auth_triggers.sql.
--
-- Enum CHECK lists below were generated mechanically from
-- src/db/schema/_shared.ts (see docs/port-notes-tenancy-auth.md for how) and
-- must match app/Enums/*.php exactly, case for case.
--
-- Columns whose Postgres source has no pgEnum type — only a comment
-- documenting the intended values (e.g. `status varchar ... // new|contacted|...`)
-- — are ported as plain varchar with NO CHECK constraint, exactly mirroring
-- the fact that Postgres itself does not enforce them either.
-- ────────────────────────────────────────────────────────────────────────────

-- ════════════════════════════════════════════════════════════════════════
-- tenant.ts
-- ════════════════════════════════════════════════════════════════════════

-- ── Tenants ─────────────────────────────────────────────────────────────
create table `tenants` (
  `id` char(36) not null,
  `slug` varchar(63) not null,
  `legal_name` varchar(200) not null,
  `display_name` varchar(200) not null,
  `status` varchar(20) not null default 'provisioning',
  `custom_domain` varchar(255) null,
  `custom_domain_verified_at` datetime(3) null,
  `default_locale` varchar(5) not null default 'en',
  `default_timezone` varchar(64) not null default 'America/New_York',
  `suspended_at` datetime(3) null,
  `suspension_reason` text null,
  `provisioned_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  `deleted_at` datetime(3) null,
  `deleted_by` char(36) null,
  `deletion_reason` text null,
  -- Partial-unique emulation. A cancelled tenant's slug returns to the pool.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_slug_key` varchar(63) generated always as (
    case when `deleted_at` is null then `slug` end
  ) stored,
  -- Partial-unique emulation. A cancelled tenant's custom domain returns to the pool.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_custom_domain_key` varchar(255) generated always as (
    case when `deleted_at` is null and `custom_domain` is not null then `custom_domain` end
  ) stored,
  primary key (`id`),
  unique key `tenants_slug_uq` (`live_slug_key`),
  unique key `tenants_custom_domain_uq` (`live_custom_domain_key`),
  key `tenants_status_idx` (`status`),
  constraint `tenants_status_chk` check (`status` in ('provisioning', 'trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  constraint `tenants_default_locale_chk` check (`default_locale` in ('en', 'es'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Branding ────────────────────────────────────────────────────────────
create table `tenant_branding` (
  `id` char(36) not null,
  `tenant_id` char(36) not null,
  `logo_storage_key` text null,
  `logo_dark_storage_key` text null,
  `favicon_storage_key` text null,
  `primary_color` varchar(9) not null default '#062B5C',
  `accent_color` varchar(9) not null default '#FF5A00',
  `neutral_color` varchar(9) not null default '#9B9B9B',
  `surface_color` varchar(9) not null default '#FFFFFF',
  `ink_color` varchar(9) not null default '#111827',
  `heading_font` varchar(80) not null default 'Roboto Condensed',
  `body_font` varchar(80) not null default 'Inter',
  `email_header_html` text null,
  `email_footer_html` text null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  unique key `tenant_branding_tenant_uq` (`tenant_id`),
  unique key `tenant_branding_tenant_id_uq` (`tenant_id`, `id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Settings ────────────────────────────────────────────────────────────
create table `tenant_settings` (
  `id` char(36) not null,
  `tenant_id` char(36) not null,
  -- Public contact information (rendered on the marketing site)
  `contact_phone` varchar(32) null,
  `contact_email` varchar(255) null,
  `support_email` varchar(255) null,
  `address_line1` varchar(200) null,
  `address_line2` varchar(200) null,
  `address_city` varchar(120) null,
  `address_state` varchar(2) null,
  `address_postal_code` varchar(12) null,
  `address_country` varchar(2) null default 'US',
  `business_hours` json null,
  `social_links` json null,
  -- Operational policy
  `document_expiration_warning_days` int not null default 30,
  `fmcsa_reverification_days` int not null default 7,
  -- Default OFF. When false only Admin may assign trucks/trailers/drivers to loads.
  `allow_dispatcher_resource_assignment` tinyint(1) not null default 0,
  `require_oversize_admin_validation` tinyint(1) not null default 1,
  `load_number_prefix` varchar(12) not null default 'GD',
  `load_number_next_sequence` int not null default 1000,
  `invoice_number_prefix` varchar(12) not null default 'INV',
  `invoice_number_next_sequence` int not null default 1000,
  `default_payment_terms_days` int not null default 30,
  -- Financial policy
  `default_carrier_dispatch_fee_bps` int not null default 1000,
  `default_dispatcher_commission_bps` int not null default 2500,
  `dispatcher_commission_basis` varchar(30) not null default 'dispatch_fee_amount',
  -- Retention policy (months / years)
  `operational_active_months` int not null default 24,
  `operational_purge_years_after_archive` int not null default 5,
  `financial_retention_years` int not null default 7,
  -- Public tracking
  `public_tracking_enabled` tinyint(1) not null default 1,
  `public_tracking_token_ttl_hours` int not null default 72,
  -- Legal copy shown in the e-signature ceremony (tenant-editable, per locale)
  `signature_consent_copy` json null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  unique key `tenant_settings_tenant_uq` (`tenant_id`),
  unique key `tenant_settings_tenant_id_uq` (`tenant_id`, `id`),
  constraint `tenant_settings_commission_basis_chk` check (`dispatcher_commission_basis` in ('dispatch_fee_amount', 'carrier_gross_rate', 'commissionable_base')),
  constraint `tenant_settings_carrier_dispatch_fee_bps_range` check (`default_carrier_dispatch_fee_bps` between 0 and 10000),
  constraint `tenant_settings_dispatcher_commission_bps_range` check (`default_dispatcher_commission_bps` between 0 and 10000)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── SaaS plans & subscriptions ──────────────────────────────────────────
create table `saas_plans` (
  `id` char(36) not null,
  `code` varchar(40) not null,
  `name_en` varchar(120) not null,
  `name_es` varchar(120) not null,
  `description_en` text null,
  `description_es` text null,
  -- Money is ALWAYS integer cents. Never a float, never a numeric string in app logic.
  `monthly_price_cents` bigint not null,
  `stripe_price_id` varchar(255) null,
  `stripe_product_id` varchar(255) null,
  `trial_days` int not null default 14,
  `max_users` int null,
  `max_carriers` int null,
  `max_loads_per_month` int null,
  `features` json not null default (json_array()),
  `is_public` tinyint(1) not null default 1,
  `sort_order` int not null default 0,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  `deleted_at` datetime(3) null,
  `deleted_by` char(36) null,
  `deletion_reason` text null,
  primary key (`id`),
  unique key `saas_plans_code_uq` (`code`),
  constraint `saas_plans_monthly_price_cents_nonneg` check (`monthly_price_cents` >= 0)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table `tenant_subscriptions` (
  `id` char(36) not null,
  `tenant_id` char(36) not null,
  `plan_id` char(36) not null,
  `status` varchar(20) not null default 'trialing',
  `stripe_customer_id` varchar(255) null,
  `stripe_subscription_id` varchar(255) null,
  `current_period_start` datetime(3) null,
  `current_period_end` datetime(3) null,
  `trial_ends_at` datetime(3) null,
  `cancel_at_period_end` tinyint(1) not null default 0,
  `cancelled_at` datetime(3) null,
  `past_due_since` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  key `tenant_subscriptions_tenant_idx` (`tenant_id`),
  unique key `tenant_subscriptions_stripe_sub_uq` (`stripe_subscription_id`),
  key `tenant_subscriptions_status_idx` (`status`),
  unique key `tenant_subscriptions_tenant_id_uq` (`tenant_id`, `id`),
  constraint `tenant_subscriptions_status_chk` check (`status` in ('trialing', 'active', 'past_due', 'suspended', 'cancelled', 'incomplete'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Configurable tenant taxonomies ──────────────────────────────────────
create table `equipment_types` (
  `id` char(36) not null,
  `tenant_id` char(36) not null,
  `code` varchar(40) not null,
  `label_en` varchar(120) not null,
  `label_es` varchar(120) not null,
  `category` varchar(20) not null default 'trailer',
  `is_system` tinyint(1) not null default 0,
  `supports_rgn` tinyint(1) not null default 0,
  `sort_order` int not null default 0,
  `active` tinyint(1) not null default 1,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  `deleted_at` datetime(3) null,
  `deleted_by` char(36) null,
  `deletion_reason` text null,
  -- Partial-unique emulation. Codes are user-chosen labels; deleting one must free the code.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_code_key` varchar(40) generated always as (
    case when `deleted_at` is null then `code` end
  ) stored,
  primary key (`id`),
  unique key `equipment_types_tenant_code_uq` (`tenant_id`, `live_code_key`),
  key `equipment_types_tenant_idx` (`tenant_id`),
  unique key `equipment_types_tenant_id_uq` (`tenant_id`, `id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ════════════════════════════════════════════════════════════════════════
-- auth.ts
-- ════════════════════════════════════════════════════════════════════════

-- ── Users ───────────────────────────────────────────────────────────────
-- A user is global (one login, one email) and gains capabilities exclusively
-- through UserTenantMembership rows. There is no tenant-level column here on
-- purpose: cross-tenant identity is expressed by memberships, never by copies.
create table `users` (
  `id` char(36) not null,
  `email` varchar(255) not null,
  `email_normalized` varchar(255) not null,
  -- `password`, not `password_hash`: Laravel's Authenticatable contract and
  -- Fortify read this column by name. Nullable because SSO-only and invited
  -- users exist before they ever set one.
  `password` varchar(255) null,
  `remember_token` varchar(100) null,
  `first_name` varchar(100) not null,
  `last_name` varchar(100) not null,
  `phone` varchar(32) null,
  `locale` varchar(5) not null default 'en',
  `timezone` varchar(64) not null default 'America/New_York',
  `avatar_storage_key` text null,
  `status` varchar(30) not null default 'pending_verification',
  `email_verified_at` datetime(3) null,
  `is_platform_super_admin` tinyint(1) not null default 0,
  `last_login_at` datetime(3) null,
  `last_login_ip` varchar(45) null,
  `failed_login_attempts` int not null default 0,
  `locked_until` datetime(3) null,
  `password_changed_at` datetime(3) null,
  `must_change_password` tinyint(1) not null default 0,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  `deleted_at` datetime(3) null,
  `deleted_by` char(36) null,
  `deletion_reason` text null,
  -- Partial-unique emulation. A deleted user's address must be usable again — otherwise an offboarded
  -- employee's email is burned across the whole platform, forever.
  -- NULL for soft-deleted rows, and MySQL unique indexes ignore NULLs —
  -- so live rows are unique while deleted ones drop out entirely.
  `live_email_key` varchar(255) generated always as (
    case when `deleted_at` is null then `email_normalized` end
  ) stored,
  primary key (`id`),
  unique key `users_email_normalized_uq` (`live_email_key`),
  key `users_status_idx` (`status`),
  key `users_platform_admin_idx` (`is_platform_super_admin`),
  constraint `users_locale_chk` check (`locale` in ('en', 'es')),
  constraint `users_status_chk` check (`status` in ('invited', 'pending_verification', 'active', 'suspended', 'deactivated'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Memberships ─────────────────────────────────────────────────────────
create table `user_tenant_memberships` (
  `id` char(36) not null,
  `tenant_id` char(36) not null,
  `user_id` char(36) not null,
  `role` varchar(30) not null,
  `status` varchar(30) not null default 'active',
  -- Set for role='carrier' / 'driver' — links the membership to its carrier org.
  -- Owned by another domain's `carriers` table; no FK here by design (see
  -- docs/port-notes-tenancy-auth.md — this is the cross-domain FK example).
  `carrier_id` char(36) null,
  -- Set for role='driver' — links the membership to the driver record.
  -- Owned by another domain's `drivers` table; no FK here for the same reason.
  `driver_id` char(36) null,
  `is_primary_contact` tinyint(1) not null default 0,
  `invited_by_user_id` char(36) null,
  `invited_at` datetime(3) null,
  `accepted_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  `deleted_at` datetime(3) null,
  `deleted_by` char(36) null,
  `deletion_reason` text null,
  primary key (`id`),
  unique key `memberships_tenant_user_role_uq` (`tenant_id`, `user_id`, `role`),
  key `memberships_tenant_idx` (`tenant_id`),
  key `memberships_user_idx` (`user_id`),
  key `memberships_tenant_role_idx` (`tenant_id`, `role`),
  key `memberships_carrier_idx` (`carrier_id`),
  unique key `user_tenant_memberships_tenant_id_uq` (`tenant_id`, `id`),
  constraint `user_tenant_memberships_role_chk` check (`role` in ('platform_super_admin', 'admin', 'accounting', 'dispatcher', 'carrier', 'driver')),
  constraint `user_tenant_memberships_status_chk` check (`status` in ('invited', 'pending_verification', 'active', 'suspended', 'deactivated'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Roles & permissions (data-driven, not string checks in components) ──
create table `permissions` (
  `id` char(36) not null,
  -- Canonical `resource:action` key, e.g. `load:assign_resources`.
  `key` varchar(120) not null,
  `resource` varchar(60) not null,
  `action` varchar(60) not null,
  `description_en` text not null,
  `description_es` text not null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  unique key `permissions_key_uq` (`key`),
  key `permissions_resource_idx` (`resource`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table `role_permissions` (
  `id` char(36) not null,
  `role` varchar(30) not null,
  `permission_id` char(36) not null,
  -- Assignment scope the grant is limited to.
  `scope` varchar(20) not null default 'tenant', -- platform|tenant|assigned|own
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  unique key `role_permissions_uq` (`role`, `permission_id`),
  constraint `role_permissions_role_chk` check (`role` in ('platform_super_admin', 'admin', 'accounting', 'dispatcher', 'carrier', 'driver'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table `user_permission_overrides` (
  `id` char(36) not null,
  `tenant_id` char(36) not null,
  `user_id` char(36) not null,
  `permission_id` char(36) not null,
  `effect` varchar(8) not null, -- grant | deny
  `scope` varchar(20) not null default 'tenant',
  `reason` text not null,
  `granted_by_user_id` char(36) null,
  `expires_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  `deleted_at` datetime(3) null,
  `deleted_by` char(36) null,
  `deletion_reason` text null,
  primary key (`id`),
  unique key `user_permission_overrides_uq` (`tenant_id`, `user_id`, `permission_id`),
  key `user_permission_overrides_tenant_user_idx` (`tenant_id`, `user_id`),
  unique key `user_permission_overrides_tenant_id_uq` (`tenant_id`, `id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Sessions, MFA, tokens ───────────────────────────────────────────────
--
-- `sessions` follows LARAVEL'S native database-session shape, not the shape the
-- Postgres source used. The port originally carried its own session table
-- (opaque token + sha256 `token_hash`), but Laravel's session driver owns this
-- table name and writes to it on every request. Keeping both would have meant
-- two parallel session stores with no single authority over `active_tenant_id`
-- — so Laravel's shape wins and the four columns the domain actually needs are
-- appended to it.
--
-- Tradeoff, stated plainly: Laravel stores the session id here in the clear
-- rather than hashed. The protection is the encrypted `laravel_session` cookie
-- (APP_KEY / AES-256-CBC), which is the framework's standard model. A DB read
-- alone still yields a usable session id, which the hashed design prevented.
-- Mitigation: `revoked_at` is checked on every authenticated request (see the
-- session guard middleware), so revocation is immediate rather than waiting on
-- expiry.
--
-- `id` is varchar(255) because Laravel mints a 40-char random string, not a
-- UUID; `impersonation_sessions.session_id` matches that width for its FK.
-- `last_activity` is a unix-seconds int, also Laravel's convention — it is the
-- column the session GC sweeps on, and the driver writes it directly.
create table `sessions` (
  `id` varchar(255) not null,
  `user_id` char(36) null,
  `ip_address` varchar(45) null,
  `user_agent` text null,
  `payload` longtext not null,
  `last_activity` int not null,
  -- ── Domain columns beyond Laravel's defaults ──────────────────────────
  -- Which tenant this session is currently acting as. A user with memberships
  -- in several tenants has ONE session and switches `active_tenant_id`; it is
  -- read on every request to scope the tenant global scope, so it lives here
  -- rather than inside the serialized `payload` blob (which is opaque to SQL
  -- and cannot be joined, indexed, or audited).
  `active_tenant_id` char(36) null,
  -- Null until the second factor is satisfied for THIS session. Step-up auth
  -- re-clears it; it is not a property of the user.
  `mfa_satisfied_at` datetime(3) null,
  `revoked_at` datetime(3) null,
  `revoked_reason` varchar(120) null,
  primary key (`id`),
  key `sessions_user_idx` (`user_id`),
  key `sessions_last_activity_idx` (`last_activity`),
  key `sessions_active_tenant_idx` (`active_tenant_id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- Laravel's password broker table. `verification_tokens` (below) covers a
-- superset of flows — email verification, invitations, carrier portal links —
-- but Fortify's ResetPassword path goes through the broker, which expects
-- exactly this table and column names. Cheaper to provide it than to swap the
-- broker out.
create table `password_reset_tokens` (
  `email` varchar(255) not null,
  `token` varchar(255) not null,
  `created_at` datetime(3) null,
  primary key (`email`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table `mfa_configurations` (
  `id` char(36) not null,
  `user_id` char(36) not null,
  `method` varchar(20) not null default 'totp',
  -- Encrypted TOTP secret — never stored in the clear.
  `secret_encrypted` text not null,
  -- Hashed single-use recovery codes.
  `recovery_code_hashes` json not null default (json_array()),
  `confirmed_at` datetime(3) null,
  `last_used_at` datetime(3) null,
  `failed_attempts` int not null default 0,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  `deleted_at` datetime(3) null,
  `deleted_by` char(36) null,
  `deletion_reason` text null,
  primary key (`id`),
  unique key `mfa_configurations_user_method_uq` (`user_id`, `method`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table `verification_tokens` (
  `id` char(36) not null,
  `user_id` char(36) null,
  `tenant_id` char(36) null,
  `purpose` varchar(40) not null, -- email_verification|password_reset|invitation
  `token_hash` char(64) charset ascii collate ascii_bin not null,
  `email` varchar(255) null,
  `payload` json null,
  `expires_at` datetime(3) not null,
  `consumed_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  unique key `verification_tokens_hash_uq` (`token_hash`),
  key `verification_tokens_user_purpose_idx` (`user_id`, `purpose`),
  key `verification_tokens_expires_idx` (`expires_at`),
  unique key `verification_tokens_tenant_id_uq` (`tenant_id`, `id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Consent ─────────────────────────────────────────────────────────────
create table `consent_records` (
  `id` char(36) not null,
  `tenant_id` char(36) null,
  `user_id` char(36) null,
  -- Present when consent is captured before a user account exists (public signup).
  `subject_email` varchar(255) null,
  `consent_type` varchar(30) not null,
  `policy_version` varchar(40) not null,
  `granted` tinyint(1) not null default 1,
  `locale` varchar(5) not null default 'en',
  `ip_address` varchar(45) null,
  `user_agent` text null,
  `revoked_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  key `consent_records_user_type_idx` (`user_id`, `consent_type`),
  key `consent_records_tenant_idx` (`tenant_id`),
  unique key `consent_records_tenant_id_uq` (`tenant_id`, `id`),
  constraint `consent_records_consent_type_chk` check (`consent_type` in ('privacy_policy', 'terms_and_conditions', 'electronic_signature', 'sms', 'tracking_location')),
  constraint `consent_records_locale_chk` check (`locale` in ('en', 'es'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Impersonation ───────────────────────────────────────────────────────
create table `impersonation_sessions` (
  `id` char(36) not null,
  `actor_user_id` char(36) not null,
  `target_user_id` char(36) not null,
  `tenant_id` char(36) not null,
  `reason` text not null,
  -- varchar(255), not char(36): matches Laravel's session id width. See the
  -- `sessions` note above.
  `session_id` varchar(255) null,
  `ip_address` varchar(45) null,
  `user_agent` text null,
  `started_at` datetime(3) not null default current_timestamp(3),
  `ended_at` datetime(3) null,
  `expires_at` datetime(3) not null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  key `impersonation_actor_idx` (`actor_user_id`),
  key `impersonation_target_idx` (`target_user_id`),
  key `impersonation_tenant_idx` (`tenant_id`),
  unique key `impersonation_sessions_tenant_id_uq` (`tenant_id`, `id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Login attempt ledger (brute-force protection + audit) ────────────────
create table `login_attempts` (
  `id` char(36) not null,
  `email_normalized` varchar(255) not null,
  `ip_address` varchar(45) null,
  `successful` tinyint(1) not null,
  `failure_reason` varchar(60) null,
  `user_agent` text null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  key `login_attempts_email_created_idx` (`email_normalized`, `created_at`),
  key `login_attempts_ip_created_idx` (`ip_address`, `created_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Rate limiting (durable driver) ────────────────────────────────────────
create table `rate_limit_buckets` (
  `id` char(36) not null,
  `bucket_key` varchar(255) not null,
  `window_start` datetime(3) not null,
  `count` int not null default 0,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  unique key `rate_limit_buckets_key_window_uq` (`bucket_key`, `window_start`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ════════════════════════════════════════════════════════════════════════
-- platform.ts
-- ════════════════════════════════════════════════════════════════════════

-- ── Marketing capture ───────────────────────────────────────────────────
create table `leads` (
  `id` char(36) not null,
  -- Null for platform-level leads captured on the SaaS marketing site.
  `tenant_id` char(36) null,
  `first_name` varchar(100) not null,
  `last_name` varchar(100) not null,
  `email` varchar(255) not null,
  `phone` varchar(32) null,
  `company_name` varchar(200) null,
  `dot_number` varchar(12) null,
  `mc_number` varchar(12) null,
  `message` text null,
  `locale` varchar(5) not null default 'en',
  -- contact_form | carrier_signup | quote_request | resources
  `source` varchar(40) not null default 'contact_form',
  `source_path` varchar(255) null,
  `utm` json null,
  -- new | contacted | qualified | converted | disqualified
  `status` varchar(20) not null default 'new',
  `assigned_to_user_id` char(36) null,
  `ip_address` varchar(45) null,
  `user_agent` text null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  `deleted_at` datetime(3) null,
  `deleted_by` char(36) null,
  `deletion_reason` text null,
  -- Set when the record moves out of the active operational window.
  `archived_at` datetime(3) null,
  -- Earliest moment the record may be permanently destroyed.
  `purge_eligible_at` datetime(3) null,
  -- True while any LegalHold covers this record; blocks archival + purge.
  `legal_hold` tinyint(1) not null default 0,
  primary key (`id`),
  key `leads_tenant_idx` (`tenant_id`),
  key `leads_status_idx` (`tenant_id`, `status`),
  key `leads_created_idx` (`created_at`),
  key `leads_email_idx` (`email`),
  unique key `leads_tenant_id_uq` (`tenant_id`, `id`),
  constraint `leads_locale_chk` check (`locale` in ('en', 'es'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table `quote_requests` (
  `id` char(36) not null,
  `tenant_id` char(36) null,
  `lead_id` char(36) null,
  `contact_name` varchar(200) not null,
  `email` varchar(255) not null,
  `phone` varchar(32) null,
  `company_name` varchar(200) null,
  `commodity` varchar(200) null,
  `weight_pounds` int null,
  `length_inches` int null,
  `width_inches` int null,
  `height_inches` int null,
  `origin_city` varchar(120) null,
  `origin_state` varchar(2) null,
  `destination_city` varchar(120) null,
  `destination_state` varchar(2) null,
  `ready_date` datetime(3) null,
  `equipment_preference` varchar(80) null,
  `is_oversize_suspected` tinyint(1) not null default 0,
  `notes` text null,
  `locale` varchar(5) not null default 'en',
  `status` varchar(20) not null default 'new',
  `ip_address` varchar(45) null,
  `user_agent` text null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  `deleted_at` datetime(3) null,
  `deleted_by` char(36) null,
  `deletion_reason` text null,
  `archived_at` datetime(3) null,
  `purge_eligible_at` datetime(3) null,
  `legal_hold` tinyint(1) not null default 0,
  primary key (`id`),
  key `quote_requests_tenant_idx` (`tenant_id`),
  key `quote_requests_status_idx` (`tenant_id`, `status`),
  key `quote_requests_created_idx` (`created_at`),
  unique key `quote_requests_tenant_id_uq` (`tenant_id`, `id`),
  constraint `quote_requests_locale_chk` check (`locale` in ('en', 'es'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Audit ───────────────────────────────────────────────────────────────
-- Append-only. The application never issues UPDATE or DELETE against this
-- table; see 91_tenancy_auth_triggers.sql for the enforcing triggers.
create table `audit_events` (
  `id` char(36) not null,
  `tenant_id` char(36) null,
  -- The account that authenticated.
  `actor_user_id` char(36) null,
  `actor_email` varchar(255) null,
  `actor_role` varchar(40) null,
  -- During impersonation: whose authority the action ran under.
  `effective_user_id` char(36) null,
  -- No FK in the source (uuid column without .references()); ported as-is.
  `impersonation_session_id` char(36) null,
  `action` varchar(40) not null,
  `entity_type` varchar(60) null,
  `entity_id` char(36) null,
  `entity_label` varchar(200) null,
  -- Redacted field-level diff; sensitive values are never stored here.
  `before_summary` json null,
  `after_summary` json null,
  -- Required for overrides, impersonation, deletions and legal holds.
  `reason` text null,
  `ip_address` varchar(45) null,
  `user_agent` text null,
  `request_id` varchar(64) null,
  `occurred_at` datetime(3) not null default current_timestamp(3),
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  key `audit_events_tenant_idx` (`tenant_id`, `occurred_at`),
  key `audit_events_actor_idx` (`actor_user_id`, `occurred_at`),
  key `audit_events_action_idx` (`tenant_id`, `action`, `occurred_at`),
  key `audit_events_entity_idx` (`tenant_id`, `entity_type`, `entity_id`),
  key `audit_events_request_idx` (`request_id`),
  unique key `audit_events_tenant_id_uq` (`tenant_id`, `id`),
  constraint `audit_events_action_chk` check (`action` in ('auth.login', 'auth.login_failed', 'auth.logout', 'auth.password_reset_requested', 'auth.password_reset_completed', 'auth.email_verified', 'auth.mfa_enrolled', 'auth.mfa_challenge_failed', 'auth.session_revoked', 'auth.account_locked', 'impersonation.started', 'impersonation.ended', 'permission.changed', 'role.changed', 'tenant.created', 'tenant.updated', 'tenant.suspended', 'tenant.reactivated', 'tenant.accessed', 'document.viewed', 'document.downloaded', 'document.uploaded', 'document.approved', 'document.rejected', 'document.deleted', 'verification.override', 'onboarding.status_changed', 'load.created', 'load.status_changed', 'load.assignment_changed', 'load.cancelled', 'load.duplicated', 'financial.changed', 'expense.approved', 'expense.rejected', 'invoice.created', 'invoice.sent', 'invoice.status_changed', 'payment.recorded', 'payment.failed', 'payment.refunded', 'signature.requested', 'signature.viewed', 'signature.signed', 'signature.declined', 'signature.voided', 'export.created', 'export.downloaded', 'retention.archived', 'retention.purged', 'legal_hold.applied', 'legal_hold.released', 'settings.updated', 'integration.updated', 'tracking.consent_changed', 'security.rate_limited'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Exports ─────────────────────────────────────────────────────────────
create table `export_jobs` (
  `id` char(36) not null,
  `tenant_id` char(36) not null,
  `requested_by_user_id` char(36) not null,
  `report_key` varchar(60) not null,
  `format` varchar(10) not null, -- csv | xlsx | pdf
  -- Filters are stored so the export can be reproduced and audited.
  `filters` json not null default (json_object()),
  -- Permission scope applied at generation time; exports never widen access.
  `scope_snapshot` json null,
  `status` varchar(20) not null default 'queued',
  `row_count` int null,
  `storage_key` text null,
  `error_message` text null,
  `started_at` datetime(3) null,
  `completed_at` datetime(3) null,
  `downloaded_at` datetime(3) null,
  `expires_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  `deleted_at` datetime(3) null,
  `deleted_by` char(36) null,
  `deletion_reason` text null,
  `archived_at` datetime(3) null,
  `purge_eligible_at` datetime(3) null,
  `legal_hold` tinyint(1) not null default 0,
  primary key (`id`),
  key `export_jobs_tenant_idx` (`tenant_id`),
  key `export_jobs_user_idx` (`tenant_id`, `requested_by_user_id`),
  key `export_jobs_status_idx` (`status`),
  unique key `export_jobs_tenant_id_uq` (`tenant_id`, `id`),
  constraint `export_jobs_status_chk` check (`status` in ('queued', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Retention & legal hold ──────────────────────────────────────────────
create table `legal_holds` (
  `id` char(36) not null,
  `tenant_id` char(36) not null,
  `name` varchar(200) not null,
  `reason` text not null,
  -- Scope: tenant-wide, an entity type, or a specific record.
  `scope_type` varchar(20) not null default 'tenant',
  `entity_type` varchar(60) null,
  `entity_id` char(36) null,
  `matter_reference` varchar(120) null,
  `applied_by_user_id` char(36) not null,
  `applied_at` datetime(3) not null default current_timestamp(3),
  `released_by_user_id` char(36) null,
  `released_at` datetime(3) null,
  `release_reason` text null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  key `legal_holds_tenant_idx` (`tenant_id`),
  key `legal_holds_active_idx` (`tenant_id`, `released_at`),
  key `legal_holds_entity_idx` (`tenant_id`, `entity_type`, `entity_id`),
  unique key `legal_holds_tenant_id_uq` (`tenant_id`, `id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

create table `retention_jobs` (
  `id` char(36) not null,
  `tenant_id` char(36) not null,
  -- archive | purge | anonymize
  `action` varchar(20) not null,
  `entity_type` varchar(60) not null,
  `status` varchar(20) not null default 'queued',
  `cutoff_at` datetime(3) not null,
  `candidate_count` int not null default 0,
  `processed_count` int not null default 0,
  `skipped_legal_hold_count` int not null default 0,
  `error_message` text null,
  `started_at` datetime(3) null,
  `completed_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  key `retention_jobs_tenant_idx` (`tenant_id`),
  key `retention_jobs_status_idx` (`status`, `created_at`),
  unique key `retention_jobs_tenant_id_uq` (`tenant_id`, `id`),
  constraint `retention_jobs_status_chk` check (`status` in ('queued', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- ── Durable job queue ───────────────────────────────────────────────────
-- Vercel-compatible: cron routes drain this queue. Every handler is
-- idempotent and tenant-aware; `dedupe_key` makes double-enqueue harmless.
create table `job_queue` (
  `id` char(36) not null,
  `tenant_id` char(36) null,
  `job_type` varchar(60) not null,
  `payload` json not null default (json_object()),
  `status` varchar(20) not null default 'queued',
  `priority` int not null default 100,
  `run_at` datetime(3) not null default current_timestamp(3),
  `started_at` datetime(3) null,
  `completed_at` datetime(3) null,
  `attempts` int not null default 0,
  `max_attempts` int not null default 5,
  `last_error` text null,
  -- Set on the row while a worker owns it; expired leases are reclaimed.
  `locked_by` varchar(80) null,
  `locked_until` datetime(3) null,
  `dedupe_key` varchar(200) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  key `job_queue_status_runat_idx` (`status`, `run_at`),
  key `job_queue_type_idx` (`job_type`, `status`),
  key `job_queue_tenant_idx` (`tenant_id`),
  unique key `job_queue_dedupe_uq` (`dedupe_key`),
  unique key `job_queue_tenant_id_uq` (`tenant_id`, `id`),
  constraint `job_queue_status_chk` check (`status` in ('queued', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;

-- Idempotency ledger for inbound webhooks and mutating API routes.
create table `idempotency_keys` (
  `id` char(36) not null,
  `tenant_id` char(36) null,
  `scope` varchar(60) not null,
  `key` varchar(200) not null,
  -- Digest column: same family as token_hash/sha256/payload_digest — hex,
  -- fixed-width, case-significant. char(64) ascii/bin per docs/mysql-port.md.
  `request_digest` char(64) charset ascii collate ascii_bin null,
  `response_snapshot` json null,
  `status` varchar(20) not null default 'in_progress',
  `expires_at` datetime(3) not null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (`id`),
  unique key `idempotency_keys_scope_key_uq` (`scope`, `key`),
  key `idempotency_keys_expiry_idx` (`expires_at`),
  unique key `idempotency_keys_tenant_id_uq` (`tenant_id`, `id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;
