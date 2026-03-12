export interface Workspace {
  id: string;
  slack_team_id: string;
  team_name: string;
  encrypted_bot_token: string;
  bot_user_id: string;
  installed_by: string;
  installed_at: Date;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export interface Channel {
  id: string;
  workspace_id: string;
  slack_channel_id: string;
  name: string;
  is_private: boolean;
  member_count: number;
  synced_at: Date;
}

export interface User {
  id: string;
  workspace_id: string;
  slack_user_id: string;
  display_name: string;
  email: string;
  is_admin: boolean;
  synced_at: Date;
}

export interface AgentResponse {
  id: string;
  workspace_id: string;
  agent_slack_id: string;
  channel_slack_id: string;
  question: string;
  answer: string;
  thread_ts: string | null;
  message_ts: string | null;
  positive_reactions: number;
  negative_reactions: number;
  created_at: Date;
}

export interface SyncedMessage {
  id: string;
  workspace_id: string;
  channel_slack_id: string;
  user_slack_id: string | null;
  text: string;
  ts: string;
  thread_ts: string | null;
  synced_at: Date;
}

export interface OAuthState {
  state: string;
  created_at: number;
}

export interface OAuthTokenResponse {
  ok: boolean;
  access_token: string;
  token_type: string;
  scope: string;
  bot_user_id: string;
  app_id: string;
  team: { id: string; name: string };
  authed_user: { id: string };
  error?: string;
}

export interface TallyEntry {
  agent_slack_id: string;
  display_name: string;
  response_count: number;
  positive_reactions: number;
  negative_reactions: number;
}

export interface TallyResult {
  workspace_id: string;
  timeframe: "today" | "week" | "month";
  entries: TallyEntry[];
  total_responses: number;
}
