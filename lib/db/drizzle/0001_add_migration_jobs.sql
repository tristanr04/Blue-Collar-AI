CREATE TABLE "migration_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "idempotency_key" varchar(64) NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "result" jsonb DEFAULT null,
  "error_message" text,
  "record_counts" jsonb DEFAULT '{}',
  "committed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "migration_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "migration_jobs_user_key_unique" ON "migration_jobs" ("user_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "migration_jobs_user_status_idx" ON "migration_jobs" ("user_id", "status");
