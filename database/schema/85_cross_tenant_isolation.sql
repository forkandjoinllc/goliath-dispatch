-- ────────────────────────────────────────────────────────────────────────────
-- Aislamiento entre empresas, a nivel de base de datos.
--
-- Los ficheros 80–84 portan las claves foráneas tal y como estaban en el origen
-- PostgreSQL: de una sola columna. Eso deja un hueco real — nada impide que una
-- carga del tenant A apunte a un camión del tenant B. El scope global de
-- Eloquent lo evita en la práctica, pero es una defensa de una sola capa, y el
-- requisito dice explícitamente que el aislamiento se impone también en la base
-- de datos.
--
-- Este fichero cierra ese hueco. Cada tabla con tenant lleva ya una clave única
-- compuesta `<tabla>_tenant_id_uq (tenant_id, id)` — existe justo para poder
-- referenciarla. Aquí se añaden FK compuestas
-- `(tenant_id, padre_id) -> padre (tenant_id, id)`, de modo que InnoDB rechaza
-- por sí solo cualquier fila que cruce empresas.
--
-- Cobertura: 78 de 95 relaciones hijo->padre con tenant a ambos lados.
-- Las 17 restantes son `ON DELETE SET NULL`: una FK compuesta intentaría
-- poner también `tenant_id` a NULL, que es NOT NULL, así que esas se cubren con
-- triggers al final del fichero.
--
-- Sobre los nombres: al soltar una FK, MySQL conserva con el mismo nombre el
-- índice que había creado para ella, así que reutilizar el nombre da ERROR 1061.
-- La FK compuesta lleva sufijo `_xt` (cross-tenant); el índice de una sola
-- columna se queda, y sigue sirviendo para las búsquedas por esa columna sola.
--
-- Requiere que ninguna columna generada lea `tenant_id`: InnoDB devuelve
-- ERROR 1215 si una columna hija de un cascade alimenta una columna STORED.
-- Ver docs/mysql-port.md.
-- ────────────────────────────────────────────────────────────────────────────

-- ── carrier_dispatcher_assignments ──
alter table `carrier_dispatcher_assignments` drop foreign key `fk_carrier_dispatcher_assignments_carrier`;
alter table `carrier_dispatcher_assignments` add constraint `fk_carrier_dispatcher_assignments_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;

-- ── carrier_onboarding_events ──
alter table `carrier_onboarding_events` drop foreign key `fk_carrier_onboarding_events_onboarding`;
alter table `carrier_onboarding_events` add constraint `fk_carrier_onboarding_events_onboarding_xt`
  foreign key (`tenant_id`, `onboarding_id`) references `carrier_onboardings` (`tenant_id`, `id`)
  on delete cascade;

-- ── carrier_onboardings ──
alter table `carrier_onboardings` drop foreign key `fk_carrier_onboardings_carrier`;
alter table `carrier_onboardings` add constraint `fk_carrier_onboardings_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;

-- ── carrier_settlement_lines ──
alter table `carrier_settlement_lines` drop foreign key `fk_carrier_settlement_lines_financial_snapshot`;
alter table `carrier_settlement_lines` add constraint `fk_carrier_settlement_lines_financial_snapshot_xt`
  foreign key (`tenant_id`, `financial_snapshot_id`) references `financial_snapshots` (`tenant_id`, `id`)
  on delete restrict;
alter table `carrier_settlement_lines` drop foreign key `fk_carrier_settlement_lines_load`;
alter table `carrier_settlement_lines` add constraint `fk_carrier_settlement_lines_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete restrict;
alter table `carrier_settlement_lines` drop foreign key `fk_carrier_settlement_lines_settlement`;
alter table `carrier_settlement_lines` add constraint `fk_carrier_settlement_lines_settlement_xt`
  foreign key (`tenant_id`, `settlement_id`) references `carrier_settlements` (`tenant_id`, `id`)
  on delete cascade;

-- ── carrier_settlements ──
alter table `carrier_settlements` drop foreign key `fk_carrier_settlements_carrier`;
alter table `carrier_settlements` add constraint `fk_carrier_settlements_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete restrict;
alter table `carrier_settlements` drop foreign key `fk_carrier_settlements_factoring_company`;
alter table `carrier_settlements` add constraint `fk_carrier_settlements_factoring_company_xt`
  foreign key (`tenant_id`, `factoring_company_id`) references `factoring_companies` (`tenant_id`, `id`)
  on delete restrict;

