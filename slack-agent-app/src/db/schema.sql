-- LS Agent Hub Database Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Workspaces (from OAuth installations)
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_team_id TEXT UNIQUE NOT NULL,
  team_name TEXT NOT NULL,
  encrypted_bot_token TEXT NOT NULL,
  bot_user_id TEXT NOT NULL,
  installed_by TEXT NOT NULL,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_workspaces_team_id ON workspaces(slack_team_id);
CREATE INDEX idx_workspaces_active ON workspaces(is_active) WHERE is_active = true;

-- Synced channels
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_channel_id TEXT NOT NULL,
  name TEXT,
  is_private BOOLEAN DEFAULT false,
  member_count INT DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, slack_channel_id)
);

CREATE INDEX idx_channels_workspace ON channels(workspace_id);

-- Synced users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  is_admin BOOLEAN DEFAULT false,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, slack_user_id)
);

CREATE INDEX idx_users_workspace ON users(workspace_id);

-- Agent responses (core data)
CREATE TABLE responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_slack_id TEXT NOT NULL,
  channel_slack_id TEXT NOT NULL,
  question TEXT,
  answer TEXT,
  thread_ts TEXT,
  message_ts TEXT,
  positive_reactions INT DEFAULT 0,
  negative_reactions INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_responses_workspace ON responses(workspace_id);
CREATE INDEX idx_responses_agent ON responses(workspace_id, agent_slack_id);
CREATE INDEX idx_responses_created ON responses(workspace_id, created_at);

-- Message history (synced)
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_slack_id TEXT NOT NULL,
  user_slack_id TEXT,
  text TEXT,
  ts TEXT NOT NULL,
  thread_ts TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, channel_slack_id, ts)
);

CREATE INDEX idx_messages_workspace_channel ON messages(workspace_id, channel_slack_id);
