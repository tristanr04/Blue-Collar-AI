CREATE TABLE IF NOT EXISTS referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_user_unique
  ON referral_codes (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_unique
  ON referral_codes (code);

CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id uuid NOT NULL REFERENCES referral_codes(id) ON DELETE RESTRICT,
  referrer_user_id text NOT NULL,
  referred_user_id text,
  attribution_token_hash text NOT NULL,
  anonymous_visitor_id_hash text,
  current_status text NOT NULL DEFAULT 'link_visited',
  reward_status text NOT NULL DEFAULT 'not_eligible',
  first_visit_at timestamptz NOT NULL DEFAULT now(),
  attribution_expires_at timestamptz NOT NULL,
  signup_started_at timestamptz,
  account_created_at timestamptz,
  onboarding_completed_at timestamptz,
  first_scan_at timestamptz,
  dashboard_reached_at timestamptz,
  activated_at timestamptz,
  subscription_started_at timestamptz,
  canceled_at timestamptz,
  invalidated_at timestamptz,
  invalid_reason text,
  visible_to_referrer boolean NOT NULL DEFAULT true,
  suspicious_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  attribution_source text NOT NULL DEFAULT 'referral_link',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_no_self_referral CHECK (
    referred_user_id IS NULL OR referred_user_id <> referrer_user_id
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS referrals_attribution_token_unique
  ON referrals (attribution_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_user_unique
  ON referrals (referred_user_id)
  WHERE referred_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS referrals_referrer_status_idx
  ON referrals (referrer_user_id, current_status);
CREATE INDEX IF NOT EXISTS referrals_code_idx
  ON referrals (referral_code_id);

CREATE TABLE IF NOT EXISTS referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  idempotency_key text NOT NULL,
  actor_user_id text,
  source text NOT NULL DEFAULT 'api',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_events_idempotency_unique
  ON referral_events (idempotency_key);
CREATE INDEX IF NOT EXISTS referral_events_timeline_idx
  ON referral_events (referral_id, occurred_at);

CREATE TABLE IF NOT EXISTS referral_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id text NOT NULL,
  referral_code_id uuid NOT NULL REFERENCES referral_codes(id) ON DELETE RESTRICT,
  normalized_email_hash text NOT NULL,
  masked_email text NOT NULL,
  status text NOT NULL DEFAULT 'created',
  provider_message_id text,
  sent_at timestamptz,
  accepted_at timestamptz,
  activated_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_invitations_duplicate_unique
  ON referral_invitations (referrer_user_id, normalized_email_hash);
CREATE INDEX IF NOT EXISTS referral_invitations_referrer_status_idx
  ON referral_invitations (referrer_user_id, status);
