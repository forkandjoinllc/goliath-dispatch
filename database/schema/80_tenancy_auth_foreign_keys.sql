-- ────────────────────────────────────────────────────────────────────────────
-- Tenancy & Auth domain — foreign keys.
--
-- Applied after ALL domains' 01_*_tables.sql files (all tables 01–05), so
-- these constraints may only reference tables owned by THIS domain (tenant.ts,
-- auth.ts, platform.ts). Two columns are deliberately left unconstrained here
-- because their target tables belong to another engineer's domain:
--
--   user_tenant_memberships.carrier_id  -> carriers.id   (carrier.ts domain)
--   user_tenant_memberships.driver_id   -> drivers.id    (driver.ts domain)
--
-- This is exactly the situation the three-file split exists to avoid: a
-- cross-domain FK would force a creation order no single migration set could
-- satisfy. Application code and the (future, other-domain-owned) tenant guard
-- triggers are responsible for referential integrity on those two columns.
--
-- audit_events.impersonation_session_id also has no FK: the Postgres source
-- itself declares that column as a bare uuid with no .references() call, so
-- there is nothing to preserve here — it is ported faithfully as unconstrained.
--
-- Where the Postgres source did not specify onDelete, MySQL's default
-- RESTRICT (NO ACTION) is used, matching Postgres's own default behavior.
-- ────────────────────────────────────────────────────────────────────────────

-- ── tenant.ts ───────────────────────────────────────────────────────────

alter table `tenant_branding`
  add constraint `tenant_branding_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade;

alter table `tenant_settings`
  add constraint `tenant_settings_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade;

alter table `tenant_subscriptions`
  add constraint `tenant_subscriptions_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade,
  add constraint `tenant_subscriptions_plan_id_fk`
    foreign key (`plan_id`) references `saas_plans` (`id`);

alter table `equipment_types`
  add constraint `equipment_types_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade;

-- ── auth.ts ─────────────────────────────────────────────────────────────

alter table `user_tenant_memberships`
  add constraint `user_tenant_memberships_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade,
  add constraint `user_tenant_memberships_user_id_fk`
    foreign key (`user_id`) references `users` (`id`) on delete cascade,
  add constraint `user_tenant_memberships_invited_by_user_id_fk`
    foreign key (`invited_by_user_id`) references `users` (`id`);
  -- carrier_id / driver_id intentionally NOT constrained — see header note.

alter table `role_permissions`
  add constraint `role_permissions_permission_id_fk`
    foreign key (`permission_id`) references `permissions` (`id`) on delete cascade;

alter table `user_permission_overrides`
  add constraint `user_permission_overrides_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade,
  add constraint `user_permission_overrides_user_id_fk`
    foreign key (`user_id`) references `users` (`id`) on delete cascade,
  add constraint `user_permission_overrides_permission_id_fk`
    foreign key (`permission_id`) references `permissions` (`id`) on delete cascade,
  add constraint `user_permission_overrides_granted_by_user_id_fk`
    foreign key (`granted_by_user_id`) references `users` (`id`);

alter table `sessions`
  add constraint `sessions_user_id_fk`
    foreign key (`user_id`) references `users` (`id`) on delete cascade,
  -- SET NULL, not CASCADE: deleting a tenant must not delete the session row
  -- of a user who also belongs to other tenants — that would log them out of
  -- everything. Dropping them back to "no active tenant" is the correct blast
  -- radius; the tenant switcher picks up from there.
  add constraint `sessions_active_tenant_id_fk`
    foreign key (`active_tenant_id`) references `tenants` (`id`) on delete set null;

alter table `mfa_configurations`
  add constraint `mfa_configurations_user_id_fk`
    foreign key (`user_id`) references `users` (`id`) on delete cascade;

alter table `verification_tokens`
  add constraint `verification_tokens_user_id_fk`
    foreign key (`user_id`) references `users` (`id`) on delete cascade,
  add constraint `verification_tokens_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade;

alter table `consent_records`
  add constraint `consent_records_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade,
  add constraint `consent_records_user_id_fk`
    foreign key (`user_id`) references `users` (`id`) on delete cascade;

alter table `impersonation_sessions`
  add constraint `impersonation_sessions_actor_user_id_fk`
    foreign key (`actor_user_id`) references `users` (`id`),
  add constraint `impersonation_sessions_target_user_id_fk`
    foreign key (`target_user_id`) references `users` (`id`),
  add constraint `impersonation_sessions_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade,
  add constraint `impersonation_sessions_session_id_fk`
    foreign key (`session_id`) references `sessions` (`id`) on delete set null;

-- login_attempts and rate_limit_buckets carry no foreign keys in the source.

-- ── platform.ts ─────────────────────────────────────────────────────────

alter table `leads`
  add constraint `leads_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade,
  add constraint `leads_assigned_to_user_id_fk`
    foreign key (`assigned_to_user_id`) references `users` (`id`);

alter table `quote_requests`
  add constraint `quote_requests_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade,
  add constraint `quote_requests_lead_id_fk`
    foreign key (`lead_id`) references `leads` (`id`) on delete set null;

alter table `audit_events`
  add constraint `audit_events_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete restrict,
  add constraint `audit_events_actor_user_id_fk`
    foreign key (`actor_user_id`) references `users` (`id`),
  add constraint `audit_events_effective_user_id_fk`
    foreign key (`effective_user_id`) references `users` (`id`);
  -- impersonation_session_id intentionally NOT constrained — see header note.

alter table `export_jobs`
  add constraint `export_jobs_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade,
  add constraint `export_jobs_requested_by_user_id_fk`
    foreign key (`requested_by_user_id`) references `users` (`id`);

alter table `legal_holds`
  add constraint `legal_holds_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade,
  add constraint `legal_holds_applied_by_user_id_fk`
    foreign key (`applied_by_user_id`) references `users` (`id`),
  add constraint `legal_holds_released_by_user_id_fk`
    foreign key (`released_by_user_id`) references `users` (`id`);

alter table `retention_jobs`
  add constraint `retention_jobs_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade;

alter table `job_queue`
  add constraint `job_queue_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade;

alter table `idempotency_keys`
  add constraint `idempotency_keys_tenant_id_fk`
    foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade;
