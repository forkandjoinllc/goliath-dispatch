CREATE TYPE "public"."appointment_type" AS ENUM('exact', 'window', 'fcfs', 'open');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('auth.login', 'auth.login_failed', 'auth.logout', 'auth.password_reset_requested', 'auth.password_reset_completed', 'auth.email_verified', 'auth.mfa_enrolled', 'auth.mfa_challenge_failed', 'auth.session_revoked', 'auth.account_locked', 'impersonation.started', 'impersonation.ended', 'permission.changed', 'role.changed', 'tenant.created', 'tenant.updated', 'tenant.suspended', 'tenant.reactivated', 'tenant.accessed', 'document.viewed', 'document.downloaded', 'document.uploaded', 'document.approved', 'document.rejected', 'document.deleted', 'verification.override', 'onboarding.status_changed', 'load.created', 'load.status_changed', 'load.assignment_changed', 'load.cancelled', 'load.duplicated', 'financial.changed', 'expense.approved', 'expense.rejected', 'invoice.created', 'invoice.sent', 'invoice.status_changed', 'payment.recorded', 'payment.failed', 'payment.refunded', 'signature.requested', 'signature.viewed', 'signature.signed', 'signature.declined', 'signature.voided', 'export.created', 'export.downloaded', 'retention.archived', 'retention.purged', 'legal_hold.applied', 'legal_hold.released', 'settings.updated', 'integration.updated', 'tracking.consent_changed', 'security.rate_limited');--> statement-breakpoint
CREATE TYPE "public"."commission_basis" AS ENUM('dispatch_fee_amount', 'carrier_gross_rate', 'commissionable_base');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('privacy_policy', 'terms_and_conditions', 'electronic_signature', 'sms', 'tracking_location');--> statement-breakpoint
CREATE TYPE "public"."document_review_status" AS ENUM('pending', 'in_review', 'approved', 'rejected', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('certificate_of_authority', 'certificate_of_insurance', 'w9', 'notice_of_assignment', 'change_of_payee', 'carrier_agreement', 'other_onboarding', 'truck_registration', 'trailer_registration', 'annual_inspection', 'equipment_photo', 'equipment_video', 'cdl_front', 'cdl_back', 'medical_card', 'driver_other', 'bol', 'pod', 'rate_confirmation', 'permit', 'escort_document', 'route_survey', 'receipt', 'invoice', 'lumper_receipt', 'scale_ticket', 'other');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('available', 'on_load', 'off_duty', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."equipment_status" AS ENUM('pending_verification', 'active', 'out_of_service', 'archived');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('submitted', 'approved', 'rejected', 'reimbursed');--> statement-breakpoint
CREATE TYPE "public"."expense_treatment" AS ENUM('excluded_from_commission', 'reimbursable_to_carrier', 'tenant_absorbed', 'carrier_deduction');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'due', 'paid', 'overdue', 'disputed', 'voided', 'uncollectable');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."load_status" AS ENUM('draft', 'available', 'assigned', 'dispatched', 'en_route_to_pickup', 'at_pickup', 'in_transit', 'at_delivery', 'delivered', 'pod_received', 'invoiced', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('en', 'es');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'read', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."onboarding_status" AS ENUM('draft', 'submitted', 'under_review', 'corrections_required', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'ach', 'check', 'wire', 'cash', 'offset', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'disputed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('platform_super_admin', 'admin', 'accounting', 'dispatcher', 'carrier', 'driver');--> statement-breakpoint
CREATE TYPE "public"."signature_method" AS ENUM('drawn', 'typed');--> statement-breakpoint
CREATE TYPE "public"."signature_status" AS ENUM('pending', 'viewed', 'signed', 'declined', 'expired', 'voided', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."us_state" AS ENUM('AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'PR');--> statement-breakpoint
CREATE TYPE "public"."stop_type" AS ENUM('pickup', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'suspended', 'cancelled', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('provisioning', 'trialing', 'active', 'past_due', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tracking_event_type" AS ENUM('session_started', 'consent_granted', 'consent_revoked', 'location_update', 'geofence_enter', 'geofence_exit', 'arrived_pickup', 'departed_pickup', 'arrived_delivery', 'departed_delivery', 'stopped', 'session_ended', 'error');--> statement-breakpoint
CREATE TYPE "public"."tracking_provider" AS ENUM('mock', 'trucker_tools', 'macropoint', 'highway', 'manual');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'pending_verification', 'active', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('not_started', 'pending', 'verified', 'mismatch', 'failed', 'manually_overridden', 'expired');--> statement-breakpoint
CREATE TABLE "equipment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"label_en" varchar(120) NOT NULL,
	"label_es" varchar(120) NOT NULL,
	"category" varchar(20) DEFAULT 'trailer' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"supports_rgn" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "saas_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_es" varchar(120) NOT NULL,
	"description_en" text,
	"description_es" text,
	"monthly_price_cents" bigint NOT NULL,
	"stripe_price_id" varchar(255),
	"stripe_product_id" varchar(255),
	"trial_days" integer DEFAULT 14 NOT NULL,
	"max_users" integer,
	"max_carriers" integer,
	"max_loads_per_month" integer,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "tenant_branding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"logo_storage_key" text,
	"logo_dark_storage_key" text,
	"favicon_storage_key" text,
	"primary_color" varchar(9) DEFAULT '#062B5C' NOT NULL,
	"accent_color" varchar(9) DEFAULT '#FF5A00' NOT NULL,
	"neutral_color" varchar(9) DEFAULT '#9B9B9B' NOT NULL,
	"surface_color" varchar(9) DEFAULT '#FFFFFF' NOT NULL,
	"ink_color" varchar(9) DEFAULT '#111827' NOT NULL,
	"heading_font" varchar(80) DEFAULT 'Roboto Condensed' NOT NULL,
	"body_font" varchar(80) DEFAULT 'Inter' NOT NULL,
	"email_header_html" text,
	"email_footer_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_phone" varchar(32),
	"contact_email" varchar(255),
	"support_email" varchar(255),
	"address_line1" varchar(200),
	"address_line2" varchar(200),
	"address_city" varchar(120),
	"address_state" varchar(2),
	"address_postal_code" varchar(12),
	"address_country" varchar(2) DEFAULT 'US',
	"business_hours" jsonb,
	"social_links" jsonb,
	"document_expiration_warning_days" integer DEFAULT 30 NOT NULL,
	"fmcsa_reverification_days" integer DEFAULT 7 NOT NULL,
	"allow_dispatcher_resource_assignment" boolean DEFAULT false NOT NULL,
	"require_oversize_admin_validation" boolean DEFAULT true NOT NULL,
	"load_number_prefix" varchar(12) DEFAULT 'GD' NOT NULL,
	"load_number_next_sequence" integer DEFAULT 1000 NOT NULL,
	"invoice_number_prefix" varchar(12) DEFAULT 'INV' NOT NULL,
	"invoice_number_next_sequence" integer DEFAULT 1000 NOT NULL,
	"default_payment_terms_days" integer DEFAULT 30 NOT NULL,
	"default_carrier_dispatch_fee_bps" integer DEFAULT 1000 NOT NULL,
	"default_dispatcher_commission_bps" integer DEFAULT 2500 NOT NULL,
	"dispatcher_commission_basis" "commission_basis" DEFAULT 'dispatch_fee_amount' NOT NULL,
	"operational_active_months" integer DEFAULT 24 NOT NULL,
	"operational_purge_years_after_archive" integer DEFAULT 5 NOT NULL,
	"financial_retention_years" integer DEFAULT 7 NOT NULL,
	"public_tracking_enabled" boolean DEFAULT true NOT NULL,
	"public_tracking_token_ttl_hours" integer DEFAULT 72 NOT NULL,
	"signature_consent_copy" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"past_due_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(63) NOT NULL,
	"legal_name" varchar(200) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"status" "tenant_status" DEFAULT 'provisioning' NOT NULL,
	"custom_domain" varchar(255),
	"custom_domain_verified_at" timestamp with time zone,
	"default_locale" "locale" DEFAULT 'en' NOT NULL,
	"default_timezone" varchar(64) DEFAULT 'America/New_York' NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"provisioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"subject_email" varchar(255),
	"consent_type" "consent_type" NOT NULL,
	"policy_version" varchar(40) NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impersonation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"session_id" uuid,
	"ip_address" varchar(45),
	"user_agent" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_normalized" varchar(255) NOT NULL,
	"ip_address" varchar(45),
	"successful" boolean NOT NULL,
	"failure_reason" varchar(60),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method" varchar(20) DEFAULT 'totp' NOT NULL,
	"secret_encrypted" text NOT NULL,
	"recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(120) NOT NULL,
	"resource" varchar(60) NOT NULL,
	"action" varchar(60) NOT NULL,
	"description_en" text NOT NULL,
	"description_es" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_key" varchar(255) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "role" NOT NULL,
	"permission_id" uuid NOT NULL,
	"scope" varchar(20) DEFAULT 'tenant' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"active_tenant_id" uuid,
	"ip_address" varchar(45),
	"user_agent" text,
	"mfa_satisfied_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"effect" varchar(8) NOT NULL,
	"scope" varchar(20) DEFAULT 'tenant' NOT NULL,
	"reason" text NOT NULL,
	"granted_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "user_tenant_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"carrier_id" uuid,
	"driver_id" uuid,
	"is_primary_contact" boolean DEFAULT false NOT NULL,
	"invited_by_user_id" uuid,
	"invited_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_normalized" varchar(255) NOT NULL,
	"password_hash" text,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"phone" varchar(32),
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/New_York' NOT NULL,
	"avatar_storage_key" text,
	"status" "user_status" DEFAULT 'pending_verification' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"is_platform_super_admin" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(45),
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"tenant_id" uuid,
	"purpose" varchar(40) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"email" varchar(255),
	"payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_dispatcher_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"dispatcher_user_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"start_date" timestamp with time zone DEFAULT now() NOT NULL,
	"end_date" timestamp with time zone,
	"assigned_by_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "carrier_onboarding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"onboarding_id" uuid NOT NULL,
	"from_status" "onboarding_status",
	"to_status" "onboarding_status" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_onboardings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"status" "onboarding_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"review_started_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"corrections_requested_at" timestamp with time zone,
	"correction_notes" text,
	"rejection_reason" text,
	"required_document_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"title" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_name" varchar(200) NOT NULL,
	"dba" varchar(200),
	"dot_number" varchar(12) NOT NULL,
	"mc_number" varchar(12),
	"ein_encrypted" text,
	"ein_last4" varchar(4),
	"contact_first_name" varchar(100) NOT NULL,
	"contact_last_name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(32) NOT NULL,
	"website" varchar(255),
	"preferred_locale" "locale" DEFAULT 'en' NOT NULL,
	"physical_line1" varchar(200),
	"physical_line2" varchar(200),
	"physical_city" varchar(120),
	"physical_state" varchar(2),
	"physical_postal_code" varchar(12),
	"physical_country" varchar(2) DEFAULT 'US',
	"physical_place_id" varchar(255),
	"mailing_same_as_physical" boolean DEFAULT true NOT NULL,
	"mailing_line1" varchar(200),
	"mailing_line2" varchar(200),
	"mailing_city" varchar(120),
	"mailing_state" varchar(2),
	"mailing_postal_code" varchar(12),
	"mailing_country" varchar(2) DEFAULT 'US',
	"dispatch_fee_bps" integer DEFAULT 1000 NOT NULL,
	"onboarding_status" "onboarding_status" DEFAULT 'draft' NOT NULL,
	"fmcsa_status" "verification_status" DEFAULT 'not_started' NOT NULL,
	"fmcsa_last_verified_at" timestamp with time zone,
	"fmcsa_next_verification_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"uses_factoring" boolean DEFAULT false NOT NULL,
	"notes" text,
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatcher_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"owner_dispatcher_user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "dispatcher_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"commission_bps" integer DEFAULT 2500 NOT NULL,
	"employee_code" varchar(40),
	"hired_on" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "dispatcher_resource_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dispatcher_user_id" uuid NOT NULL,
	"resource_type" varchar(20) NOT NULL,
	"resource_id" uuid NOT NULL,
	"start_date" timestamp with time zone DEFAULT now() NOT NULL,
	"end_date" timestamp with time zone,
	"assigned_by_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "factoring_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"factoring_company_id" uuid NOT NULL,
	"verification_status" "verification_status" DEFAULT 'not_started' NOT NULL,
	"notice_of_assignment_document_id" uuid,
	"change_of_payee_document_id" uuid,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factoring_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"contact_name" varchar(200),
	"email" varchar(255),
	"phone" varchar(32),
	"address_line1" varchar(200),
	"address_city" varchar(120),
	"address_state" varchar(2),
	"address_postal_code" varchar(12),
	"funding_instructions" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "fmcsa_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"provider" varchar(40) DEFAULT 'mock' NOT NULL,
	"dot_number" varchar(12) NOT NULL,
	"mc_number" varchar(12),
	"status" "verification_status" NOT NULL,
	"normalized" jsonb,
	"mismatches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_reference" text,
	"raw_payload_digest" varchar(64),
	"attempt" integer DEFAULT 1 NOT NULL,
	"error_message" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"overridden_by_user_id" uuid,
	"override_reason" text,
	"overridden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"member_type" varchar(20) NOT NULL,
	"member_id" uuid NOT NULL,
	"added_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "document_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid,
	"user_id" uuid,
	"action" varchar(20) NOT NULL,
	"watermarked" boolean DEFAULT false NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_expirations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"expiration_date" timestamp with time zone NOT NULL,
	"warning_days" integer NOT NULL,
	"kind" varchar(12) NOT NULL,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"status" "document_review_status" NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"notes" text,
	"rejection_reason" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"page_count" integer,
	"malware_scan_status" varchar(20) DEFAULT 'not_scanned' NOT NULL,
	"malware_scan_at" timestamp with time zone,
	"extraction" jsonb,
	"extraction_status" varchar(20) DEFAULT 'not_started' NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"owner_type" varchar(20) NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" varchar(200),
	"description" text,
	"current_version_id" uuid,
	"review_status" "document_review_status" DEFAULT 'pending' NOT NULL,
	"issue_date" timestamp with time zone,
	"expiration_date" timestamp with time zone,
	"is_required" boolean DEFAULT false NOT NULL,
	"expires_soon_at" timestamp with time zone,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_type" varchar(10) NOT NULL,
	"equipment_id" uuid NOT NULL,
	"angle" varchar(20) NOT NULL,
	"media_kind" varchar(10) DEFAULT 'photo' NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"caption" varchar(200),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_type" varchar(10) NOT NULL,
	"equipment_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"coi_document_id" uuid,
	"coi_document_version_id" uuid,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"extracted_vins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_vin" varchar(17),
	"ocr_provider" varchar(40),
	"ocr_confidence" integer,
	"media_count" integer DEFAULT 0 NOT NULL,
	"blocking_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overridden_by_user_id" uuid,
	"override_reason" text,
	"overridden_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trailers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"unit_number" varchar(40) NOT NULL,
	"vin" varchar(17) NOT NULL,
	"vin_normalized" varchar(17) NOT NULL,
	"year" integer,
	"make" varchar(60),
	"model" varchar(60),
	"equipment_type_id" uuid,
	"plate_number" varchar(20),
	"plate_state" varchar(2),
	"length_inches" integer,
	"width_inches" integer,
	"deck_height_inches" integer,
	"well_length_inches" integer,
	"capacity_pounds" integer,
	"axle_count" integer,
	"axle_configuration" varchar(60),
	"removable_gooseneck" boolean DEFAULT false NOT NULL,
	"is_extendable" boolean DEFAULT false NOT NULL,
	"status" "equipment_status" DEFAULT 'pending_verification' NOT NULL,
	"registration_number" varchar(60),
	"registration_expires_at" timestamp with time zone,
	"last_inspection_at" timestamp with time zone,
	"next_inspection_due_at" timestamp with time zone,
	"last_maintenance_at" timestamp with time zone,
	"next_maintenance_due_at" timestamp with time zone,
	"coi_verification_status" "verification_status" DEFAULT 'not_started' NOT NULL,
	"out_of_service_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"unit_number" varchar(40) NOT NULL,
	"vin" varchar(17) NOT NULL,
	"vin_normalized" varchar(17) NOT NULL,
	"year" integer,
	"make" varchar(60),
	"model" varchar(60),
	"equipment_type_id" uuid,
	"plate_number" varchar(20),
	"plate_state" varchar(2),
	"status" "equipment_status" DEFAULT 'pending_verification' NOT NULL,
	"vin_decode_source" varchar(40),
	"vin_decoded_at" timestamp with time zone,
	"registration_number" varchar(60),
	"registration_expires_at" timestamp with time zone,
	"last_inspection_at" timestamp with time zone,
	"next_inspection_due_at" timestamp with time zone,
	"last_maintenance_at" timestamp with time zone,
	"next_maintenance_due_at" timestamp with time zone,
	"coi_verification_status" "verification_status" DEFAULT 'not_started' NOT NULL,
	"out_of_service_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_carrier_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"start_date" timestamp with time zone DEFAULT now() NOT NULL,
	"end_date" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"date_of_birth" date,
	"email" varchar(255),
	"phone" varchar(32),
	"preferred_locale" "locale" DEFAULT 'en' NOT NULL,
	"license_state" varchar(2),
	"license_number_encrypted" text,
	"license_number_last4" varchar(4),
	"license_number_hash" varchar(64),
	"cdl_class" varchar(4),
	"endorsements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"restrictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"license_expires_at" timestamp with time zone,
	"medical_card_expires_at" timestamp with time zone,
	"status" "driver_status" DEFAULT 'available' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'not_started' NOT NULL,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"verification_notes" text,
	"tracking_consent_granted_at" timestamp with time zone,
	"sms_consent_granted_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_contact_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"email" varchar(255),
	"phone" varchar(32),
	"phone_extension" varchar(10),
	"position" varchar(120),
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "customer_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"line1" varchar(200),
	"line2" varchar(200),
	"city" varchar(120),
	"state" varchar(2),
	"postal_code" varchar(12),
	"country" varchar(2) DEFAULT 'US',
	"latitude" text,
	"longitude" text,
	"place_id" varchar(255),
	"timezone" varchar(64),
	"phone" varchar(32),
	"hours" varchar(200),
	"instructions" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_name" varchar(200) NOT NULL,
	"company_name_normalized" varchar(200) NOT NULL,
	"dot_number" varchar(12),
	"mc_number" varchar(12),
	"website" varchar(255),
	"phone" varchar(32),
	"phone_normalized" varchar(20),
	"email" varchar(255),
	"email_normalized" varchar(255),
	"physical_line1" varchar(200),
	"physical_line2" varchar(200),
	"physical_city" varchar(120),
	"physical_state" varchar(2),
	"physical_postal_code" varchar(12),
	"physical_place_id" varchar(255),
	"billing_same_as_physical" boolean DEFAULT true NOT NULL,
	"billing_line1" varchar(200),
	"billing_line2" varchar(200),
	"billing_city" varchar(120),
	"billing_state" varchar(2),
	"billing_postal_code" varchar(12),
	"tax_id_encrypted" text,
	"tax_id_last4" varchar(4),
	"credit_limit_cents" bigint,
	"credit_approved" boolean DEFAULT false NOT NULL,
	"credit_notes" text,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"uses_factoring" boolean DEFAULT false NOT NULL,
	"factoring_company_name" varchar(200),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"notes" text,
	"duplicate_override_by_user_id" uuid,
	"duplicate_override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"origin" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"location_summary" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "load_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"resource_type" varchar(10) NOT NULL,
	"truck_id" uuid,
	"trailer_id" uuid,
	"driver_id" uuid,
	"is_primary" boolean DEFAULT false NOT NULL,
	"committed_from" timestamp with time zone,
	"committed_to" timestamp with time zone,
	"assigned_by_user_id" uuid,
	"unassigned_at" timestamp with time zone,
	"unassigned_reason" text,
	"compliance_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "load_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"stop_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "load_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"from_status" "load_status",
	"to_status" "load_status" NOT NULL,
	"actor_user_id" uuid,
	"source" varchar(24) DEFAULT 'user' NOT NULL,
	"source_reference" varchar(120),
	"notes" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "load_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"stop_type" "stop_type" NOT NULL,
	"sequence" integer NOT NULL,
	"facility_name" varchar(200),
	"customer_location_id" uuid,
	"line1" varchar(200),
	"line2" varchar(200),
	"city" varchar(120),
	"state" varchar(2),
	"postal_code" varchar(12),
	"country" varchar(2) DEFAULT 'US',
	"latitude" text,
	"longitude" text,
	"place_id" varchar(255),
	"timezone" varchar(64) DEFAULT 'America/New_York' NOT NULL,
	"contact_name" varchar(200),
	"contact_phone" varchar(32),
	"contact_email" varchar(255),
	"confirmation_number" varchar(80),
	"instructions" text,
	"appointment_type" "appointment_type" DEFAULT 'window' NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"planned_arrival_at" timestamp with time zone,
	"actual_arrival_at" timestamp with time zone,
	"actual_departure_at" timestamp with time zone,
	"detention_minutes" integer,
	"detention_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_number" varchar(40) NOT NULL,
	"customer_reference" varchar(80),
	"po_number" varchar(80),
	"customer_id" uuid NOT NULL,
	"customer_contact_id" uuid,
	"carrier_id" uuid,
	"carrier_locked_at" timestamp with time zone,
	"dispatcher_user_id" uuid,
	"status" "load_status" DEFAULT 'draft' NOT NULL,
	"commodity" varchar(200),
	"weight_pounds" integer,
	"length_inches" integer,
	"width_inches" integer,
	"height_inches" integer,
	"piece_count" integer,
	"required_equipment_type_id" uuid,
	"is_oversize" boolean DEFAULT false NOT NULL,
	"is_overweight" boolean DEFAULT false NOT NULL,
	"axle_configuration" varchar(60),
	"gross_vehicle_weight_pounds" integer,
	"customer_charge_cents" bigint DEFAULT 0 NOT NULL,
	"carrier_gross_rate_cents" bigint DEFAULT 0 NOT NULL,
	"carrier_dispatch_fee_bps" integer DEFAULT 1000 NOT NULL,
	"dispatcher_commission_bps" integer DEFAULT 2500 NOT NULL,
	"dispatcher_commission_basis" "commission_basis" DEFAULT 'dispatch_fee_amount' NOT NULL,
	"miles" integer,
	"deadhead_miles" integer,
	"special_instructions" text,
	"internal_notes" text,
	"planned_pickup_at" timestamp with time zone,
	"planned_delivery_at" timestamp with time zone,
	"actual_pickup_at" timestamp with time zone,
	"actual_delivery_at" timestamp with time zone,
	"pod_received_at" timestamp with time zone,
	"permit_ready_approved_by_user_id" uuid,
	"permit_ready_approved_at" timestamp with time zone,
	"oversize_validated_by_user_id" uuid,
	"oversize_validated_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"duplicated_from_load_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_confirmation_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"decision" varchar(20) NOT NULL,
	"decision_reason" text,
	"actor_user_id" uuid NOT NULL,
	"document_sha256" varchar(64) NOT NULL,
	"rated_amount_cents" bigint,
	"ip_address" varchar(45),
	"user_agent" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"escort_type" varchar(20) NOT NULL,
	"state_code" varchar(2),
	"provider_name" varchar(200),
	"contact_name" varchar(200),
	"contact_phone" varchar(32),
	"contact_email" varchar(255),
	"agency_name" varchar(200),
	"scheduled_for" timestamp with time zone,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"document_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oversize_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"route_id" uuid,
	"outcome" varchar(30) NOT NULL,
	"permit_likely_required" boolean DEFAULT false NOT NULL,
	"escort_likely_required" boolean DEFAULT false NOT NULL,
	"police_escort_likely_required" boolean DEFAULT false NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_data_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"human_validation_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"validated_by_user_id" uuid,
	"validated_at" timestamp with time zone,
	"validation_notes" text,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oversize_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"state_code" varchar(2) NOT NULL,
	"max_width_inches" integer DEFAULT 102 NOT NULL,
	"max_height_inches" integer DEFAULT 162 NOT NULL,
	"max_length_inches" integer DEFAULT 636 NOT NULL,
	"max_gross_weight_pounds" integer DEFAULT 80000 NOT NULL,
	"max_axle_weight_pounds" integer DEFAULT 20000 NOT NULL,
	"escort_width_threshold_inches" integer,
	"escort_height_threshold_inches" integer,
	"escort_length_threshold_inches" integer,
	"police_escort_width_threshold_inches" integer,
	"travel_restrictions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"permit_required_above_legal" boolean DEFAULT true NOT NULL,
	"permit_authority_name" varchar(200),
	"permit_authority_url" varchar(255),
	"source_note" text,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "permits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"state_code" varchar(2) NOT NULL,
	"permit_number" varchar(80),
	"permit_type" varchar(60),
	"issued_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"document_id" uuid,
	"route_survey_document_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"state_code" varchar(2) NOT NULL,
	"sequence" integer NOT NULL,
	"miles_in_state" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"provider" varchar(40) DEFAULT 'mock' NOT NULL,
	"total_miles" integer,
	"estimated_duration_minutes" integer,
	"estimated_toll_cents" bigint,
	"polyline" text,
	"legs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_reference" text,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "carrier_settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"load_id" uuid,
	"financial_snapshot_id" uuid,
	"description_en" varchar(255) NOT NULL,
	"description_es" varchar(255),
	"gross_rate_cents" bigint DEFAULT 0 NOT NULL,
	"reimbursements_cents" bigint DEFAULT 0 NOT NULL,
	"dispatch_fee_cents" bigint DEFAULT 0 NOT NULL,
	"deductions_cents" bigint DEFAULT 0 NOT NULL,
	"net_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "carrier_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"settlement_number" varchar(40) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"gross_rate_cents" bigint DEFAULT 0 NOT NULL,
	"reimbursements_cents" bigint DEFAULT 0 NOT NULL,
	"dispatch_fees_cents" bigint DEFAULT 0 NOT NULL,
	"deductions_cents" bigint DEFAULT 0 NOT NULL,
	"net_amount_cents" bigint DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"factoring_company_id" uuid,
	"factoring_submitted_at" timestamp with time zone,
	"pdf_document_id" uuid,
	"issued_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatcher_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"dispatcher_user_id" uuid NOT NULL,
	"financial_snapshot_id" uuid NOT NULL,
	"basis" "commission_basis" NOT NULL,
	"basis_amount_cents" bigint NOT NULL,
	"percentage_bps" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" varchar(20) DEFAULT 'accrued' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"label_en" varchar(120) NOT NULL,
	"label_es" varchar(120) NOT NULL,
	"treatment" "expense_treatment" DEFAULT 'tenant_absorbed' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"requires_receipt" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid,
	"carrier_id" uuid,
	"category_id" uuid NOT NULL,
	"treatment_snapshot" "expense_treatment" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"description" text,
	"incurred_on" timestamp with time zone,
	"receipt_document_id" uuid,
	"status" "expense_status" DEFAULT 'submitted' NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"customer_charge_cents" bigint NOT NULL,
	"carrier_gross_rate_cents" bigint NOT NULL,
	"carrier_dispatch_fee_bps" integer NOT NULL,
	"dispatcher_commission_bps" integer NOT NULL,
	"dispatcher_commission_basis" "commission_basis" NOT NULL,
	"approved_excluded_expenses_cents" bigint DEFAULT 0 NOT NULL,
	"approved_reimbursable_expenses_cents" bigint DEFAULT 0 NOT NULL,
	"tenant_absorbed_expenses_cents" bigint DEFAULT 0 NOT NULL,
	"carrier_deductions_cents" bigint DEFAULT 0 NOT NULL,
	"commissionable_base_cents" bigint NOT NULL,
	"dispatch_fee_amount_cents" bigint NOT NULL,
	"net_carrier_settlement_cents" bigint NOT NULL,
	"gross_margin_cents" bigint NOT NULL,
	"dispatcher_commission_amount_cents" bigint NOT NULL,
	"expense_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"formula_version" varchar(20) DEFAULT 'v1' NOT NULL,
	"reason" varchar(120),
	"computed_by_user_id" uuid,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"load_id" uuid,
	"sequence" integer DEFAULT 0 NOT NULL,
	"description_en" varchar(255) NOT NULL,
	"description_es" varchar(255),
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_cents" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"kind" varchar(20) DEFAULT 'dispatch_fee' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_number" varchar(40) NOT NULL,
	"carrier_id" uuid NOT NULL,
	"customer_id" uuid,
	"load_id" uuid,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"adjustments_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"amount_paid_cents" bigint DEFAULT 0 NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"issue_date" timestamp with time zone,
	"due_date" timestamp with time zone,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"disputed_at" timestamp with time zone,
	"dispute_reason" text,
	"uncollectable_at" timestamp with time zone,
	"pdf_document_id" uuid,
	"stripe_invoice_id" varchar(255),
	"stripe_payment_intent_id" varchar(255),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_id" uuid,
	"method" "payment_method" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "payment_status" NOT NULL,
	"failure_code" varchar(80),
	"failure_message" text,
	"idempotency_key" varchar(120),
	"provider_reference" varchar(255),
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"reference" varchar(120),
	"stripe_payment_intent_id" varchar(255),
	"stripe_charge_id" varchar(255),
	"received_at" timestamp with time zone,
	"refunded_amount_cents" bigint DEFAULT 0 NOT NULL,
	"refunded_at" timestamp with time zone,
	"disputed_at" timestamp with time zone,
	"dispute_reason" text,
	"recorded_by_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"stripe_event_id" varchar(255) NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"api_version" varchar(40),
	"processing_status" varchar(20) DEFAULT 'received' NOT NULL,
	"payload_digest" varchar(64),
	"payload" jsonb,
	"processed_at" timestamp with time zone,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"record_id" uuid,
	"event_type" varchar(40) NOT NULL,
	"actor_user_id" uuid,
	"actor_email" varchar(255),
	"ip_address" varchar(45),
	"user_agent" text,
	"detail" jsonb,
	"previous_event_hash" varchar(64),
	"event_hash" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"signer_user_id" uuid,
	"signer_legal_name" varchar(200) NOT NULL,
	"signer_email" varchar(255) NOT NULL,
	"signer_title" varchar(120),
	"method" "signature_method" NOT NULL,
	"signature_storage_key" text NOT NULL,
	"signature_sha256" varchar(64) NOT NULL,
	"typed_name_value" varchar(200),
	"consent_accepted" boolean NOT NULL,
	"consent_copy_hash" varchar(64) NOT NULL,
	"document_sha256" varchar(64) NOT NULL,
	"signed_document_id" uuid,
	"audit_certificate_document_id" uuid,
	"integrity_seal" varchar(64) NOT NULL,
	"seal_algorithm" varchar(40) DEFAULT 'HMAC-SHA256' NOT NULL,
	"ip_address" varchar(45) NOT NULL,
	"user_agent" text NOT NULL,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"template_content_hash" varchar(64) NOT NULL,
	"subject_type" varchar(20) NOT NULL,
	"subject_id" uuid NOT NULL,
	"carrier_id" uuid,
	"signer_user_id" uuid,
	"signer_email" varchar(255) NOT NULL,
	"signer_legal_name" varchar(200),
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"status" "signature_status" DEFAULT 'pending' NOT NULL,
	"token_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"access_token_hash" varchar(64),
	"requested_by_user_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_viewed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"expires_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"superseded_by_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_key" varchar(60) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title_en" varchar(200) NOT NULL,
	"title_es" varchar(200) NOT NULL,
	"body_en" text NOT NULL,
	"body_es" text NOT NULL,
	"consent_copy_en" text NOT NULL,
	"consent_copy_es" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"required_tokens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"last_read_at" timestamp with time zone,
	"muted_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject" varchar(200),
	"load_id" uuid,
	"carrier_id" uuid,
	"kind" varchar(20) DEFAULT 'direct' NOT NULL,
	"is_operational" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" uuid,
	"origin" varchar(12) DEFAULT 'user' NOT NULL,
	"body" text NOT NULL,
	"system_key" varchar(80),
	"system_params" jsonb,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_key" varchar(80) NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_key" varchar(80) NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"locale" "locale" NOT NULL,
	"subject" varchar(255),
	"body" text NOT NULL,
	"available_tokens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_key" varchar(80) NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"action_url" varchar(500),
	"subject_type" varchar(30),
	"subject_id" uuid,
	"dedupe_key" varchar(200),
	"provider_message_id" varchar(255),
	"failure_reason" text,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" varchar(30) NOT NULL,
	"provider" varchar(40) NOT NULL,
	"display_name" varchar(120),
	"enabled" boolean DEFAULT false NOT NULL,
	"credentials_encrypted" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health_status" varchar(20) DEFAULT 'unknown' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "public_tracking_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"label" varchar(120),
	"recipient_email" varchar(255),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text
);
--> statement-breakpoint
CREATE TABLE "tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"provider" "tracking_provider" NOT NULL,
	"event_type" "tracking_event_type" NOT NULL,
	"latitude" text,
	"longitude" text,
	"speed_mph" integer,
	"heading_degrees" integer,
	"location_label" varchar(200),
	"stop_id" uuid,
	"raw_provider_reference" varchar(255),
	"raw_payload" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"driver_id" uuid,
	"truck_id" uuid,
	"provider" "tracking_provider" DEFAULT 'mock' NOT NULL,
	"provider_session_id" varchar(255),
	"consent_granted_at" timestamp with time zone,
	"consent_revoked_at" timestamp with time zone,
	"consent_user_id" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"health_status" varchar(20) DEFAULT 'unknown' NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_latitude" text,
	"last_longitude" text,
	"last_location_label" varchar(200),
	"route_progress_percent" integer,
	"remaining_miles" integer,
	"eta_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_user_id" uuid,
	"actor_email" varchar(255),
	"actor_role" varchar(40),
	"effective_user_id" uuid,
	"impersonation_session_id" uuid,
	"action" "audit_action" NOT NULL,
	"entity_type" varchar(60),
	"entity_id" uuid,
	"entity_label" varchar(200),
	"before_summary" jsonb,
	"after_summary" jsonb,
	"reason" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"request_id" varchar(64),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"report_key" varchar(60) NOT NULL,
	"format" varchar(10) NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope_snapshot" jsonb,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"row_count" integer,
	"storage_key" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"downloaded_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"scope" varchar(60) NOT NULL,
	"key" varchar(200) NOT NULL,
	"request_digest" varchar(64),
	"response_snapshot" jsonb,
	"status" varchar(20) DEFAULT 'in_progress' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"job_type" varchar(60) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"locked_by" varchar(80),
	"locked_until" timestamp with time zone,
	"dedupe_key" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(32),
	"company_name" varchar(200),
	"dot_number" varchar(12),
	"mc_number" varchar(12),
	"message" text,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"source" varchar(40) DEFAULT 'contact_form' NOT NULL,
	"source_path" varchar(255),
	"utm" jsonb,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"assigned_to_user_id" uuid,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"reason" text NOT NULL,
	"scope_type" varchar(20) DEFAULT 'tenant' NOT NULL,
	"entity_type" varchar(60),
	"entity_id" uuid,
	"matter_reference" varchar(120),
	"applied_by_user_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by_user_id" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"lead_id" uuid,
	"contact_name" varchar(200) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(32),
	"company_name" varchar(200),
	"commodity" varchar(200),
	"weight_pounds" integer,
	"length_inches" integer,
	"width_inches" integer,
	"height_inches" integer,
	"origin_city" varchar(120),
	"origin_state" varchar(2),
	"destination_city" varchar(120),
	"destination_state" varchar(2),
	"ready_date" timestamp with time zone,
	"equipment_preference" varchar(80),
	"is_oversize_suspected" boolean DEFAULT false NOT NULL,
	"notes" text,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"archived_at" timestamp with time zone,
	"purge_eligible_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action" varchar(20) NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"skipped_legal_hold_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipment_types" ADD CONSTRAINT "equipment_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_id_saas_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."saas_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_configurations" ADD CONSTRAINT "mfa_configurations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_tenant_id_tenants_id_fk" FOREIGN KEY ("active_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant_memberships" ADD CONSTRAINT "user_tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant_memberships" ADD CONSTRAINT "user_tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_dispatcher_assignments" ADD CONSTRAINT "carrier_dispatcher_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_dispatcher_assignments" ADD CONSTRAINT "carrier_dispatcher_assignments_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_dispatcher_assignments" ADD CONSTRAINT "carrier_dispatcher_assignments_dispatcher_user_id_users_id_fk" FOREIGN KEY ("dispatcher_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_dispatcher_assignments" ADD CONSTRAINT "carrier_dispatcher_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_onboarding_events" ADD CONSTRAINT "carrier_onboarding_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_onboarding_events" ADD CONSTRAINT "carrier_onboarding_events_onboarding_id_carrier_onboardings_id_fk" FOREIGN KEY ("onboarding_id") REFERENCES "public"."carrier_onboardings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_onboarding_events" ADD CONSTRAINT "carrier_onboarding_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_onboardings" ADD CONSTRAINT "carrier_onboardings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_onboardings" ADD CONSTRAINT "carrier_onboardings_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_onboardings" ADD CONSTRAINT "carrier_onboardings_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_users" ADD CONSTRAINT "carrier_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_users" ADD CONSTRAINT "carrier_users_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_users" ADD CONSTRAINT "carrier_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_groups" ADD CONSTRAINT "dispatcher_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_groups" ADD CONSTRAINT "dispatcher_groups_owner_dispatcher_user_id_users_id_fk" FOREIGN KEY ("owner_dispatcher_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_profiles" ADD CONSTRAINT "dispatcher_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_profiles" ADD CONSTRAINT "dispatcher_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_resource_assignments" ADD CONSTRAINT "dispatcher_resource_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_resource_assignments" ADD CONSTRAINT "dispatcher_resource_assignments_dispatcher_user_id_users_id_fk" FOREIGN KEY ("dispatcher_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_resource_assignments" ADD CONSTRAINT "dispatcher_resource_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factoring_assignments" ADD CONSTRAINT "factoring_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factoring_assignments" ADD CONSTRAINT "factoring_assignments_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factoring_assignments" ADD CONSTRAINT "factoring_assignments_factoring_company_id_factoring_companies_id_fk" FOREIGN KEY ("factoring_company_id") REFERENCES "public"."factoring_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factoring_assignments" ADD CONSTRAINT "factoring_assignments_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factoring_companies" ADD CONSTRAINT "factoring_companies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcsa_verifications" ADD CONSTRAINT "fmcsa_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcsa_verifications" ADD CONSTRAINT "fmcsa_verifications_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcsa_verifications" ADD CONSTRAINT "fmcsa_verifications_overridden_by_user_id_users_id_fk" FOREIGN KEY ("overridden_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_dispatcher_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."dispatcher_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_expirations" ADD CONSTRAINT "document_expirations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_expirations" ADD CONSTRAINT "document_expirations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_media" ADD CONSTRAINT "equipment_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_media" ADD CONSTRAINT "equipment_media_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_verifications" ADD CONSTRAINT "equipment_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_verifications" ADD CONSTRAINT "equipment_verifications_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_verifications" ADD CONSTRAINT "equipment_verifications_coi_document_id_documents_id_fk" FOREIGN KEY ("coi_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_verifications" ADD CONSTRAINT "equipment_verifications_overridden_by_user_id_users_id_fk" FOREIGN KEY ("overridden_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trailers" ADD CONSTRAINT "trailers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trailers" ADD CONSTRAINT "trailers_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trailers" ADD CONSTRAINT "trailers_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_carrier_relationships" ADD CONSTRAINT "driver_carrier_relationships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_carrier_relationships" ADD CONSTRAINT "driver_carrier_relationships_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_carrier_relationships" ADD CONSTRAINT "driver_carrier_relationships_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_carrier_relationships" ADD CONSTRAINT "driver_carrier_relationships_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contact_locations" ADD CONSTRAINT "customer_contact_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contact_locations" ADD CONSTRAINT "customer_contact_locations_contact_id_customer_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."customer_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contact_locations" ADD CONSTRAINT "customer_contact_locations_location_id_customer_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."customer_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_duplicate_override_by_user_id_users_id_fk" FOREIGN KEY ("duplicate_override_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_calls" ADD CONSTRAINT "check_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_calls" ADD CONSTRAINT "check_calls_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_calls" ADD CONSTRAINT "check_calls_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_assignments" ADD CONSTRAINT "load_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_assignments" ADD CONSTRAINT "load_assignments_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_assignments" ADD CONSTRAINT "load_assignments_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_assignments" ADD CONSTRAINT "load_assignments_trailer_id_trailers_id_fk" FOREIGN KEY ("trailer_id") REFERENCES "public"."trailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_assignments" ADD CONSTRAINT "load_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_assignments" ADD CONSTRAINT "load_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_stop_id_load_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."load_stops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_status_history" ADD CONSTRAINT "load_status_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_status_history" ADD CONSTRAINT "load_status_history_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_status_history" ADD CONSTRAINT "load_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_stops" ADD CONSTRAINT "load_stops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_stops" ADD CONSTRAINT "load_stops_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_stops" ADD CONSTRAINT "load_stops_customer_location_id_customer_locations_id_fk" FOREIGN KEY ("customer_location_id") REFERENCES "public"."customer_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_customer_contact_id_customer_contacts_id_fk" FOREIGN KEY ("customer_contact_id") REFERENCES "public"."customer_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_dispatcher_user_id_users_id_fk" FOREIGN KEY ("dispatcher_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_required_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("required_equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_permit_ready_approved_by_user_id_users_id_fk" FOREIGN KEY ("permit_ready_approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_oversize_validated_by_user_id_users_id_fk" FOREIGN KEY ("oversize_validated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_confirmation_acceptances" ADD CONSTRAINT "rate_confirmation_acceptances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_confirmation_acceptances" ADD CONSTRAINT "rate_confirmation_acceptances_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_confirmation_acceptances" ADD CONSTRAINT "rate_confirmation_acceptances_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_confirmation_acceptances" ADD CONSTRAINT "rate_confirmation_acceptances_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_confirmation_acceptances" ADD CONSTRAINT "rate_confirmation_acceptances_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_confirmation_acceptances" ADD CONSTRAINT "rate_confirmation_acceptances_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escorts" ADD CONSTRAINT "escorts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escorts" ADD CONSTRAINT "escorts_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escorts" ADD CONSTRAINT "escorts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oversize_evaluations" ADD CONSTRAINT "oversize_evaluations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oversize_evaluations" ADD CONSTRAINT "oversize_evaluations_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oversize_evaluations" ADD CONSTRAINT "oversize_evaluations_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oversize_evaluations" ADD CONSTRAINT "oversize_evaluations_validated_by_user_id_users_id_fk" FOREIGN KEY ("validated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oversize_rules" ADD CONSTRAINT "oversize_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_route_survey_document_id_documents_id_fk" FOREIGN KEY ("route_survey_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_states" ADD CONSTRAINT "route_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_states" ADD CONSTRAINT "route_states_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_settlement_lines" ADD CONSTRAINT "carrier_settlement_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_settlement_lines" ADD CONSTRAINT "carrier_settlement_lines_settlement_id_carrier_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."carrier_settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_settlement_lines" ADD CONSTRAINT "carrier_settlement_lines_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_settlement_lines" ADD CONSTRAINT "carrier_settlement_lines_financial_snapshot_id_financial_snapshots_id_fk" FOREIGN KEY ("financial_snapshot_id") REFERENCES "public"."financial_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_settlements" ADD CONSTRAINT "carrier_settlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_settlements" ADD CONSTRAINT "carrier_settlements_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_settlements" ADD CONSTRAINT "carrier_settlements_factoring_company_id_factoring_companies_id_fk" FOREIGN KEY ("factoring_company_id") REFERENCES "public"."factoring_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_settlements" ADD CONSTRAINT "carrier_settlements_pdf_document_id_documents_id_fk" FOREIGN KEY ("pdf_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_commissions" ADD CONSTRAINT "dispatcher_commissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_commissions" ADD CONSTRAINT "dispatcher_commissions_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_commissions" ADD CONSTRAINT "dispatcher_commissions_dispatcher_user_id_users_id_fk" FOREIGN KEY ("dispatcher_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_commissions" ADD CONSTRAINT "dispatcher_commissions_financial_snapshot_id_financial_snapshots_id_fk" FOREIGN KEY ("financial_snapshot_id") REFERENCES "public"."financial_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receipt_document_id_documents_id_fk" FOREIGN KEY ("receipt_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_computed_by_user_id_users_id_fk" FOREIGN KEY ("computed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pdf_document_id_documents_id_fk" FOREIGN KEY ("pdf_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD CONSTRAINT "stripe_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_audit_events" ADD CONSTRAINT "signature_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_audit_events" ADD CONSTRAINT "signature_audit_events_request_id_signature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signature_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_audit_events" ADD CONSTRAINT "signature_audit_events_record_id_signature_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."signature_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_audit_events" ADD CONSTRAINT "signature_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_records" ADD CONSTRAINT "signature_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_records" ADD CONSTRAINT "signature_records_request_id_signature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signature_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_records" ADD CONSTRAINT "signature_records_signer_user_id_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_records" ADD CONSTRAINT "signature_records_signed_document_id_documents_id_fk" FOREIGN KEY ("signed_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_records" ADD CONSTRAINT "signature_records_audit_certificate_document_id_documents_id_fk" FOREIGN KEY ("audit_certificate_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_template_id_signature_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."signature_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_signer_user_id_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_templates" ADD CONSTRAINT "signature_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_tracking_links" ADD CONSTRAINT "public_tracking_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_tracking_links" ADD CONSTRAINT "public_tracking_links_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_tracking_links" ADD CONSTRAINT "public_tracking_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_session_id_tracking_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tracking_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_consent_user_id_users_id_fk" FOREIGN KEY ("consent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_effective_user_id_users_id_fk" FOREIGN KEY ("effective_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_queue" ADD CONSTRAINT "job_queue_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_jobs" ADD CONSTRAINT "retention_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_types_tenant_code_uq" ON "equipment_types" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "equipment_types_tenant_idx" ON "equipment_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saas_plans_code_uq" ON "saas_plans" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_branding_tenant_uq" ON "tenant_branding" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_settings_tenant_uq" ON "tenant_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_subscriptions_tenant_idx" ON "tenant_subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_subscriptions_stripe_sub_uq" ON "tenant_subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "tenant_subscriptions_status_idx" ON "tenant_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_uq" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_custom_domain_uq" ON "tenants" USING btree ("custom_domain");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "consent_records_user_type_idx" ON "consent_records" USING btree ("user_id","consent_type");--> statement-breakpoint
CREATE INDEX "consent_records_tenant_idx" ON "consent_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "impersonation_actor_idx" ON "impersonation_sessions" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "impersonation_target_idx" ON "impersonation_sessions" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "impersonation_tenant_idx" ON "impersonation_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "login_attempts_email_created_idx" ON "login_attempts" USING btree ("email_normalized","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_created_idx" ON "login_attempts" USING btree ("ip_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_configurations_user_method_uq" ON "mfa_configurations" USING btree ("user_id","method");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_uq" ON "permissions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "permissions_resource_idx" ON "permissions" USING btree ("resource");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_buckets_key_window_uq" ON "rate_limit_buckets" USING btree ("bucket_key","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_uq" ON "role_permissions" USING btree ("role","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_permission_overrides_uq" ON "user_permission_overrides" USING btree ("tenant_id","user_id","permission_id");--> statement-breakpoint
CREATE INDEX "user_permission_overrides_tenant_user_idx" ON "user_permission_overrides" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_role_uq" ON "user_tenant_memberships" USING btree ("tenant_id","user_id","role");--> statement-breakpoint
CREATE INDEX "memberships_tenant_idx" ON "user_tenant_memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "user_tenant_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_tenant_role_idx" ON "user_tenant_memberships" USING btree ("tenant_id","role");--> statement-breakpoint
CREATE INDEX "memberships_carrier_idx" ON "user_tenant_memberships" USING btree ("carrier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_uq" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_platform_admin_idx" ON "users" USING btree ("is_platform_super_admin");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_hash_uq" ON "verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verification_tokens_user_purpose_idx" ON "verification_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "verification_tokens_expires_idx" ON "verification_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "carrier_dispatcher_tenant_idx" ON "carrier_dispatcher_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "carrier_dispatcher_carrier_idx" ON "carrier_dispatcher_assignments" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX "carrier_dispatcher_user_idx" ON "carrier_dispatcher_assignments" USING btree ("dispatcher_user_id");--> statement-breakpoint
CREATE INDEX "carrier_dispatcher_active_idx" ON "carrier_dispatcher_assignments" USING btree ("tenant_id","dispatcher_user_id","end_date");--> statement-breakpoint
CREATE INDEX "carrier_onboarding_events_onboarding_idx" ON "carrier_onboarding_events" USING btree ("onboarding_id");--> statement-breakpoint
CREATE INDEX "carrier_onboardings_tenant_idx" ON "carrier_onboardings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "carrier_onboardings_tenant_status_idx" ON "carrier_onboardings" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_onboardings_carrier_uq" ON "carrier_onboardings" USING btree ("carrier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_users_uq" ON "carrier_users" USING btree ("tenant_id","carrier_id","user_id");--> statement-breakpoint
CREATE INDEX "carrier_users_tenant_idx" ON "carrier_users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "carrier_users_user_idx" ON "carrier_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carriers_tenant_dot_uq" ON "carriers" USING btree ("tenant_id","dot_number");--> statement-breakpoint
CREATE INDEX "carriers_tenant_idx" ON "carriers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "carriers_tenant_status_idx" ON "carriers" USING btree ("tenant_id","onboarding_status");--> statement-breakpoint
CREATE INDEX "carriers_tenant_mc_idx" ON "carriers" USING btree ("tenant_id","mc_number");--> statement-breakpoint
CREATE INDEX "carriers_legal_name_idx" ON "carriers" USING btree ("tenant_id","legal_name");--> statement-breakpoint
CREATE INDEX "carriers_next_verification_idx" ON "carriers" USING btree ("fmcsa_next_verification_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatcher_groups_tenant_name_uq" ON "dispatcher_groups" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "dispatcher_groups_tenant_idx" ON "dispatcher_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatcher_profiles_tenant_user_uq" ON "dispatcher_profiles" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "dispatcher_profiles_tenant_idx" ON "dispatcher_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "dispatcher_resource_tenant_idx" ON "dispatcher_resource_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "dispatcher_resource_user_idx" ON "dispatcher_resource_assignments" USING btree ("tenant_id","dispatcher_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatcher_resource_uq" ON "dispatcher_resource_assignments" USING btree ("tenant_id","dispatcher_user_id","resource_type","resource_id","start_date");--> statement-breakpoint
CREATE INDEX "factoring_assignments_tenant_idx" ON "factoring_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "factoring_assignments_carrier_idx" ON "factoring_assignments" USING btree ("carrier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "factoring_companies_tenant_name_uq" ON "factoring_companies" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "factoring_companies_tenant_idx" ON "factoring_companies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "fmcsa_verifications_tenant_idx" ON "fmcsa_verifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "fmcsa_verifications_carrier_idx" ON "fmcsa_verifications" USING btree ("carrier_id","checked_at");--> statement-breakpoint
CREATE INDEX "fmcsa_verifications_dot_idx" ON "fmcsa_verifications" USING btree ("dot_number");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_uq" ON "group_members" USING btree ("group_id","member_type","member_id");--> statement-breakpoint
CREATE INDEX "group_members_tenant_idx" ON "group_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "group_members_lookup_idx" ON "group_members" USING btree ("tenant_id","member_type","member_id");--> statement-breakpoint
CREATE INDEX "document_access_logs_tenant_idx" ON "document_access_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_access_logs_document_idx" ON "document_access_logs" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_expirations_uq" ON "document_expirations" USING btree ("document_id","kind","expiration_date");--> statement-breakpoint
CREATE INDEX "document_expirations_tenant_idx" ON "document_expirations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_expirations_unresolved_idx" ON "document_expirations" USING btree ("tenant_id","resolved_at");--> statement-breakpoint
CREATE INDEX "document_reviews_tenant_idx" ON "document_reviews" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_reviews_document_idx" ON "document_reviews" USING btree ("document_id","reviewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_version_uq" ON "document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE INDEX "document_versions_tenant_idx" ON "document_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_versions_sha_idx" ON "document_versions" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE INDEX "documents_tenant_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("tenant_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("tenant_id","document_type");--> statement-breakpoint
CREATE INDEX "documents_review_status_idx" ON "documents" USING btree ("tenant_id","review_status");--> statement-breakpoint
CREATE INDEX "documents_expiration_idx" ON "documents" USING btree ("tenant_id","expiration_date");--> statement-breakpoint
CREATE INDEX "documents_expires_soon_idx" ON "documents" USING btree ("expires_soon_at");--> statement-breakpoint
CREATE INDEX "equipment_media_tenant_idx" ON "equipment_media" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_media_owner_idx" ON "equipment_media" USING btree ("tenant_id","equipment_type","equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_verifications_tenant_idx" ON "equipment_verifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "equipment_verifications_equipment_idx" ON "equipment_verifications" USING btree ("tenant_id","equipment_type","equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_verifications_carrier_idx" ON "equipment_verifications" USING btree ("carrier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trailers_tenant_vin_uq" ON "trailers" USING btree ("tenant_id","vin_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "trailers_tenant_carrier_unit_uq" ON "trailers" USING btree ("tenant_id","carrier_id","unit_number");--> statement-breakpoint
CREATE INDEX "trailers_tenant_idx" ON "trailers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "trailers_carrier_idx" ON "trailers" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX "trailers_status_idx" ON "trailers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "trailers_type_idx" ON "trailers" USING btree ("tenant_id","equipment_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trucks_tenant_vin_uq" ON "trucks" USING btree ("tenant_id","vin_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "trucks_tenant_carrier_unit_uq" ON "trucks" USING btree ("tenant_id","carrier_id","unit_number");--> statement-breakpoint
CREATE INDEX "trucks_tenant_idx" ON "trucks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "trucks_carrier_idx" ON "trucks" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX "trucks_status_idx" ON "trucks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "trucks_registration_exp_idx" ON "trucks" USING btree ("tenant_id","registration_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_carrier_uq" ON "driver_carrier_relationships" USING btree ("tenant_id","driver_id","carrier_id","start_date");--> statement-breakpoint
CREATE INDEX "driver_carrier_tenant_idx" ON "driver_carrier_relationships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "driver_carrier_driver_idx" ON "driver_carrier_relationships" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_carrier_carrier_idx" ON "driver_carrier_relationships" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX "drivers_tenant_idx" ON "drivers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "drivers_tenant_status_idx" ON "drivers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "drivers_tenant_name_idx" ON "drivers" USING btree ("tenant_id","last_name","first_name");--> statement-breakpoint
CREATE INDEX "drivers_license_expiry_idx" ON "drivers" USING btree ("tenant_id","license_expires_at");--> statement-breakpoint
CREATE INDEX "drivers_medical_expiry_idx" ON "drivers" USING btree ("tenant_id","medical_card_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_tenant_license_hash_uq" ON "drivers" USING btree ("tenant_id","license_number_hash");--> statement-breakpoint
CREATE INDEX "drivers_user_idx" ON "drivers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_contact_locations_uq" ON "customer_contact_locations" USING btree ("contact_id","location_id");--> statement-breakpoint
CREATE INDEX "customer_contact_locations_tenant_idx" ON "customer_contact_locations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customer_contacts_tenant_idx" ON "customer_contacts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customer_contacts_customer_idx" ON "customer_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_contacts_primary_uq" ON "customer_contacts" USING btree ("customer_id") WHERE is_primary = true and deleted_at is null;--> statement-breakpoint
CREATE INDEX "customer_locations_tenant_idx" ON "customer_locations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customer_locations_customer_idx" ON "customer_locations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_idx" ON "customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_name_idx" ON "customers" USING btree ("tenant_id","company_name_normalized");--> statement-breakpoint
CREATE INDEX "customers_tenant_dot_idx" ON "customers" USING btree ("tenant_id","dot_number");--> statement-breakpoint
CREATE INDEX "customers_tenant_mc_idx" ON "customers" USING btree ("tenant_id","mc_number");--> statement-breakpoint
CREATE INDEX "customers_tenant_phone_idx" ON "customers" USING btree ("tenant_id","phone_normalized");--> statement-breakpoint
CREATE INDEX "customers_tenant_email_idx" ON "customers" USING btree ("tenant_id","email_normalized");--> statement-breakpoint
CREATE INDEX "customers_tenant_status_idx" ON "customers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "check_calls_tenant_idx" ON "check_calls" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "check_calls_load_idx" ON "check_calls" USING btree ("load_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "check_calls_due_idx" ON "check_calls" USING btree ("tenant_id","completed_at","scheduled_for");--> statement-breakpoint
CREATE INDEX "load_assignments_tenant_idx" ON "load_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "load_assignments_load_idx" ON "load_assignments" USING btree ("load_id");--> statement-breakpoint
CREATE INDEX "load_assignments_truck_idx" ON "load_assignments" USING btree ("tenant_id","truck_id","committed_from");--> statement-breakpoint
CREATE INDEX "load_assignments_trailer_idx" ON "load_assignments" USING btree ("tenant_id","trailer_id","committed_from");--> statement-breakpoint
CREATE INDEX "load_assignments_driver_idx" ON "load_assignments" USING btree ("tenant_id","driver_id","committed_from");--> statement-breakpoint
CREATE UNIQUE INDEX "load_assignments_truck_uq" ON "load_assignments" USING btree ("load_id","truck_id") WHERE truck_id is not null and unassigned_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "load_assignments_trailer_uq" ON "load_assignments" USING btree ("load_id","trailer_id") WHERE trailer_id is not null and unassigned_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "load_assignments_driver_uq" ON "load_assignments" USING btree ("load_id","driver_id") WHERE driver_id is not null and unassigned_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "load_documents_uq" ON "load_documents" USING btree ("load_id","document_id");--> statement-breakpoint
CREATE INDEX "load_documents_tenant_idx" ON "load_documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "load_documents_load_type_idx" ON "load_documents" USING btree ("load_id","document_type");--> statement-breakpoint
CREATE INDEX "load_status_history_tenant_idx" ON "load_status_history" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "load_status_history_load_idx" ON "load_status_history" USING btree ("load_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "load_stops_load_sequence_uq" ON "load_stops" USING btree ("load_id","sequence");--> statement-breakpoint
CREATE INDEX "load_stops_tenant_idx" ON "load_stops" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "load_stops_load_idx" ON "load_stops" USING btree ("load_id");--> statement-breakpoint
CREATE INDEX "load_stops_window_idx" ON "load_stops" USING btree ("tenant_id","window_start");--> statement-breakpoint
CREATE INDEX "load_stops_state_idx" ON "load_stops" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "loads_tenant_number_uq" ON "loads" USING btree ("tenant_id","load_number");--> statement-breakpoint
CREATE INDEX "loads_tenant_idx" ON "loads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "loads_tenant_status_idx" ON "loads" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "loads_tenant_customer_idx" ON "loads" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "loads_tenant_carrier_idx" ON "loads" USING btree ("tenant_id","carrier_id");--> statement-breakpoint
CREATE INDEX "loads_tenant_dispatcher_idx" ON "loads" USING btree ("tenant_id","dispatcher_user_id");--> statement-breakpoint
CREATE INDEX "loads_tenant_pickup_idx" ON "loads" USING btree ("tenant_id","planned_pickup_at");--> statement-breakpoint
CREATE INDEX "loads_tenant_delivery_idx" ON "loads" USING btree ("tenant_id","planned_delivery_at");--> statement-breakpoint
CREATE INDEX "loads_tenant_reference_idx" ON "loads" USING btree ("tenant_id","customer_reference");--> statement-breakpoint
CREATE INDEX "loads_oversize_idx" ON "loads" USING btree ("tenant_id","is_oversize");--> statement-breakpoint
CREATE INDEX "rate_confirmation_tenant_idx" ON "rate_confirmation_acceptances" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "rate_confirmation_load_idx" ON "rate_confirmation_acceptances" USING btree ("load_id","decided_at");--> statement-breakpoint
CREATE INDEX "escorts_tenant_idx" ON "escorts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "escorts_load_idx" ON "escorts" USING btree ("load_id");--> statement-breakpoint
CREATE INDEX "oversize_evaluations_tenant_idx" ON "oversize_evaluations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "oversize_evaluations_load_idx" ON "oversize_evaluations" USING btree ("load_id","evaluated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oversize_rules_tenant_state_uq" ON "oversize_rules" USING btree ("tenant_id","state_code");--> statement-breakpoint
CREATE INDEX "oversize_rules_tenant_idx" ON "oversize_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "permits_tenant_idx" ON "permits" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "permits_load_idx" ON "permits" USING btree ("load_id");--> statement-breakpoint
CREATE INDEX "permits_expiry_idx" ON "permits" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "permits_load_state_number_uq" ON "permits" USING btree ("load_id","state_code","permit_number");--> statement-breakpoint
CREATE UNIQUE INDEX "route_states_uq" ON "route_states" USING btree ("route_id","state_code","sequence");--> statement-breakpoint
CREATE INDEX "route_states_tenant_idx" ON "route_states" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "routes_tenant_idx" ON "routes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "routes_load_idx" ON "routes" USING btree ("load_id","calculated_at");--> statement-breakpoint
CREATE INDEX "carrier_settlement_lines_tenant_idx" ON "carrier_settlement_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "carrier_settlement_lines_settlement_idx" ON "carrier_settlement_lines" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_settlements_tenant_number_uq" ON "carrier_settlements" USING btree ("tenant_id","settlement_number");--> statement-breakpoint
CREATE INDEX "carrier_settlements_tenant_idx" ON "carrier_settlements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "carrier_settlements_carrier_idx" ON "carrier_settlements" USING btree ("tenant_id","carrier_id","period_end");--> statement-breakpoint
CREATE INDEX "dispatcher_commissions_tenant_idx" ON "dispatcher_commissions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "dispatcher_commissions_user_idx" ON "dispatcher_commissions" USING btree ("tenant_id","dispatcher_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatcher_commissions_snapshot_uq" ON "dispatcher_commissions" USING btree ("financial_snapshot_id","dispatcher_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_tenant_code_uq" ON "expense_categories" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "expense_categories_tenant_idx" ON "expense_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "expenses_tenant_idx" ON "expenses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "expenses_load_idx" ON "expenses" USING btree ("load_id");--> statement-breakpoint
CREATE INDEX "expenses_carrier_idx" ON "expenses" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX "expenses_status_idx" ON "expenses" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_snapshots_load_version_uq" ON "financial_snapshots" USING btree ("load_id","version");--> statement-breakpoint
CREATE INDEX "financial_snapshots_tenant_idx" ON "financial_snapshots" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "financial_snapshots_load_idx" ON "financial_snapshots" USING btree ("load_id","computed_at");--> statement-breakpoint
CREATE INDEX "invoice_line_items_tenant_idx" ON "invoice_line_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_idx" ON "invoice_line_items" USING btree ("invoice_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_number_uq" ON "invoices" USING btree ("tenant_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_tenant_idx" ON "invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_status_idx" ON "invoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "invoices_carrier_idx" ON "invoices" USING btree ("tenant_id","carrier_id");--> statement-breakpoint
CREATE INDEX "invoices_due_idx" ON "invoices" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "invoices_load_idx" ON "invoices" USING btree ("load_id");--> statement-breakpoint
CREATE INDEX "payment_attempts_tenant_idx" ON "payment_attempts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_attempts_invoice_idx" ON "payment_attempts" USING btree ("invoice_id","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_idempotency_uq" ON "payment_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_tenant_idx" ON "payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_stripe_intent_uq" ON "payments" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_events_event_id_uq" ON "stripe_events" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE INDEX "stripe_events_type_idx" ON "stripe_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "stripe_events_status_idx" ON "stripe_events" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "signature_audit_events_tenant_idx" ON "signature_audit_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "signature_audit_events_request_idx" ON "signature_audit_events" USING btree ("request_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_audit_events_hash_uq" ON "signature_audit_events" USING btree ("event_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_records_request_uq" ON "signature_records" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "signature_records_tenant_idx" ON "signature_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "signature_records_signed_at_idx" ON "signature_records" USING btree ("tenant_id","signed_at");--> statement-breakpoint
CREATE INDEX "signature_requests_tenant_idx" ON "signature_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "signature_requests_subject_idx" ON "signature_requests" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "signature_requests_status_idx" ON "signature_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "signature_requests_carrier_idx" ON "signature_requests" USING btree ("carrier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_requests_token_uq" ON "signature_requests" USING btree ("access_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_templates_tenant_key_version_uq" ON "signature_templates" USING btree ("tenant_id","template_key","version");--> statement-breakpoint
CREATE INDEX "signature_templates_tenant_idx" ON "signature_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "signature_templates_active_idx" ON "signature_templates" USING btree ("tenant_id","template_key","active");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_uq" ON "conversation_participants" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_tenant_idx" ON "conversation_participants" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_user_idx" ON "conversation_participants" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "conversations_tenant_idx" ON "conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "conversations_load_idx" ON "conversations" USING btree ("load_id");--> statement-breakpoint
CREATE INDEX "conversations_last_message_idx" ON "conversations" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX "message_attachments_tenant_idx" ON "message_attachments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "message_attachments_message_idx" ON "message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "messages_tenant_idx" ON "messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_uq" ON "notification_preferences" USING btree ("tenant_id","user_id","event_key");--> statement-breakpoint
CREATE INDEX "notification_preferences_tenant_user_idx" ON "notification_preferences" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_uq" ON "notification_templates" USING btree ("tenant_id","event_key","channel","locale");--> statement-breakpoint
CREATE INDEX "notification_templates_tenant_idx" ON "notification_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notifications_tenant_idx" ON "notifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("tenant_id","user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_event_idx" ON "notifications" USING btree ("tenant_id","event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("dedupe_key","user_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_uq" ON "integration_connections" USING btree ("tenant_id","category","provider");--> statement-breakpoint
CREATE INDEX "integration_connections_tenant_idx" ON "integration_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_tracking_links_token_uq" ON "public_tracking_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "public_tracking_links_tenant_idx" ON "public_tracking_links" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "public_tracking_links_load_idx" ON "public_tracking_links" USING btree ("load_id");--> statement-breakpoint
CREATE INDEX "public_tracking_links_expiry_idx" ON "public_tracking_links" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "tracking_events_tenant_idx" ON "tracking_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tracking_events_session_idx" ON "tracking_events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "tracking_events_load_idx" ON "tracking_events" USING btree ("load_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_events_provider_ref_uq" ON "tracking_events" USING btree ("provider","raw_provider_reference");--> statement-breakpoint
CREATE INDEX "tracking_sessions_tenant_idx" ON "tracking_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tracking_sessions_load_idx" ON "tracking_sessions" USING btree ("load_id");--> statement-breakpoint
CREATE INDEX "tracking_sessions_health_idx" ON "tracking_sessions" USING btree ("tenant_id","health_status");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_sessions_provider_uq" ON "tracking_sessions" USING btree ("provider","provider_session_id");--> statement-breakpoint
CREATE INDEX "audit_events_tenant_idx" ON "audit_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("tenant_id","action","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_request_idx" ON "audit_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "export_jobs_tenant_idx" ON "export_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "export_jobs_user_idx" ON "export_jobs" USING btree ("tenant_id","requested_by_user_id");--> statement-breakpoint
CREATE INDEX "export_jobs_status_idx" ON "export_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_key_uq" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "job_queue_status_runat_idx" ON "job_queue" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "job_queue_type_idx" ON "job_queue" USING btree ("job_type","status");--> statement-breakpoint
CREATE INDEX "job_queue_tenant_idx" ON "job_queue" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_queue_dedupe_uq" ON "job_queue" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "leads_tenant_idx" ON "leads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "legal_holds_tenant_idx" ON "legal_holds" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "legal_holds_active_idx" ON "legal_holds" USING btree ("tenant_id","released_at");--> statement-breakpoint
CREATE INDEX "legal_holds_entity_idx" ON "legal_holds" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "quote_requests_tenant_idx" ON "quote_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "quote_requests_status_idx" ON "quote_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "quote_requests_created_idx" ON "quote_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "retention_jobs_tenant_idx" ON "retention_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "retention_jobs_status_idx" ON "retention_jobs" USING btree ("status","created_at");