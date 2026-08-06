-- ─────────────────────────────────────────────────────────────────────────────
-- 0006 — Financial Goals, Debt Payoff Plans, and Business Workspaces
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Financial Goals ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS financial_goals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  title       text        NOT NULL,
  description text,
  category    text        NOT NULL DEFAULT 'savings',
  -- emergency_fund | savings | debt_payoff | investment | purchase | other
  target_amount  numeric(14,2) NOT NULL DEFAULT 0,
  current_amount numeric(14,2) NOT NULL DEFAULT 0,
  target_date    date,
  status      text        NOT NULL DEFAULT 'active',
  -- active | completed | paused | archived
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS financial_goals_user_status_idx
  ON financial_goals (user_id, status);

-- ─── Debt Payoff Plans ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS debt_payoff_plans (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              text        NOT NULL,
  name                 text        NOT NULL,
  strategy             text        NOT NULL DEFAULT 'avalanche',
  -- avalanche | snowball | utilization | custom
  extra_monthly_payment numeric(14,2) NOT NULL DEFAULT 0,
  custom_order         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- array of debt IDs ordered by user-defined priority (for custom strategy)
  status               text        NOT NULL DEFAULT 'active',
  -- active | completed | archived
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS debt_payoff_plans_user_status_idx
  ON debt_payoff_plans (user_id, status);

-- ─── Business Workspaces ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspaces (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id  text        NOT NULL,
  name      text        NOT NULL,
  plan      text        NOT NULL DEFAULT 'business',
  max_seats integer     NOT NULL DEFAULT 5,
  status    text        NOT NULL DEFAULT 'active',
  -- active | suspended | archived
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspaces_owner_idx
  ON workspaces (owner_id);

-- ─── Workspace Memberships ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspace_memberships (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       text,
  role          text        NOT NULL DEFAULT 'member',
  -- owner | admin | member
  status        text        NOT NULL DEFAULT 'active',
  -- active | invited | removed
  invited_email text,
  invited_at    timestamptz,
  joined_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_memberships_workspace_user_unique
  ON workspace_memberships (workspace_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS workspace_memberships_workspace_idx
  ON workspace_memberships (workspace_id);

CREATE INDEX IF NOT EXISTS workspace_memberships_user_idx
  ON workspace_memberships (user_id)
  WHERE user_id IS NOT NULL;

-- ─── Workspace Invitations ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  inviter_user_id  text        NOT NULL,
  email            text        NOT NULL,
  role             text        NOT NULL DEFAULT 'member',
  token_hash       text        NOT NULL,
  status           text        NOT NULL DEFAULT 'pending',
  -- pending | accepted | expired | revoked
  expires_at       timestamptz NOT NULL,
  accepted_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_token_hash_unique
  ON workspace_invitations (token_hash);

CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_idx
  ON workspace_invitations (workspace_id, status);