-- ── carrier_users ──
alter table `carrier_users` drop foreign key `fk_carrier_users_carrier`;
alter table `carrier_users` add constraint `fk_carrier_users_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;

-- ── check_calls ──
alter table `check_calls` drop foreign key `fk_check_calls_load`;
alter table `check_calls` add constraint `fk_check_calls_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── conversation_participants ──
alter table `conversation_participants` drop foreign key `fk_conversation_participants_conversation`;
alter table `conversation_participants` add constraint `fk_conversation_participants_conversation_xt`
  foreign key (`tenant_id`, `conversation_id`) references `conversations` (`tenant_id`, `id`)
  on delete cascade;

-- ── conversations ──
alter table `conversations` drop foreign key `fk_conversations_carrier`;
alter table `conversations` add constraint `fk_conversations_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;
alter table `conversations` drop foreign key `fk_conversations_load`;
alter table `conversations` add constraint `fk_conversations_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── customer_contact_locations ──
alter table `customer_contact_locations` drop foreign key `fk_customer_contact_locations_contact`;
alter table `customer_contact_locations` add constraint `fk_customer_contact_locations_contact_xt`
  foreign key (`tenant_id`, `contact_id`) references `customer_contacts` (`tenant_id`, `id`)
  on delete cascade;
alter table `customer_contact_locations` drop foreign key `fk_customer_contact_locations_location`;
alter table `customer_contact_locations` add constraint `fk_customer_contact_locations_location_xt`
  foreign key (`tenant_id`, `location_id`) references `customer_locations` (`tenant_id`, `id`)
  on delete cascade;

-- ── customer_contacts ──
alter table `customer_contacts` drop foreign key `fk_customer_contacts_customer`;
alter table `customer_contacts` add constraint `fk_customer_contacts_customer_xt`
  foreign key (`tenant_id`, `customer_id`) references `customers` (`tenant_id`, `id`)
  on delete restrict;

-- ── customer_locations ──
alter table `customer_locations` drop foreign key `fk_customer_locations_customer`;
alter table `customer_locations` add constraint `fk_customer_locations_customer_xt`
  foreign key (`tenant_id`, `customer_id`) references `customers` (`tenant_id`, `id`)
  on delete cascade;

-- ── dispatcher_commissions ──
alter table `dispatcher_commissions` drop foreign key `fk_dispatcher_commissions_financial_snapshot`;
alter table `dispatcher_commissions` add constraint `fk_dispatcher_commissions_financial_snapshot_xt`
  foreign key (`tenant_id`, `financial_snapshot_id`) references `financial_snapshots` (`tenant_id`, `id`)
  on delete restrict;
alter table `dispatcher_commissions` drop foreign key `fk_dispatcher_commissions_load`;
alter table `dispatcher_commissions` add constraint `fk_dispatcher_commissions_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── document_access_logs ──
alter table `document_access_logs` drop foreign key `fk_document_access_logs_document`;
alter table `document_access_logs` add constraint `fk_document_access_logs_document_xt`
  foreign key (`tenant_id`, `document_id`) references `documents` (`tenant_id`, `id`)
  on delete cascade;

-- ── document_expirations ──
alter table `document_expirations` drop foreign key `fk_document_expirations_document`;
alter table `document_expirations` add constraint `fk_document_expirations_document_xt`
  foreign key (`tenant_id`, `document_id`) references `documents` (`tenant_id`, `id`)
  on delete cascade;

-- ── document_reviews ──
alter table `document_reviews` drop foreign key `fk_document_reviews_document`;
alter table `document_reviews` add constraint `fk_document_reviews_document_xt`
  foreign key (`tenant_id`, `document_id`) references `documents` (`tenant_id`, `id`)
  on delete cascade;
alter table `document_reviews` drop foreign key `fk_document_reviews_document_version`;
alter table `document_reviews` add constraint `fk_document_reviews_document_version_xt`
  foreign key (`tenant_id`, `document_version_id`) references `document_versions` (`tenant_id`, `id`)
  on delete cascade;

-- ── document_versions ──
alter table `document_versions` drop foreign key `fk_document_versions_document`;
alter table `document_versions` add constraint `fk_document_versions_document_xt`
  foreign key (`tenant_id`, `document_id`) references `documents` (`tenant_id`, `id`)
  on delete cascade;

-- ── driver_carrier_relationships ──
alter table `driver_carrier_relationships` drop foreign key `fk_driver_carrier_relationships_carrier`;
alter table `driver_carrier_relationships` add constraint `fk_driver_carrier_relationships_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;
alter table `driver_carrier_relationships` drop foreign key `fk_driver_carrier_relationships_driver`;
alter table `driver_carrier_relationships` add constraint `fk_driver_carrier_relationships_driver_xt`
  foreign key (`tenant_id`, `driver_id`) references `drivers` (`tenant_id`, `id`)
  on delete cascade;

