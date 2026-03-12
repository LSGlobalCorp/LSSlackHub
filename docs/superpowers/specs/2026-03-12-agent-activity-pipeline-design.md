# Agent Activity Pipeline — Design Spec

**Date:** 2026-03-12
**Status:** Reviewed & Updated

## Overview

Build an end-to-end pipeline that monitors agent messages in Slack, interprets them using AI, logs activity to PostgreSQL and Google Sheets, and generates interactive daily reports.

## Architecture: Event-Driven Listener

```
Slack message event (all channels bot is in)
  │
  ├─ Pre-filter (no AI cost):
  │   - Skip bot messages
  │   - Skip messages < 5 words
  │   - Skip system/join/leave messages
  │
  ├─ AI Classifier (Claude):
  │   Input: message text + channel context
  │   Input: message text + channel name + channel topic
  │   Output: { isAgentActivity, actionType, customerContext,
  │             notes, confidence }
  │
  ├─ If agent activity detected (confidence >= 0.7):
  │   ├─ Resolve team_id → workspace_id via getWorkspaceByTeamId()
  │   ├─ Store in PostgreSQL (agent_activities, ON CONFLICT skip)
  │   ├─ Batch-append row to Google Sheets (flush every 10s)
  │
  └─ If not agent activity: ignore
```

## Component 1: Message Interpreter Service

**File:** `src/services/message-interpreter.ts`

### Workspace Resolution
- Every message event includes `team_id` in the payload
- Resolve to internal `workspace_id` via `getWorkspaceByTeamId(teamId)` (existing pattern from `agent-responder.ts`)
- If workspace not found or inactive → skip message

### Pre-filter Rules
- `subtype` is set (bot_message, channel_join, etc.) → skip
- `bot_id` is present → skip
- Text length < 5 words → skip
- Message is from the bot itself → skip
- Thread replies ARE monitored (agents often report in threads)

### AI Classification
- **Model:** Claude (same SDK already in project)
- **Input context:** message text, channel name, channel topic/purpose (from channels table)
- **Prompt:** Structured system prompt that classifies messages and extracts:
  - `isAgentActivity: boolean` — is this an agent reporting an action?
  - `actionType: "answer" | "transfer" | "escalation" | "hold" | "other"`
  - `customerContext: string` — extracted customer/topic details
  - `notes: string` — any additional info
  - `confidence: number` — 0-1 classification confidence
- **Confidence threshold:** Only store activities with confidence >= 0.7
- **Response format:** JSON mode for reliable parsing
- Handles both free-text and structured message formats

### TypeScript Interface

Add to `src/types/index.ts`:

```typescript
export interface AgentActivity {
  id: string;
  workspaceId: string;
  agentSlackId: string;
  actionType: 'answer' | 'transfer' | 'escalation' | 'hold' | 'other';
  channelSlackId: string;
  customerContext: string | null;
  notes: string | null;
  rawMessage: string;
  messageTs: string;
  confidence: number;
  createdAt: Date;
}

export interface ClassificationResult {
  isAgentActivity: boolean;
  actionType?: AgentActivity['actionType'];
  customerContext?: string;
  notes?: string;
  confidence: number;
}
```

### Database Schema

New table: `agent_activities`

```sql
CREATE TABLE agent_activities (
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

CREATE INDEX idx_agent_activities_workspace ON agent_activities(workspace_id);
CREATE INDEX idx_agent_activities_agent ON agent_activities(agent_slack_id);
CREATE INDEX idx_agent_activities_created ON agent_activities(created_at);
CREATE INDEX idx_agent_activities_date ON agent_activities((created_at::date));
```

## Component 2: Google Sheets Integration

**File:** `src/services/google-sheets.ts`

### Authentication: OAuth 2.0
- User runs `/connect-sheets` slash command in Slack
- Bot sends ephemeral message with Google OAuth authorization URL
- User authorizes → callback at `GET /google/oauth/callback` (registered on existing Express app in `server.ts`)
- Stores encrypted OAuth tokens (access + refresh) in DB using existing `encrypt()` from `utils/crypto.ts`
- After OAuth completes, bot auto-creates a new Google Sheet named "LS Agent Hub - {team_name}" with the three tabs pre-configured
- Stores the created `sheet_id` in the `google_auth` record

### Token Storage

New table: `google_auth`

