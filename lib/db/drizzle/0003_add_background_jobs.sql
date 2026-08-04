CREATE TABLE IF NOT EXISTS "background_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "job_type" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "idempotency_key" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result" jsonb,
  "error_code" text,
  "error_message" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "locked_by" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "background_jobs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS "background_jobs_user_key_unique"
  ON "background_jobs" USING btree ("user_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "background_jobs_ready_idx"
  ON "background_jobs" USING btree ("status", "available_at");
CREATE INDEX IF NOT EXISTS "background_jobs_user_created_idx"
  ON "background_jobs" USING btree ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "background_jobs_lock_idx"
  ON "background_jobs" USING btree ("locked_at", "status");
