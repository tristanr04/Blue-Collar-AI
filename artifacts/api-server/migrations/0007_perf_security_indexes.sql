-- Migration 0007: Performance & security indexes
-- Adds missing indexes identified in Phase 2 audit.
-- All indexes use IF NOT EXISTS for safe re-runs.

-- ── financial_changes: user_id for per-user history queries ──────────────────
CREATE INDEX IF NOT EXISTS financial_changes_user_id_idx
  ON financial_changes (user_id);

-- ── financial_changes: composite for timeline / import-job lookups ────────────
CREATE INDEX IF NOT EXISTS financial_changes_user_created_idx
  ON financial_changes (user_id, created_at DESC);

-- ── document_account_links: user_id for per-user link queries ─────────────────
CREATE INDEX IF NOT EXISTS document_account_links_user_id_idx
  ON document_account_links (user_id);

-- ── scanned_documents: user_id + deleted_at for active-doc queries ────────────
CREATE INDEX IF NOT EXISTS scanned_documents_user_deleted_idx
  ON scanned_documents (user_id, deleted_at)
  WHERE deleted_at IS NULL;

-- ── financial_goals: user_id + deleted_at (active goals are the hot path) ─────
CREATE INDEX IF NOT EXISTS financial_goals_user_deleted_idx
  ON financial_goals (user_id, deleted_at)
  WHERE deleted_at IS NULL;

-- ── debt_payoff_plans: user_id + status composite ─────────────────────────────
CREATE INDEX IF NOT EXISTS debt_payoff_plans_user_deleted_idx
  ON debt_payoff_plans (user_id, status)
  WHERE status = 'active';

-- ── users: deleted_at for soft-delete sweeps ──────────────────────────────────
CREATE INDEX IF NOT EXISTS users_deleted_at_idx
  ON users (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ── referrals: referred_user_id for reverse-chain queries (circular check) ────
CREATE INDEX IF NOT EXISTS referrals_referred_user_id_idx
  ON referrals (referred_user_id);

-- ── referral_invitations: referrer + status for per-user dashboard queries ────
CREATE INDEX IF NOT EXISTS referral_invitations_referrer_status_idx
  ON referral_invitations (referrer_user_id, status);

-- ── subscription_usage: idempotency_key for dedup lookups ────────────────────
CREATE INDEX IF NOT EXISTS subscription_usage_idempotency_idx
  ON subscription_usage (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── workspace_memberships: user_id for "all workspaces I belong to" queries ───
CREATE INDEX IF NOT EXISTS workspace_memberships_user_id_idx
  ON workspace_memberships (user_id)
  WHERE status = 'active';

-- ── timeline_events: user_id + event_date (DESC) for recent-history queries ───
-- (event_date index exists; add DESC variant for ORDER BY event_date DESC)
CREATE INDEX IF NOT EXISTS timeline_events_user_date_desc_idx
  ON timeline_events (user_id, event_date DESC);

-- ── ai_usage_records: user_id + created_at DESC for recent usage queries ──────
-- (exists per schema but ensure it covers DESC ordering)
CREATE INDEX IF NOT EXISTS ai_usage_records_user_created_desc_idx
  ON ai_usage_records (user_id, created_at DESC);
