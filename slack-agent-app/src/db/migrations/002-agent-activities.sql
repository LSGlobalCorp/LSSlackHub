-- Migration 002: Agent Activities Pipeline
-- Adds tables for activity tracking and Google Sheets integration

-- Agent activity records (interpreted from Slack messages)
CREATE TABLE IF NOT EXISTS agent_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_slack_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('answer', 'transfer', 'escalation', 'hold', 'other')),
  channel_slack_id TEXT NOT NULL,
  customer_context TEXT,
  notes TEXT,
  raw_message TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, channel_slack_id, message_ts)
);

CREATE INDEX IF NOT EXISTS idx_agent_activities_workspace ON agent_activities(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_activities_agent ON agent_activities(agent_slack_id);
CREATE INDEX IF NOT EXISTS idx_agent_activities_created ON agent_activities(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_activities_date ON agent_activities((created_at::date));

-- Google OAuth tokens for Sheets integration
CREATE TABLE IF NOT EXISTS google_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  sheet_id TEXT,
  token_expiry TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
