-- ============================================================================
-- Goliath Dispatch — Loads / Routes / Permits domain
-- Foreign keys only. Applied after every domain's 0X_*_tables.sql (this file
-- lives in the 80-84 phase) so that FKs pointing at tables owned by other
-- domains always find their target already created.
--
-- ON DELETE actions mirror the source Drizzle schema exactly:
--   * `.references(() => x.id, { onDelete: 'cascade' })`   -> on delete cascade
--   * `.references(() => x.id, { onDelete: 'set null' })`  -> on delete set null
--   * `.references(() => x.id)` with no option              -> on delete restrict
--     (Postgres' default is NO ACTION; MySQL's closest equivalent is RESTRICT.)
--
-- Columns that carry no `.references()` call in the source
-- (loads.duplicated_from_load_id) get no foreign key here either — that
-- absence is faithful to the source, not an omission.
--
-- Cross-domain targets:
--   tenants, users                                    -> 01_tenancy_auth_tables.sql
--   carriers, documents, document_versions             -> 02_carriers_documents_signatures_tables.sql
--   customers, customer_contacts, customer_locations,
--   drivers, trucks, trailers, equipment_types          -> 03_*_tables.sql (customers/equipment/drivers
--                                                          domain, owned by another engineer)
-- See docs/port-notes-loads-routes-permits.md for which of these were
-- actually proven against a live 03_* file at verification time.
-- ============================================================================

-- ── Loads ───────────────────────────────────────────────────────────────────

alter table loads
  add constraint fk_loads_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_loads_customer
    foreign key (customer_id) references customers (id) on delete restrict,
  add constraint fk_loads_customer_contact
    foreign key (customer_contact_id) references customer_contacts (id) on delete restrict,
  add constraint fk_loads_carrier
    foreign key (carrier_id) references carriers (id) on delete restrict,
  add constraint fk_loads_dispatcher_user
    foreign key (dispatcher_user_id) references users (id) on delete restrict,
  add constraint fk_loads_required_equipment_type
    foreign key (required_equipment_type_id) references equipment_types (id) on delete restrict,
  add constraint fk_loads_permit_ready_approved_by_user
    foreign key (permit_ready_approved_by_user_id) references users (id) on delete restrict,
  add constraint fk_loads_oversize_validated_by_user
    foreign key (oversize_validated_by_user_id) references users (id) on delete restrict;

-- ── Stops ───────────────────────────────────────────────────────────────────

alter table load_stops
  add constraint fk_load_stops_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_load_stops_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_load_stops_customer_location
    foreign key (customer_location_id) references customer_locations (id) on delete restrict;

-- ── Resource assignments ────────────────────────────────────────────────────

alter table load_assignments
  add constraint fk_load_assignments_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_load_assignments_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_load_assignments_truck
    foreign key (truck_id) references trucks (id) on delete restrict,
  add constraint fk_load_assignments_trailer
    foreign key (trailer_id) references trailers (id) on delete restrict,
  add constraint fk_load_assignments_driver
    foreign key (driver_id) references drivers (id) on delete restrict,
  add constraint fk_load_assignments_assigned_by_user
    foreign key (assigned_by_user_id) references users (id) on delete restrict;

-- ── Status history ──────────────────────────────────────────────────────────

alter table load_status_history
  add constraint fk_load_status_history_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_load_status_history_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_load_status_history_actor_user
    foreign key (actor_user_id) references users (id) on delete restrict;

-- ── Load documents & rate confirmation ──────────────────────────────────────

alter table load_documents
  add constraint fk_load_documents_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_load_documents_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_load_documents_document
    foreign key (document_id) references documents (id) on delete cascade,
  add constraint fk_load_documents_stop
    foreign key (stop_id) references load_stops (id) on delete set null;

alter table rate_confirmation_acceptances
  add constraint fk_rate_confirmation_acceptances_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_rate_confirmation_acceptances_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_rate_confirmation_acceptances_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_rate_confirmation_acceptances_document
    foreign key (document_id) references documents (id) on delete restrict,
  add constraint fk_rate_confirmation_acceptances_document_version
    foreign key (document_version_id) references document_versions (id) on delete restrict,
  add constraint fk_rate_confirmation_acceptances_actor_user
    foreign key (actor_user_id) references users (id) on delete restrict;

-- ── Check calls ──────────────────────────────────────────────────────────────

alter table check_calls
  add constraint fk_check_calls_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_check_calls_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_check_calls_completed_by_user
    foreign key (completed_by_user_id) references users (id) on delete restrict;

-- ── Routes ───────────────────────────────────────────────────────────────────

alter table routes
  add constraint fk_routes_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_routes_load
    foreign key (load_id) references loads (id) on delete cascade;

alter table route_states
  add constraint fk_route_states_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_route_states_route
    foreign key (route_id) references routes (id) on delete cascade;

-- ── Oversize rules & evaluation ──────────────────────────────────────────────

alter table oversize_rules
  add constraint fk_oversize_rules_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade;

alter table oversize_evaluations
  add constraint fk_oversize_evaluations_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_oversize_evaluations_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_oversize_evaluations_route
    foreign key (route_id) references routes (id) on delete set null,
  add constraint fk_oversize_evaluations_validated_by_user
    foreign key (validated_by_user_id) references users (id) on delete restrict;

-- ── Permits & escorts ─────────────────────────────────────────────────────────

alter table permits
  add constraint fk_permits_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_permits_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_permits_document
    foreign key (document_id) references documents (id) on delete set null,
  add constraint fk_permits_route_survey_document
    foreign key (route_survey_document_id) references documents (id) on delete set null;

alter table escorts
  add constraint fk_escorts_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_escorts_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_escorts_document
    foreign key (document_id) references documents (id) on delete set null;