-- ── equipment_verifications ──
alter table `equipment_verifications` drop foreign key `fk_equipment_verifications_carrier`;
alter table `equipment_verifications` add constraint `fk_equipment_verifications_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;

-- ── escorts ──
alter table `escorts` drop foreign key `fk_escorts_load`;
alter table `escorts` add constraint `fk_escorts_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── expenses ──
alter table `expenses` drop foreign key `fk_expenses_carrier`;
alter table `expenses` add constraint `fk_expenses_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;
alter table `expenses` drop foreign key `fk_expenses_category`;
alter table `expenses` add constraint `fk_expenses_category_xt`
  foreign key (`tenant_id`, `category_id`) references `expense_categories` (`tenant_id`, `id`)
  on delete restrict;
alter table `expenses` drop foreign key `fk_expenses_load`;
alter table `expenses` add constraint `fk_expenses_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── factoring_assignments ──
alter table `factoring_assignments` drop foreign key `fk_factoring_assignments_carrier`;
alter table `factoring_assignments` add constraint `fk_factoring_assignments_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;
alter table `factoring_assignments` drop foreign key `fk_factoring_assignments_factoring_company`;
alter table `factoring_assignments` add constraint `fk_factoring_assignments_factoring_company_xt`
  foreign key (`tenant_id`, `factoring_company_id`) references `factoring_companies` (`tenant_id`, `id`)
  on delete restrict;

-- ── financial_snapshots ──
alter table `financial_snapshots` drop foreign key `fk_financial_snapshots_load`;
alter table `financial_snapshots` add constraint `fk_financial_snapshots_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── fmcsa_verifications ──
alter table `fmcsa_verifications` drop foreign key `fk_fmcsa_verifications_carrier`;
alter table `fmcsa_verifications` add constraint `fk_fmcsa_verifications_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;

-- ── group_members ──
alter table `group_members` drop foreign key `fk_group_members_group`;
alter table `group_members` add constraint `fk_group_members_group_xt`
  foreign key (`tenant_id`, `group_id`) references `dispatcher_groups` (`tenant_id`, `id`)
  on delete cascade;

-- ── invoice_line_items ──
alter table `invoice_line_items` drop foreign key `fk_invoice_line_items_invoice`;
alter table `invoice_line_items` add constraint `fk_invoice_line_items_invoice_xt`
  foreign key (`tenant_id`, `invoice_id`) references `invoices` (`tenant_id`, `id`)
  on delete cascade;
alter table `invoice_line_items` drop foreign key `fk_invoice_line_items_load`;
alter table `invoice_line_items` add constraint `fk_invoice_line_items_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete restrict;

-- ── invoices ──
alter table `invoices` drop foreign key `fk_invoices_carrier`;
alter table `invoices` add constraint `fk_invoices_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete restrict;
alter table `invoices` drop foreign key `fk_invoices_customer`;
alter table `invoices` add constraint `fk_invoices_customer_xt`
  foreign key (`tenant_id`, `customer_id`) references `customers` (`tenant_id`, `id`)
  on delete restrict;
alter table `invoices` drop foreign key `fk_invoices_load`;
alter table `invoices` add constraint `fk_invoices_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete restrict;

-- ── load_assignments ──
alter table `load_assignments` drop foreign key `fk_load_assignments_driver`;
alter table `load_assignments` add constraint `fk_load_assignments_driver_xt`
  foreign key (`tenant_id`, `driver_id`) references `drivers` (`tenant_id`, `id`)
  on delete restrict;
