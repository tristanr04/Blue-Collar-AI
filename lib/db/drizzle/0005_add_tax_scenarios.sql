-- Tax Scenarios table: stores user-saved tax estimate scenarios.
-- Inputs and results are stored as JSONB so future schema changes to the
-- tax engine can be made without requiring additional migrations.

CREATE TABLE IF NOT EXISTS "tax_scenarios" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"    text NOT NULL,
  "name"       text NOT NULL,
  "tax_year"   integer NOT NULL DEFAULT 2026,
  "inputs"     jsonb NOT NULL,
  "result"     jsonb NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tax_scenarios_user_id_users_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_scenarios_user_idx"
  ON "tax_scenarios" USING btree ("user_id", "deleted_at");