```sql
CREATE TABLE google_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  sheet_id TEXT,
  token_expiry TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Sheet Structure

One Google Sheet per workspace with three tabs:

**Tab 1: "Activity Log"** — one row per interpreted message
| Date | Time | Agent Name | Action Type | Channel | Customer Context | Notes | Confidence |
|------|------|------------|-------------|---------|-----------------|-------|------------|

**Tab 2: "Daily Summary"** — one row per day
| Date | Total Actions | Answers | Transfers | Escalations | Holds | Other |
|------|--------------|---------|-----------|-------------|-------|-------|

**Tab 3: "Agent Performance"** — per-agent per-day breakdown
| Date | Agent | Total | Answers | Transfers | Escalations | Holds | Other | Top Channel |
|------|-------|-------|---------|-----------|-------------|-------|-------|-------------|

### Batched Logging
- Each detected agent activity is added to an in-memory write buffer
- Buffer is flushed to Google Sheets every 10 seconds (or when buffer reaches 20 rows)
- Uses Google Sheets API v4 `spreadsheets.values.append` (batch append)
- Auto-refreshes OAuth token if expired
- This batching respects Google Sheets rate limits (60 req/min)

## Component 3: Daily Report Generator

**File:** `src/services/daily-report.ts`

### Trigger
- Scheduled via `node-cron` at a configurable time from `REPORT_TIME` env var (default: 18:00)
- Uses `REPORT_TIMEZONE` env var (default: America/New_York) — single-timezone for now, multi-timezone via `workspaces.timezone` column is a future enhancement
- Also triggerable manually via `/daily-report` slash command

### Slack Report (Interactive)
- Posts to a configurable reporting channel
- **Top-level block:** Day totals (total actions, breakdown by type as a bar-style summary)
- **Agent selector:** `static_select` dropdown with all agents who had activity that day
- On selection → `app.action()` handler updates the message with that agent's detailed stats:
  - Per-channel breakdown
  - Action type distribution
  - Comparison to their average (if historical data exists)
- Includes a button linking to the Google Sheet

### Sheets Report
- Appends/updates rows in "Daily Summary" tab (one row for the day)
- Appends rows to "Agent Performance" tab (one row per agent for the day)
- Calculates "Top Channel" per agent (channel with most activity)

## Component 4: Mock Testing

### Layer 1: Unit Tests

**File:** `tests/services/message-interpreter.test.ts`

Test cases:
- Free-text answer messages → correctly classified
- Structured format messages → correctly parsed
- Transfer messages → correct action type
- Escalation messages → correct action type
- Non-activity messages (chatter, greetings) → classified as NOT activity
- Edge cases: ambiguous messages, multi-action messages

**File:** `tests/services/google-sheets.test.ts`

Test cases:
- Row formatting for Activity Log
- Token refresh flow
- Error handling (expired auth, API failures)

**File:** `tests/services/daily-report.test.ts`

Test cases:
- Daily aggregation logic (totals, per-agent)
- Slack Block Kit output format
- Sheets report row generation
- Empty day handling

### Layer 2: E2E Test Script

**File:** `scripts/mock-test.ts`

Posts ~20-30 realistic mock messages across channels:

```
# Sample mock messages:
"Just answered a customer about their refund status in billing"       → answer
"Transferred the VIP client to the retention team"                    → transfer
"Escalated ticket #4521 to senior support — needs immediate attention" → escalation
"Put the caller on hold while checking inventory"                     → hold
"Resolved a shipping delay inquiry for order #8834"                   → answer
"Handed off the enterprise client to account management"              → transfer
"Hey team, lunch is here!"                                            → NOT activity
"Meeting in 5 minutes"                                                → NOT activity
"Customer asked about premium plan pricing, gave them the comparison" → answer
```

Script flow:
1. Post mock messages to real Slack channels via API
2. Wait for bot processing (polling DB for expected row count)
3. Verify all activity messages stored in `agent_activities`
4. Verify Google Sheets rows match DB
5. Trigger `/daily-report` and verify output
6. Print pass/fail summary
7. **Cleanup:** Delete test rows from `agent_activities` where `raw_message` contains `[MOCK-TEST]` prefix; remove test rows from Google Sheets

## New Slash Commands

| Command | Description |
|---------|-------------|
| `/connect-sheets` | Initiate Google OAuth to connect a Google Sheet |
| `/daily-report` | Manually trigger the end-of-day report |
| `/disconnect-sheets` | Delete Google OAuth tokens from DB and unlink the sheet (does NOT delete the Sheet itself) |

## New Dependencies

- `googleapis` — Google Sheets API v4 client
- `node-cron` — Scheduled daily report (lightweight alternative to full scheduler)

## Configuration (New Env Vars)

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your-domain.com/google/oauth/callback
REPORT_CHANNEL_ID=...          # Slack channel for daily reports
REPORT_TIME=18:00              # When to post daily report (24h format)
REPORT_TIMEZONE=America/New_York  # Timezone for scheduling
```

## Migration

New SQL migration file: `src/db/migrations/002-agent-activities.sql`
- Contains both `agent_activities` and `google_auth` table definitions
- Applied manually via `psql` or added to Docker Compose init

## Error Handling

- **AI classification fails:** Log error, skip message (don't block pipeline)
- **Google Sheets API fails:** Log error, data is still in DB (Sheets is secondary)
- **Token expired:** Auto-refresh using refresh token; if refresh fails, notify team lead
- **Rate limits:** Sheets writes are batched (10s / 20-row buffer); Slack rate limits already handled
- **Duplicate messages:** `ON CONFLICT (workspace_id, channel_slack_id, message_ts) DO NOTHING` prevents duplicates from Slack retries
- **Privacy:** `raw_message` and `customer_context` may contain PII — acceptable for internal team use; encryption at rest is handled by Supabase's storage encryption

## Data Flow Summary

```
Agent posts message in Slack
  ↓
app.message() handler fires
  ↓
Pre-filter: is this worth classifying?
  ↓ (yes)
Claude AI: classify + extract data
  ↓ (isAgentActivity = true)
  ├─ INSERT into agent_activities (PostgreSQL, ON CONFLICT skip)
  ├─ Buffer row for Google Sheets "Activity Log" (flushed every 10s)

At scheduled time (or /daily-report):
  ├─ Query agent_activities for today
  ├─ Aggregate totals + per-agent stats
  ├─ Post interactive Slack report with agent selector
  ├─ Update "Daily Summary" sheet tab
  └─ Update "Agent Performance" sheet tab
```