alter table `load_assignments` drop foreign key `fk_load_assignments_load`;
alter table `load_assignments` add constraint `fk_load_assignments_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;
alter table `load_assignments` drop foreign key `fk_load_assignments_trailer`;
alter table `load_assignments` add constraint `fk_load_assignments_trailer_xt`
  foreign key (`tenant_id`, `trailer_id`) references `trailers` (`tenant_id`, `id`)
  on delete restrict;
alter table `load_assignments` drop foreign key `fk_load_assignments_truck`;
alter table `load_assignments` add constraint `fk_load_assignments_truck_xt`
  foreign key (`tenant_id`, `truck_id`) references `trucks` (`tenant_id`, `id`)
  on delete restrict;

-- ── load_documents ──
alter table `load_documents` drop foreign key `fk_load_documents_document`;
alter table `load_documents` add constraint `fk_load_documents_document_xt`
  foreign key (`tenant_id`, `document_id`) references `documents` (`tenant_id`, `id`)
  on delete cascade;
alter table `load_documents` drop foreign key `fk_load_documents_load`;
alter table `load_documents` add constraint `fk_load_documents_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── load_status_history ──
alter table `load_status_history` drop foreign key `fk_load_status_history_load`;
alter table `load_status_history` add constraint `fk_load_status_history_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── load_stops ──
alter table `load_stops` drop foreign key `fk_load_stops_customer_location`;
alter table `load_stops` add constraint `fk_load_stops_customer_location_xt`
  foreign key (`tenant_id`, `customer_location_id`) references `customer_locations` (`tenant_id`, `id`)
  on delete restrict;
alter table `load_stops` drop foreign key `fk_load_stops_load`;
alter table `load_stops` add constraint `fk_load_stops_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── loads ──
alter table `loads` drop foreign key `fk_loads_carrier`;
alter table `loads` add constraint `fk_loads_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete restrict;
alter table `loads` drop foreign key `fk_loads_customer`;
alter table `loads` add constraint `fk_loads_customer_xt`
  foreign key (`tenant_id`, `customer_id`) references `customers` (`tenant_id`, `id`)
  on delete restrict;
alter table `loads` drop foreign key `fk_loads_customer_contact`;
alter table `loads` add constraint `fk_loads_customer_contact_xt`
  foreign key (`tenant_id`, `customer_contact_id`) references `customer_contacts` (`tenant_id`, `id`)
  on delete restrict;
alter table `loads` drop foreign key `fk_loads_required_equipment_type`;
alter table `loads` add constraint `fk_loads_required_equipment_type_xt`
  foreign key (`tenant_id`, `required_equipment_type_id`) references `equipment_types` (`tenant_id`, `id`)
  on delete restrict;

-- ── message_attachments ──
alter table `message_attachments` drop foreign key `fk_message_attachments_message`;
alter table `message_attachments` add constraint `fk_message_attachments_message_xt`
  foreign key (`tenant_id`, `message_id`) references `messages` (`tenant_id`, `id`)
  on delete cascade;

-- ── messages ──
alter table `messages` drop foreign key `fk_messages_conversation`;
alter table `messages` add constraint `fk_messages_conversation_xt`
  foreign key (`tenant_id`, `conversation_id`) references `conversations` (`tenant_id`, `id`)
  on delete cascade;

-- ── oversize_evaluations ──
alter table `oversize_evaluations` drop foreign key `fk_oversize_evaluations_load`;
alter table `oversize_evaluations` add constraint `fk_oversize_evaluations_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── payment_attempts ──
alter table `payment_attempts` drop foreign key `fk_payment_attempts_invoice`;
alter table `payment_attempts` add constraint `fk_payment_attempts_invoice_xt`
  foreign key (`tenant_id`, `invoice_id`) references `invoices` (`tenant_id`, `id`)
  on delete cascade;

-- ── payments ──
alter table `payments` drop foreign key `fk_payments_invoice`;
alter table `payments` add constraint `fk_payments_invoice_xt`
  foreign key (`tenant_id`, `invoice_id`) references `invoices` (`tenant_id`, `id`)
  on delete cascade;

