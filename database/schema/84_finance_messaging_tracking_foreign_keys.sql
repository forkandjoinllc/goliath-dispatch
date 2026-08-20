-- ============================================================================
-- Goliath Dispatch — Finance / Messaging / Tracking domain
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
-- (tracking_events.stop_id) get no foreign key here either — that absence
-- is faithful to the source, not an omission.
--
-- stripe_events.tenant_id is nullable in the source (a webhook can arrive
-- before the tenant is resolved) but still carries `.references(() =>
-- tenants.id, { onDelete: 'cascade' })` — the FK below is declared on a
-- nullable column, which MySQL permits: a NULL tenant_id simply has nothing
-- to check, and once the value is backfilled the FK applies normally.
--
-- Cross-domain targets:
--   tenants, users                        -> 01_tenancy_auth_tables.sql
--   carriers, factoring_companies,
--   documents                             -> 02_carriers_documents_signatures_tables.sql
--   drivers, trucks                       -> 03_equipment_drivers_customers_tables.sql
--   loads                                 -> 04_loads_routes_permits_tables.sql
-- See docs/port-notes-finance-messaging-tracking.md for how these were
-- verified against a full cross-domain apply.
-- ============================================================================

-- ── Expenses ────────────────────────────────────────────────────────────────

alter table expense_categories
  add constraint fk_expense_categories_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade;

alter table expenses
  add constraint fk_expenses_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_expenses_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_expenses_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_expenses_category
    foreign key (category_id) references expense_categories (id) on delete restrict,
  add constraint fk_expenses_receipt_document
    foreign key (receipt_document_id) references documents (id) on delete set null,
  add constraint fk_expenses_submitted_by_user
    foreign key (submitted_by_user_id) references users (id) on delete restrict,
  add constraint fk_expenses_reviewed_by_user
    foreign key (reviewed_by_user_id) references users (id) on delete restrict;

-- ── Financial snapshots & commissions ───────────────────────────────────────

alter table financial_snapshots
  add constraint fk_financial_snapshots_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_financial_snapshots_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_financial_snapshots_computed_by_user
    foreign key (computed_by_user_id) references users (id) on delete restrict;

alter table dispatcher_commissions
  add constraint fk_dispatcher_commissions_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_dispatcher_commissions_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_dispatcher_commissions_dispatcher_user
    foreign key (dispatcher_user_id) references users (id) on delete restrict,
  add constraint fk_dispatcher_commissions_financial_snapshot
    foreign key (financial_snapshot_id) references financial_snapshots (id) on delete restrict;

-- ── Invoices ────────────────────────────────────────────────────────────────

alter table invoices
  add constraint fk_invoices_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_invoices_carrier
    foreign key (carrier_id) references carriers (id) on delete restrict,
  add constraint fk_invoices_customer
    foreign key (customer_id) references customers (id) on delete restrict,
  add constraint fk_invoices_load
    foreign key (load_id) references loads (id) on delete restrict,
  add constraint fk_invoices_pdf_document
    foreign key (pdf_document_id) references documents (id) on delete set null;

alter table invoice_line_items
  add constraint fk_invoice_line_items_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_invoice_line_items_invoice
    foreign key (invoice_id) references invoices (id) on delete cascade,
  add constraint fk_invoice_line_items_load
    foreign key (load_id) references loads (id) on delete restrict;

-- ── Payments ────────────────────────────────────────────────────────────────

alter table payments
  add constraint fk_payments_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_payments_invoice
    foreign key (invoice_id) references invoices (id) on delete cascade,
  add constraint fk_payments_recorded_by_user
    foreign key (recorded_by_user_id) references users (id) on delete restrict;

alter table payment_attempts
  add constraint fk_payment_attempts_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_payment_attempts_invoice
    foreign key (invoice_id) references invoices (id) on delete cascade,
  add constraint fk_payment_attempts_payment
    foreign key (payment_id) references payments (id) on delete set null;

alter table stripe_events
  add constraint fk_stripe_events_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade;

-- ── Settlements ─────────────────────────────────────────────────────────────

alter table carrier_settlements
  add constraint fk_carrier_settlements_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_carrier_settlements_carrier
    foreign key (carrier_id) references carriers (id) on delete restrict,
  add constraint fk_carrier_settlements_factoring_company
    foreign key (factoring_company_id) references factoring_companies (id) on delete restrict,
  add constraint fk_carrier_settlements_pdf_document
    foreign key (pdf_document_id) references documents (id) on delete set null;

alter table carrier_settlement_lines
  add constraint fk_carrier_settlement_lines_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_carrier_settlement_lines_settlement
    foreign key (settlement_id) references carrier_settlements (id) on delete cascade,
  add constraint fk_carrier_settlement_lines_load
    foreign key (load_id) references loads (id) on delete restrict,
  add constraint fk_carrier_settlement_lines_financial_snapshot
    foreign key (financial_snapshot_id) references financial_snapshots (id) on delete restrict;

-- ── Conversations & messages ─────────────────────────────────────────────────

alter table conversations
  add constraint fk_conversations_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_conversations_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_conversations_carrier
    foreign key (carrier_id) references carriers (id) on delete cascade,
  add constraint fk_conversations_created_by_user
    foreign key (created_by_user_id) references users (id) on delete restrict;

alter table conversation_participants
  add constraint fk_conversation_participants_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_conversation_participants_conversation
    foreign key (conversation_id) references conversations (id) on delete cascade,
  add constraint fk_conversation_participants_user
    foreign key (user_id) references users (id) on delete cascade;

alter table messages
  add constraint fk_messages_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_messages_conversation
    foreign key (conversation_id) references conversations (id) on delete cascade,
  add constraint fk_messages_sender_user
    foreign key (sender_user_id) references users (id) on delete restrict;

alter table message_attachments
  add constraint fk_message_attachments_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_message_attachments_message
    foreign key (message_id) references messages (id) on delete cascade;

-- ── Notifications ─────────────────────────────────────────────────────────

alter table notification_templates
  add constraint fk_notification_templates_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade;

alter table notification_preferences
  add constraint fk_notification_preferences_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_notification_preferences_user
    foreign key (user_id) references users (id) on delete cascade;

alter table notifications
  add constraint fk_notifications_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_notifications_user
    foreign key (user_id) references users (id) on delete cascade;

-- ── Integration connections & tracking ───────────────────────────────────────

alter table integration_connections
  add constraint fk_integration_connections_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade;

alter table tracking_sessions
  add constraint fk_tracking_sessions_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_tracking_sessions_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_tracking_sessions_driver
    foreign key (driver_id) references drivers (id) on delete set null,
  add constraint fk_tracking_sessions_truck
    foreign key (truck_id) references trucks (id) on delete set null,
  add constraint fk_tracking_sessions_consent_user
    foreign key (consent_user_id) references users (id) on delete restrict;

alter table tracking_events
  add constraint fk_tracking_events_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_tracking_events_session
    foreign key (session_id) references tracking_sessions (id) on delete cascade,
  add constraint fk_tracking_events_load
    foreign key (load_id) references loads (id) on delete cascade;

alter table public_tracking_links
  add constraint fk_public_tracking_links_tenant
    foreign key (tenant_id) references tenants (id) on delete cascade,
  add constraint fk_public_tracking_links_load
    foreign key (load_id) references loads (id) on delete cascade,
  add constraint fk_public_tracking_links_created_by_user
    foreign key (created_by_user_id) references users (id) on delete restrict;
