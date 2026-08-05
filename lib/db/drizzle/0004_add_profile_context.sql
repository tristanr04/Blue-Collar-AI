CREATE TABLE IF NOT EXISTS "profile_context" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "birth_date" date,
  "state_code" varchar(2),
  "tax_filing_status" text DEFAULT 'Single' NOT NULL,
  "qualifying_children" integer DEFAULT 0 NOT NULL,
  "other_dependents" integer DEFAULT 0 NOT NULL,
  "spouse_has_income" boolean DEFAULT false NOT NULL,
  "additional_annual_income" integer DEFAULT 0 NOT NULL,
  "annual_pre_tax_deductions" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "profile_context_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "profile_context_state_code_check"
    CHECK ("state_code" IS NULL OR "state_code" IN (
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
    )),
  CONSTRAINT "profile_context_dependents_check"
    CHECK ("qualifying_children" BETWEEN 0 AND 20 AND "other_dependents" BETWEEN 0 AND 20),
  CONSTRAINT "profile_context_nonnegative_tax_inputs_check"
    CHECK ("additional_annual_income" >= 0 AND "annual_pre_tax_deductions" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "profile_context_user_unique"
  ON "profile_context" USING btree ("user_id");