-- ── permits ──
alter table `permits` drop foreign key `fk_permits_load`;
alter table `permits` add constraint `fk_permits_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── public_tracking_links ──
alter table `public_tracking_links` drop foreign key `fk_public_tracking_links_load`;
alter table `public_tracking_links` add constraint `fk_public_tracking_links_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── rate_confirmation_acceptances ──
alter table `rate_confirmation_acceptances` drop foreign key `fk_rate_confirmation_acceptances_carrier`;
alter table `rate_confirmation_acceptances` add constraint `fk_rate_confirmation_acceptances_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;
alter table `rate_confirmation_acceptances` drop foreign key `fk_rate_confirmation_acceptances_document`;
alter table `rate_confirmation_acceptances` add constraint `fk_rate_confirmation_acceptances_document_xt`
  foreign key (`tenant_id`, `document_id`) references `documents` (`tenant_id`, `id`)
  on delete restrict;
alter table `rate_confirmation_acceptances` drop foreign key `fk_rate_confirmation_acceptances_document_version`;
alter table `rate_confirmation_acceptances` add constraint `fk_rate_confirmation_acceptances_document_version_xt`
  foreign key (`tenant_id`, `document_version_id`) references `document_versions` (`tenant_id`, `id`)
  on delete restrict;
alter table `rate_confirmation_acceptances` drop foreign key `fk_rate_confirmation_acceptances_load`;
alter table `rate_confirmation_acceptances` add constraint `fk_rate_confirmation_acceptances_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── route_states ──
alter table `route_states` drop foreign key `fk_route_states_route`;
alter table `route_states` add constraint `fk_route_states_route_xt`
  foreign key (`tenant_id`, `route_id`) references `routes` (`tenant_id`, `id`)
  on delete cascade;

-- ── routes ──
alter table `routes` drop foreign key `fk_routes_load`;
alter table `routes` add constraint `fk_routes_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── signature_audit_events ──
alter table `signature_audit_events` drop foreign key `fk_signature_audit_events_request`;
alter table `signature_audit_events` add constraint `fk_signature_audit_events_request_xt`
  foreign key (`tenant_id`, `request_id`) references `signature_requests` (`tenant_id`, `id`)
  on delete cascade;

-- ── signature_records ──
alter table `signature_records` drop foreign key `fk_signature_records_request`;
alter table `signature_records` add constraint `fk_signature_records_request_xt`
  foreign key (`tenant_id`, `request_id`) references `signature_requests` (`tenant_id`, `id`)
  on delete cascade;

-- ── signature_requests ──
alter table `signature_requests` drop foreign key `fk_signature_requests_carrier`;
alter table `signature_requests` add constraint `fk_signature_requests_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;
alter table `signature_requests` drop foreign key `fk_signature_requests_template`;
alter table `signature_requests` add constraint `fk_signature_requests_template_xt`
  foreign key (`tenant_id`, `template_id`) references `signature_templates` (`tenant_id`, `id`)
  on delete restrict;

-- ── tracking_events ──
alter table `tracking_events` drop foreign key `fk_tracking_events_load`;
alter table `tracking_events` add constraint `fk_tracking_events_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;
alter table `tracking_events` drop foreign key `fk_tracking_events_session`;
alter table `tracking_events` add constraint `fk_tracking_events_session_xt`
  foreign key (`tenant_id`, `session_id`) references `tracking_sessions` (`tenant_id`, `id`)
  on delete cascade;

-- ── tracking_sessions ──
alter table `tracking_sessions` drop foreign key `fk_tracking_sessions_load`;
alter table `tracking_sessions` add constraint `fk_tracking_sessions_load_xt`
  foreign key (`tenant_id`, `load_id`) references `loads` (`tenant_id`, `id`)
  on delete cascade;

-- ── trailers ──
alter table `trailers` drop foreign key `fk_trailers_carrier`;
alter table `trailers` add constraint `fk_trailers_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;
alter table `trailers` drop foreign key `fk_trailers_equipment_type`;
alter table `trailers` add constraint `fk_trailers_equipment_type_xt`
  foreign key (`tenant_id`, `equipment_type_id`) references `equipment_types` (`tenant_id`, `id`)
  on delete restrict;

-- ── trucks ──
alter table `trucks` drop foreign key `fk_trucks_carrier`;
alter table `trucks` add constraint `fk_trucks_carrier_xt`
  foreign key (`tenant_id`, `carrier_id`) references `carriers` (`tenant_id`, `id`)
  on delete cascade;
alter table `trucks` drop foreign key `fk_trucks_equipment_type`;
alter table `trucks` add constraint `fk_trucks_equipment_type_xt`
  foreign key (`tenant_id`, `equipment_type_id`) references `equipment_types` (`tenant_id`, `id`)
  on delete restrict;


