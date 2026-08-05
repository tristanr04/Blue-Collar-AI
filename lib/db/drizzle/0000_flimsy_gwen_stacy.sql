CREATE TYPE "public"."asset_type" AS ENUM('Cash', 'Investment', 'Other');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('Pending Review', 'Processed', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('pending', 'confirmed', 'reverted', 'failed');--> statement-breakpoint
CREATE TABLE "ai_usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"operation" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" double precision,
	"succeeded" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "asset_type" NOT NULL,
	"value" double precision DEFAULT 0 NOT NULL,
	"institution_name" text,
	"account_type" text,
	"last_four" text,
	"source_document_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"provider_normalized" text,
	"amount" double precision DEFAULT 0 NOT NULL,
	"due_day" integer DEFAULT 1 NOT NULL,
	"is_auto_pay" boolean DEFAULT false NOT NULL,
	"source_document_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"institution_name" text,
	"account_type" text,
	"last_four" text,
	"balance" double precision DEFAULT 0 NOT NULL,
	"interest_rate" double precision DEFAULT 0 NOT NULL,
	"minimum_payment" double precision DEFAULT 0 NOT NULL,
	"credit_limit" double precision,
	"is_revolving" boolean DEFAULT false NOT NULL,
	"source_document_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"destination_section" text NOT NULL,
	"record_id" uuid NOT NULL,
	"match_score" integer NOT NULL,
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"import_job_id" uuid NOT NULL,
	"destination_section" text NOT NULL,
	"record_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"user_confirmed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"reverted_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paystubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"employer" text DEFAULT '' NOT NULL,
	"pay_date" timestamp with time zone NOT NULL,
	"regular_hours" double precision DEFAULT 0 NOT NULL,
	"overtime_hours" double precision DEFAULT 0 NOT NULL,
	"double_time_hours" double precision DEFAULT 0 NOT NULL,
	"per_diem" double precision DEFAULT 0 NOT NULL,
	"bonus" double precision DEFAULT 0 NOT NULL,
	"gross_pay" double precision DEFAULT 0 NOT NULL,
	"net_pay" double precision DEFAULT 0 NOT NULL,
	"taxes" double precision DEFAULT 0 NOT NULL,
	"deductions" double precision DEFAULT 0 NOT NULL,
	"source_document_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"pay_frequency" text DEFAULT 'Weekly' NOT NULL,
	"hourly_rate" double precision DEFAULT 0 NOT NULL,
	"filing_context" text DEFAULT 'Single' NOT NULL,
	"has_completed_onboarding" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scanned_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_fingerprint" text NOT NULL,
	"mime_type" text NOT NULL,
	"document_type" text DEFAULT 'Unknown' NOT NULL,
	"status" "document_status" DEFAULT 'Pending Review' NOT NULL,
	"classification_confidence" integer,
	"institution_normalized" text,
	"extraction_metadata" jsonb,
	"security_warnings" jsonb DEFAULT '[]'::jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"accepted_ai_disclosure_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_account_links" ADD CONSTRAINT "document_account_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_account_links" ADD CONSTRAINT "document_account_links_document_id_scanned_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."scanned_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_changes" ADD CONSTRAINT "financial_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_changes" ADD CONSTRAINT "financial_changes_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_document_id_scanned_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."scanned_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paystubs" ADD CONSTRAINT "paystubs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scanned_documents" ADD CONSTRAINT "scanned_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_user_created_idx" ON "ai_usage_records" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "assets_user_active_idx" ON "assets" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "assets_user_institution_idx" ON "assets" USING btree ("user_id","institution_name");--> statement-breakpoint
CREATE INDEX "assets_user_last_four_idx" ON "assets" USING btree ("user_id","last_four");--> statement-breakpoint
CREATE INDEX "bills_user_active_idx" ON "bills" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "debts_user_active_idx" ON "debts" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "debts_user_institution_idx" ON "debts" USING btree ("user_id","institution_name");--> statement-breakpoint
CREATE INDEX "debts_user_last_four_idx" ON "debts" USING btree ("user_id","last_four");--> statement-breakpoint
CREATE UNIQUE INDEX "document_account_link_unique" ON "document_account_links" USING btree ("user_id","document_id","destination_section","record_id");--> statement-breakpoint
CREATE INDEX "financial_changes_import_idx" ON "financial_changes" USING btree ("import_job_id");--> statement-breakpoint
CREATE INDEX "import_jobs_user_status_idx" ON "import_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "paystubs_user_date_idx" ON "paystubs" USING btree ("user_id","pay_date");--> statement-breakpoint
CREATE INDEX "paystubs_user_active_idx" ON "paystubs" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_user_id_unique" ON "profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_user_fingerprint_unique" ON "scanned_documents" USING btree ("user_id","file_fingerprint");--> statement-breakpoint
CREATE INDEX "documents_user_status_idx" ON "scanned_documents" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_preferences_user_unique" ON "user_preferences" USING btree ("user_id");