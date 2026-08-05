CREATE TABLE IF NOT EXISTS financial_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'command_center',
  cash numeric(14,2) NOT NULL DEFAULT 0,
  monthly_take_home numeric(14,2) NOT NULL DEFAULT 0,
  monthly_expenses numeric(14,2) NOT NULL DEFAULT 0,
  total_debt numeric(14,2) NOT NULL DEFAULT 0,
  high_interest_debt numeric(14,2) NOT NULL DEFAULT 0,
  investments numeric(14,2) NOT NULL DEFAULT 0,
  retirement numeric(14,2) NOT NULL DEFAULT 0,
  credit_utilization numeric(6,2) NOT NULL DEFAULT 0,
  health_score integer,
  net_worth numeric(14,2),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_snapshots_user_captured_idx
  ON financial_snapshots (clerk_user_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS financial_memory_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL,
  memory_type text NOT NULL CHECK (memory_type IN ('goal','commitment','life_event','preference','milestone')),
  title text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','dismissed','paused')),
  current_value numeric(14,2),
  target_value numeric(14,2),
  unit text,
  due_date date,
  source_document_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_memory_user_status_idx
  ON financial_memory_records (clerk_user_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS financial_memory_active_identity_idx
  ON financial_memory_records (clerk_user_id, memory_type, lower(title))
  WHERE status IN ('active','paused');

CREATE TABLE IF NOT EXISTS financial_wins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL,
  win_type text NOT NULL,
  title text NOT NULL,
  detail text,
  amount numeric(14,2),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  fingerprint text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clerk_user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS financial_wins_user_occurred_idx
  ON financial_wins (clerk_user_id, occurred_at DESC);