-- ════════════════════════════════════════════════════════════════════════════
-- Guardas para las relaciones ON DELETE SET NULL
--
-- La FK de una sola columna se conserva tal cual (sigue haciendo el SET NULL
-- cuando se borra el padre). El trigger añade lo único que la FK no puede
-- comprobar: que el padre pertenezca al mismo tenant que el hijo.
--
-- MESSAGE_TEXT se trunca a 128 caracteres (ERROR 1648), de ahí lo escueto.
-- ════════════════════════════════════════════════════════════════════════════

create trigger `xt_carrier_settlements_pdf_document_insert`
before insert on `carrier_settlements` for each row
begin
  if new.`pdf_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`pdf_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: carrier_settlements.pdf_document_id';
    end if;
  end if;
end;

create trigger `xt_carrier_settlements_pdf_document_update`
before update on `carrier_settlements` for each row
begin
  if new.`pdf_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`pdf_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: carrier_settlements.pdf_document_id';
    end if;
  end if;
end;

create trigger `xt_document_access_logs_document_version_insert`
before insert on `document_access_logs` for each row
begin
  if new.`document_version_id` is not null then
    if (select `tenant_id` from `document_versions` where `id` = new.`document_version_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: document_access_logs.document_version_id';
    end if;
  end if;
end;

create trigger `xt_document_access_logs_document_version_update`
before update on `document_access_logs` for each row
begin
  if new.`document_version_id` is not null then
    if (select `tenant_id` from `document_versions` where `id` = new.`document_version_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: document_access_logs.document_version_id';
    end if;
  end if;
end;

create trigger `xt_equipment_verifications_coi_document_insert`
before insert on `equipment_verifications` for each row
begin
  if new.`coi_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`coi_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: equipment_verifications.coi_document_id';
    end if;
  end if;
end;

create trigger `xt_equipment_verifications_coi_document_update`
before update on `equipment_verifications` for each row
begin
  if new.`coi_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`coi_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: equipment_verifications.coi_document_id';
    end if;
  end if;
end;

create trigger `xt_escorts_document_insert`
before insert on `escorts` for each row
begin
  if new.`document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: escorts.document_id';
    end if;
  end if;
end;

create trigger `xt_escorts_document_update`
before update on `escorts` for each row
begin
  if new.`document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: escorts.document_id';
    end if;
  end if;
end;

create trigger `xt_expenses_receipt_document_insert`
before insert on `expenses` for each row
begin
  if new.`receipt_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`receipt_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: expenses.receipt_document_id';
    end if;
  end if;
end;

create trigger `xt_expenses_receipt_document_update`
before update on `expenses` for each row
begin
  if new.`receipt_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`receipt_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: expenses.receipt_document_id';
    end if;
  end if;
end;

create trigger `xt_invoices_pdf_document_insert`
before insert on `invoices` for each row
begin
  if new.`pdf_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`pdf_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: invoices.pdf_document_id';
    end if;
  end if;
end;

create trigger `xt_invoices_pdf_document_update`
before update on `invoices` for each row
begin
  if new.`pdf_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`pdf_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: invoices.pdf_document_id';
    end if;
  end if;
end;

create trigger `xt_load_documents_stop_insert`
before insert on `load_documents` for each row
begin
  if new.`stop_id` is not null then
    if (select `tenant_id` from `load_stops` where `id` = new.`stop_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: load_documents.stop_id';
    end if;
  end if;
end;

create trigger `xt_load_documents_stop_update`
before update on `load_documents` for each row
begin
  if new.`stop_id` is not null then
    if (select `tenant_id` from `load_stops` where `id` = new.`stop_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: load_documents.stop_id';
    end if;
  end if;
end;

create trigger `xt_oversize_evaluations_route_insert`
before insert on `oversize_evaluations` for each row
begin
  if new.`route_id` is not null then
    if (select `tenant_id` from `routes` where `id` = new.`route_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: oversize_evaluations.route_id';
    end if;
  end if;
end;

create trigger `xt_oversize_evaluations_route_update`
before update on `oversize_evaluations` for each row
begin
  if new.`route_id` is not null then
    if (select `tenant_id` from `routes` where `id` = new.`route_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: oversize_evaluations.route_id';
    end if;
  end if;
end;

create trigger `xt_payment_attempts_payment_insert`
before insert on `payment_attempts` for each row
begin
  if new.`payment_id` is not null then
    if (select `tenant_id` from `payments` where `id` = new.`payment_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: payment_attempts.payment_id';
    end if;
  end if;
end;

create trigger `xt_payment_attempts_payment_update`
before update on `payment_attempts` for each row
begin
  if new.`payment_id` is not null then
    if (select `tenant_id` from `payments` where `id` = new.`payment_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: payment_attempts.payment_id';
    end if;
  end if;
end;

create trigger `xt_permits_document_insert`
before insert on `permits` for each row
begin
  if new.`document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: permits.document_id';
    end if;
  end if;
end;

create trigger `xt_permits_document_update`
before update on `permits` for each row
begin
  if new.`document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: permits.document_id';
    end if;
  end if;
end;

create trigger `xt_permits_route_survey_document_insert`
before insert on `permits` for each row
begin
  if new.`route_survey_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`route_survey_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: permits.route_survey_document_id';
    end if;
  end if;
end;

create trigger `xt_permits_route_survey_document_update`
before update on `permits` for each row
begin
  if new.`route_survey_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`route_survey_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: permits.route_survey_document_id';
    end if;
  end if;
end;

create trigger `xt_quote_requests_lead_id_insert`
before insert on `quote_requests` for each row
begin
  if new.`lead_id` is not null then
    if (select `tenant_id` from `leads` where `id` = new.`lead_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: quote_requests.lead_id';
    end if;
  end if;
end;

create trigger `xt_quote_requests_lead_id_update`
before update on `quote_requests` for each row
begin
  if new.`lead_id` is not null then
    if (select `tenant_id` from `leads` where `id` = new.`lead_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: quote_requests.lead_id';
    end if;
  end if;
end;

create trigger `xt_signature_audit_events_record_insert`
before insert on `signature_audit_events` for each row
begin
  if new.`record_id` is not null then
    if (select `tenant_id` from `signature_records` where `id` = new.`record_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: signature_audit_events.record_id';
    end if;
  end if;
end;

create trigger `xt_signature_audit_events_record_update`
before update on `signature_audit_events` for each row
begin
  if new.`record_id` is not null then
    if (select `tenant_id` from `signature_records` where `id` = new.`record_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: signature_audit_events.record_id';
    end if;
  end if;
end;

create trigger `xt_signature_records_audit_certificate_document_insert`
before insert on `signature_records` for each row
begin
  if new.`audit_certificate_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`audit_certificate_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: signature_records.audit_certificate_document_id';
    end if;
  end if;
end;

create trigger `xt_signature_records_audit_certificate_document_update`
before update on `signature_records` for each row
begin
  if new.`audit_certificate_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`audit_certificate_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: signature_records.audit_certificate_document_id';
    end if;
  end if;
end;

create trigger `xt_signature_records_signed_document_insert`
before insert on `signature_records` for each row
begin
  if new.`signed_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`signed_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: signature_records.signed_document_id';
    end if;
  end if;
end;

create trigger `xt_signature_records_signed_document_update`
before update on `signature_records` for each row
begin
  if new.`signed_document_id` is not null then
    if (select `tenant_id` from `documents` where `id` = new.`signed_document_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: signature_records.signed_document_id';
    end if;
  end if;
end;

create trigger `xt_tracking_sessions_driver_insert`
before insert on `tracking_sessions` for each row
begin
  if new.`driver_id` is not null then
    if (select `tenant_id` from `drivers` where `id` = new.`driver_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: tracking_sessions.driver_id';
    end if;
  end if;
end;

create trigger `xt_tracking_sessions_driver_update`
before update on `tracking_sessions` for each row
begin
  if new.`driver_id` is not null then
    if (select `tenant_id` from `drivers` where `id` = new.`driver_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: tracking_sessions.driver_id';
    end if;
  end if;
end;

create trigger `xt_tracking_sessions_truck_insert`
before insert on `tracking_sessions` for each row
begin
  if new.`truck_id` is not null then
    if (select `tenant_id` from `trucks` where `id` = new.`truck_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: tracking_sessions.truck_id';
    end if;
  end if;
end;

create trigger `xt_tracking_sessions_truck_update`
before update on `tracking_sessions` for each row
begin
  if new.`truck_id` is not null then
    if (select `tenant_id` from `trucks` where `id` = new.`truck_id`) <> new.`tenant_id` then
      signal sqlstate '45000' set message_text = 'cross-tenant: tracking_sessions.truck_id';
    end if;
  end if;
end;
