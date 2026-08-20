-- ============================================================================
-- Goliath Dispatch — Carriers / Documents / Signatures domain
-- Foreign keys only. Applied after every domain's 0X_*_tables.sql (this file
-- lives in the 80-84 phase) so that FKs pointing at tables owned by other
-- domains (tenants, users) always find their target already created.
--
-- ON DELETE actions mirror the source Drizzle schema exactly:
--   * `.references(() => x.id, { onDelete: 'cascade' })`   -> on delete cascade
--   * `.references(() => x.id, { onDelete: 'set null' })`  -> on delete set null
--   * `.references(() => x.id)` with no option              -> on delete restrict
--     (Postgres' default is NO ACTION; MySQL's closest equivalent is RESTRICT.)
--
-- Columns that carry no `.references()` call in the source (documents.current_
-- version_id, signature_requests.superseded_by_request_id, factoring_
-- assignments.notice_of_assignment_document_id / change_of_payee_document_id,
-- and the polymorphic owner_id/subject_id/member_id/resource_id columns) get
-- no foreign key here either — that absence is faithful to the source, not an
-- omission.
-- ============================================================================

-- ── Carriers ────────────────────────────────────────────────────────────────

alter table carriers
  add constraint fk_carriers_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_carriers_approved_by_user
    foreign key (approved_by_user_id) references users (id) on delete restrict;

alter table carrier_users
  add constraint fk_carrier_users_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_carrier_users_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_carrier_users_user
    foreign key (user_id) references users (id) on delete cascade;

alter table carrier_onboardings
  add constraint fk_carrier_onboardings_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_carrier_onboardings_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_carrier_onboardings_decided_by_user
    foreign key (decided_by_user_id) references users (id) on delete restrict;

alter table carrier_onboarding_events
  add constraint fk_carrier_onboarding_events_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_carrier_onboarding_events_onboarding
    foreign key (onboarding_id) references carrier_onboardings (id) on delete cascade,
  add constraint fk_carrier_onboarding_events_actor_user
    foreign key (actor_user_id) references users (id) on delete restrict;

-- ── Dispatcher profiles, assignments, groups ──────────────────────────────

alter table dispatcher_profiles
  add constraint fk_dispatcher_profiles_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_dispatcher_profiles_user
    foreign key (user_id) references users (id) on delete cascade;

alter table carrier_dispatcher_assignments
  add constraint fk_carrier_dispatcher_assignments_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_carrier_dispatcher_assignments_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_carrier_dispatcher_assignments_dispatcher_user
    foreign key (dispatcher_user_id) references users (id) on delete cascade,
  add constraint fk_carrier_dispatcher_assignments_assigned_by_user
    foreign key (assigned_by_user_id) references users (id) on delete restrict;

alter table dispatcher_groups
  add constraint fk_dispatcher_groups_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_dispatcher_groups_owner_dispatcher_user
    foreign key (owner_dispatcher_user_id) references users (id) on delete restrict;

alter table group_members
  add constraint fk_group_members_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_group_members_group
    foreign key (group_id) references dispatcher_groups (id) on delete cascade,
  add constraint fk_group_members_added_by_user
    foreign key (added_by_user_id) references users (id) on delete restrict;

alter table dispatcher_resource_assignments
  add constraint fk_dispatcher_resource_assignments_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_dispatcher_resource_assignments_dispatcher_user
    foreign key (dispatcher_user_id) references users (id) on delete cascade,
  add constraint fk_dispatcher_resource_assignments_assigned_by_user
    foreign key (assigned_by_user_id) references users (id) on delete restrict;

-- ── FMCSA verification ledger ─────────────────────────────────────────────

alter table fmcsa_verifications
  add constraint fk_fmcsa_verifications_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_fmcsa_verifications_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_fmcsa_verifications_overridden_by_user
    foreign key (overridden_by_user_id) references users (id) on delete restrict;

-- ── Factoring ──────────────────────────────────────────────────────────────

alter table factoring_companies
  add constraint fk_factoring_companies_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade;

alter table factoring_assignments
  add constraint fk_factoring_assignments_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_factoring_assignments_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_factoring_assignments_factoring_company
    foreign key (factoring_company_id) references factoring_companies (id) on delete restrict,
  add constraint fk_factoring_assignments_verified_by_user
    foreign key (verified_by_user_id) references users (id) on delete restrict;

-- ── Documents ──────────────────────────────────────────────────────────────

alter table documents
  add constraint fk_documents_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_documents_uploaded_by_user
    foreign key (uploaded_by_user_id) references users (id) on delete restrict;

alter table document_versions
  add constraint fk_document_versions_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_document_versions_document
    foreign key (document_id) references documents (id) on delete cascade,
  add constraint fk_document_versions_uploaded_by_user
    foreign key (uploaded_by_user_id) references users (id) on delete restrict;

alter table document_reviews
  add constraint fk_document_reviews_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_document_reviews_document
    foreign key (document_id) references documents (id) on delete cascade,
  add constraint fk_document_reviews_document_version
    foreign key (document_version_id) references document_versions (id) on delete cascade,
  add constraint fk_document_reviews_reviewer_user
    foreign key (reviewer_user_id) references users (id) on delete restrict;

alter table document_expirations
  add constraint fk_document_expirations_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_document_expirations_document
    foreign key (document_id) references documents (id) on delete cascade;

alter table document_access_logs
  add constraint fk_document_access_logs_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_document_access_logs_document
    foreign key (document_id) references documents (id) on delete cascade,
  add constraint fk_document_access_logs_document_version
    foreign key (document_version_id) references document_versions (id) on delete set null,
  add constraint fk_document_access_logs_user
    foreign key (user_id) references users (id) on delete restrict;

-- ── Signatures ─────────────────────────────────────────────────────────────

alter table signature_templates
  add constraint fk_signature_templates_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade;

alter table signature_requests
  add constraint fk_signature_requests_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_signature_requests_template
    foreign key (template_id) references signature_templates (id) on delete restrict,
  add constraint fk_signature_requests_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_signature_requests_signer_user
    foreign key (signer_user_id) references users (id) on delete restrict,
  add constraint fk_signature_requests_requested_by_user
    foreign key (requested_by_user_id) references users (id) on delete restrict;

alter table signature_records
  add constraint fk_signature_records_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_signature_records_request
    foreign key (request_id) references signature_requests (id) on delete cascade,
  add constraint fk_signature_records_signer_user
    foreign key (signer_user_id) references users (id) on delete restrict,
  add constraint fk_signature_records_signed_document
    foreign key (signed_document_id) references documents (id) on delete set null,
  add constraint fk_signature_records_audit_certificate_document
    foreign key (audit_certificate_document_id) references documents (id) on delete set null;

alter table signature_audit_events
  add constraint fk_signature_audit_events_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_signature_audit_events_request
    foreign key (request_id) references signature_requests (id) on delete cascade,
  add constraint fk_signature_audit_events_record
    foreign key (record_id) references signature_records (id) on delete set null,
  add constraint fk_signature_audit_events_actor_user
    foreign key (actor_user_id) references users (id) on delete restrict;
