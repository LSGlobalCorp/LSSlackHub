# Agent Activity Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an end-to-end pipeline that monitors agent Slack messages, classifies them via AI, logs to PostgreSQL + Google Sheets, and generates interactive daily reports.

**Architecture:** Event-driven message listener using Slack Bolt's `app.message()`, Claude AI for classification, batched Google Sheets writes via OAuth, and cron-scheduled daily reports posted to Slack + Sheets.

**Tech Stack:** TypeScript, @slack/bolt, @anthropic-ai/sdk, googleapis, node-cron, PostgreSQL, Vitest

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/db/migrations/002-agent-activities.sql` | Migration: `agent_activities` + `google_auth` tables |
| `src/services/message-interpreter.ts` | Pre-filter + AI classification + DB storage |
| `src/services/google-sheets.ts` | OAuth, token management, batched Sheets writes |
| `src/services/daily-report.ts` | Aggregation queries, Slack Block Kit report, Sheets summary |
| `src/oauth/google-callback.ts` | `GET /google/oauth/callback` handler |
| `scripts/mock-test.ts` | E2E mock test script |
| `tests/services/message-interpreter.test.ts` | Unit tests for classifier |
| `tests/services/google-sheets.test.ts` | Unit tests for Sheets service |
| `tests/services/daily-report.test.ts` | Unit tests for report generator |

### Modified Files
| File | Changes |
|------|---------|
| `src/types/index.ts` | Add `AgentActivity`, `ClassificationResult`, `GoogleAuth`, `DailyReportData` interfaces |
| `src/app.ts` | Add `app.message()` listener, `/connect-sheets`, `/disconnect-sheets`, `/daily-report` commands, `app.action()` for agent selector |
| `src/server.ts` | Register Google OAuth callback route, start cron scheduler |
| `package.json` | Add `googleapis`, `node-cron`, `@types/node-cron` |
| `.env.example` | Add Google + report env vars |

---

## Chunk 1: Foundation — Types, Migration, Dependencies

### Task 1: Install new dependencies

**Files:**
- Modify: `slack-agent-app/package.json`

- [ ] **Step 1: Install production dependencies**

```bash
cd slack-agent-app && npm install googleapis node-cron
```

- [ ] **Step 2: Install dev dependencies**

```bash
cd slack-agent-app && npm install -D @types/node-cron
```

- [ ] **Step 3: Verify installation**

Run: `cd slack-agent-app && npm ls googleapis node-cron`
Expected: Both packages listed without errors

- [ ] **Step 4: Commit**

```bash
git add slack-agent-app/package.json slack-agent-app/package-lock.json
git commit -m "feat: add googleapis and node-cron dependencies"
```

---

### Task 2: Add TypeScript interfaces

**Files:**
- Modify: `slack-agent-app/src/types/index.ts`

- [ ] **Step 1: Add new interfaces to types/index.ts**

Append after the existing `TallyResult` interface (line 88):

```typescript
export type ActionType = 'answer' | 'transfer' | 'escalation' | 'hold' | 'other';

export interface AgentActivity {
  id: string;
  workspace_id: string;
  agent_slack_id: string;
  action_type: ActionType;
  channel_slack_id: string;
  customer_context: string | null;
  notes: string | null;
  raw_message: string;
  message_ts: string;
  confidence: number;
  created_at: Date;
}

export interface ClassificationResult {
  isAgentActivity: boolean;
  actionType?: ActionType;
  customerContext?: string;
  notes?: string;
  confidence: number;
}

export interface GoogleAuth {
  id: string;
  workspace_id: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  sheet_id: string | null;
  token_expiry: Date;
  created_at: Date;
  updated_at: Date;
}

export interface DailyAgentStats {
  agent_slack_id: string;
  display_name: string;
  total: number;
  answers: number;
  transfers: number;
  escalations: number;
  holds: number;
  other: number;
  top_channel: string;
}

export interface DailyReportData {
  date: string;
  workspace_id: string;
  total_actions: number;
  answers: number;
  transfers: number;
  escalations: number;
  holds: number;
  other: number;
  agents: DailyAgentStats[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd slack-agent-app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add slack-agent-app/src/types/index.ts
git commit -m "feat: add AgentActivity, ClassificationResult, GoogleAuth, DailyReportData types"
```

---

### Task 3: Create database migration

**Files:**
- Create: `slack-agent-app/src/db/migrations/002-agent-activities.sql`

- [ ] **Step 1: Create migrations directory**

```bash
mkdir -p slack-agent-app/src/db/migrations
```

- [ ] **Step 2: Write migration file**

Create `slack-agent-app/src/db/migrations/002-agent-activities.sql`:

```sql
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
```

- [ ] **Step 3: Commit**

```bash
git add slack-agent-app/src/db/migrations/002-agent-activities.sql
git commit -m "feat: add migration for agent_activities and google_auth tables"
```

---

### Task 4: Update .env.example with new variables

**Files:**
- Modify: `slack-agent-app/.env.example`

- [ ] **Step 1: Append new env vars**

Add to the end of `.env.example`:

```
# Google Sheets Integration
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/google/oauth/callback

# Daily Report
REPORT_CHANNEL_ID=
REPORT_TIME=18:00
REPORT_TIMEZONE=America/New_York
```

- [ ] **Step 2: Commit**

```bash
git add slack-agent-app/.env.example
git commit -m "feat: add Google Sheets and report env vars to .env.example"
```

---

## Chunk 2: Message Interpreter Service (TDD)

### Task 5: Write failing tests for message interpreter

**Files:**
- Create: `slack-agent-app/tests/services/message-interpreter.test.ts`

- [ ] **Step 1: Write test file**

Create `slack-agent-app/tests/services/message-interpreter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db client
vi.mock("../../src/db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

// Mock workspace service
vi.mock("../../src/services/workspace", () => ({
  getWorkspaceByTeamId: vi.fn().mockResolvedValue({
    id: "ws-uuid-123",
    slack_team_id: "T123",
    team_name: "Test Team",
    bot_user_id: "U_BOT",
    is_active: true,
  }),
}));

// Mock Anthropic SDK — returns a classification JSON
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: function MockAnthropic() {
      return {
        messages: { create: mockCreate },
      };
    },
  };
});

import { shouldClassify, classifyMessage, storeActivity } from "../../src/services/message-interpreter";
import { query } from "../../src/db/client";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
});

describe("shouldClassify (pre-filter)", () => {
  it("rejects bot messages", () => {
    expect(shouldClassify({ text: "Hello world from bot", bot_id: "B123", user: "U123" })).toBe(false);
  });

  it("rejects messages with subtype", () => {
    expect(shouldClassify({ text: "joined the channel", subtype: "channel_join", user: "U123" })).toBe(false);
  });

  it("rejects short messages under 5 words", () => {
    expect(shouldClassify({ text: "okay thanks", user: "U123" })).toBe(false);
  });

  it("rejects messages from the bot itself", () => {
    expect(shouldClassify({ text: "Here is a long enough message", user: "U_BOT" }, "U_BOT")).toBe(false);
  });

  it("accepts valid agent messages", () => {
    expect(shouldClassify({ text: "Just answered a customer about their refund status", user: "U123" })).toBe(true);
  });

  it("accepts thread replies (thread_ts present)", () => {
    expect(shouldClassify({
      text: "Transferred the client to the billing team for resolution",
      user: "U123",
      thread_ts: "111.222",
    })).toBe(true);
  });
});

describe("classifyMessage", () => {
  it("classifies an answer message correctly", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: JSON.stringify({
          isAgentActivity: true,
          actionType: "answer",
          customerContext: "refund status inquiry",
          notes: "billing department",
          confidence: 0.95,
        }),
      }],
    });

    const result = await classifyMessage("Just answered a customer about their refund status in billing", "#support", "Support channel");
    expect(result.isAgentActivity).toBe(true);
    expect(result.actionType).toBe("answer");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.customerContext).toBe("refund status inquiry");
  });

  it("classifies a transfer message correctly", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: JSON.stringify({
          isAgentActivity: true,
          actionType: "transfer",
          customerContext: "VIP client",
          notes: "transferred to retention team",
          confidence: 0.92,
        }),
      }],
    });

    const result = await classifyMessage("Transferred the VIP client to the retention team", "#general", "General channel");
    expect(result.isAgentActivity).toBe(true);
    expect(result.actionType).toBe("transfer");
  });

  it("classifies non-activity as not agent activity", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: JSON.stringify({
          isAgentActivity: false,
          confidence: 0.1,
        }),
      }],
    });

    const result = await classifyMessage("Hey team, lunch is here!", "#general", "General channel");
    expect(result.isAgentActivity).toBe(false);
  });

  it("classifies an escalation message correctly", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: JSON.stringify({
          isAgentActivity: true,
          actionType: "escalation",
          customerContext: "ticket #4521",
          notes: "needs immediate attention",
          confidence: 0.88,
        }),
      }],
    });

    const result = await classifyMessage("Escalated ticket #4521 to senior support — needs immediate attention", "#support", "Support tickets");
    expect(result.isAgentActivity).toBe(true);
    expect(result.actionType).toBe("escalation");
  });

  it("returns low confidence for ambiguous messages", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: JSON.stringify({
          isAgentActivity: false,
          confidence: 0.35,
        }),
      }],
    });

    const result = await classifyMessage("I think that might work, let me check", "#random", "Random chat");
    expect(result.confidence).toBeLessThan(0.7);
  });
});

describe("storeActivity", () => {
  it("inserts activity into agent_activities table", async () => {
    await storeActivity({
      workspaceId: "ws-uuid-123",
      agentSlackId: "U001",
      actionType: "answer",
      channelSlackId: "C123",
      customerContext: "refund inquiry",
      notes: "resolved",
      rawMessage: "Just answered a customer about refunds",
      messageTs: "1234567890.123456",
      confidence: 0.95,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_activities"),
      expect.arrayContaining(["ws-uuid-123", "U001", "answer", "C123"])
    );
  });

  it("uses ON CONFLICT DO NOTHING for deduplication", async () => {
    await storeActivity({
      workspaceId: "ws-uuid-123",
      agentSlackId: "U001",
      actionType: "answer",
      channelSlackId: "C123",
      customerContext: null,
      notes: null,
      rawMessage: "Answered a question",
      messageTs: "111.222",
      confidence: 0.8,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT"),
      expect.any(Array)
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd slack-agent-app && npx vitest run tests/services/message-interpreter.test.ts`
Expected: FAIL — `message-interpreter` module not found

- [ ] **Step 3: Commit failing tests**

```bash
git add slack-agent-app/tests/services/message-interpreter.test.ts
git commit -m "test: add failing tests for message interpreter service"
```

---

### Task 6: Implement message interpreter service

**Files:**
- Create: `slack-agent-app/src/services/message-interpreter.ts`

- [ ] **Step 1: Write message-interpreter.ts**

Create `slack-agent-app/src/services/message-interpreter.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { query } from "../db/client";
import { logger } from "../utils/logger";
import { ClassificationResult } from "../types";

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

interface SlackMessage {
  text: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  thread_ts?: string;
}

const MINIMUM_WORD_COUNT = 5;

export function shouldClassify(message: SlackMessage, botUserId?: string): boolean {
  // Skip bot messages
  if (message.bot_id) return false;

  // Skip messages with subtypes (channel_join, channel_leave, etc.)
  if (message.subtype) return false;

  // Skip messages from the bot itself
  if (botUserId && message.user === botUserId) return false;

  // Skip very short messages
  const wordCount = (message.text || "").trim().split(/\s+/).length;
  if (wordCount < MINIMUM_WORD_COUNT) return false;

  return true;
}

const CLASSIFICATION_SYSTEM_PROMPT = `You are a message classifier for a customer service team's Slack workspace.
Your job is to determine if a Slack message is an agent reporting an action they took (answered a customer, transferred a call, escalated a ticket, put someone on hold, etc.) versus general chatter.

Classify the message and respond with ONLY valid JSON (no markdown, no code fences):
{
  "isAgentActivity": boolean,
  "actionType": "answer" | "transfer" | "escalation" | "hold" | "other",
  "customerContext": "brief description of the customer/topic if applicable",
  "notes": "any additional relevant details",
  "confidence": 0.0 to 1.0
}

Action type definitions:
- "answer": Agent answered/resolved a customer question or issue
- "transfer": Agent transferred/handed off a customer to another team or agent
- "escalation": Agent escalated an issue to senior support or management
- "hold": Agent put a customer on hold
- "other": Agent performed some other tracked activity

If the message is NOT agent activity (general chatter, greetings, scheduling, etc.), return:
{ "isAgentActivity": false, "confidence": <your confidence it's NOT activity> }

Be strict: only classify as agent activity when the message clearly describes an action taken with/for a customer.`;

export async function classifyMessage(
  messageText: string,
  channelName: string,
  channelTopic: string
): Promise<ClassificationResult> {
  const client = getAnthropicClient();

  const userMessage = `Channel: #${channelName}
Channel topic: ${channelTopic}

Message: "${messageText}"`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 256,
    system: CLASSIFICATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    logger.warn("No text block in classification response");
    return { isAgentActivity: false, confidence: 0 };
  }

  try {
    const parsed = JSON.parse(textBlock.text) as ClassificationResult;
    return parsed;
  } catch (err) {
    logger.error("Failed to parse classification response", {
      response: textBlock.text,
      error: err instanceof Error ? err.message : "Unknown",
    });
    return { isAgentActivity: false, confidence: 0 };
  }
}

interface StoreActivityParams {
  workspaceId: string;
  agentSlackId: string;
  actionType: string;
  channelSlackId: string;
  customerContext: string | null;
  notes: string | null;
  rawMessage: string;
  messageTs: string;
  confidence: number;
}

export async function storeActivity(params: StoreActivityParams): Promise<void> {
  await query(
    `INSERT INTO agent_activities
      (workspace_id, agent_slack_id, action_type, channel_slack_id, customer_context, notes, raw_message, message_ts, confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (workspace_id, channel_slack_id, message_ts) DO NOTHING`,
    [
      params.workspaceId,
      params.agentSlackId,
      params.actionType,
      params.channelSlackId,
      params.customerContext,
      params.notes,
      params.rawMessage,
      params.messageTs,
      params.confidence,
    ]
  );
  logger.info("Agent activity stored", {
    workspaceId: params.workspaceId,
    actionType: params.actionType,
    agent: params.agentSlackId,
  });
}

const CONFIDENCE_THRESHOLD = 0.7;

export interface HandleMessageResult {
  stored: boolean;
  activity?: {
    actionType: string;
    customerContext: string | null;
    notes: string | null;
    confidence: number;
  };
}

export async function handleMessage(
  teamId: string,
  channelId: string,
  userId: string,
  messageText: string,
  messageTs: string,
  channelName: string,
  channelTopic: string,
  workspaceId: string
): Promise<HandleMessageResult> {
  const classification = await classifyMessage(messageText, channelName, channelTopic);

  if (!classification.isAgentActivity || classification.confidence < CONFIDENCE_THRESHOLD) {
    return { stored: false };
  }

  const actionType = classification.actionType || "other";
  const customerContext = classification.customerContext || null;
  const notes = classification.notes || null;

  await storeActivity({
    workspaceId,
    agentSlackId: userId,
    actionType,
    channelSlackId: channelId,
    customerContext,
    notes,
    rawMessage: messageText,
    messageTs,
    confidence: classification.confidence,
  });

  return {
    stored: true,
    activity: { actionType, customerContext, notes, confidence: classification.confidence },
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd slack-agent-app && npx vitest run tests/services/message-interpreter.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add slack-agent-app/src/services/message-interpreter.ts
git commit -m "feat: implement message interpreter with AI classification and DB storage"
```

---

### Task 7: Wire message listener into app.ts

**Files:**
- Modify: `slack-agent-app/src/app.ts`

- [ ] **Step 1: Add imports at top of app.ts**

After the existing imports (line 5), add:

```typescript
import { shouldClassify, handleMessage } from "./services/message-interpreter";
import { getWorkspaceByTeamId, getDecryptedToken } from "./services/workspace";
import { appendActivityRow } from "./services/google-sheets";
```

- [ ] **Step 2: Add app.message() listener before `return app`**

Before `return app;` (line 176), add:

```typescript
  // Message listener — classify agent activity
  app.message(async ({ message, context }) => {
    const msg = message as any;

    // Pre-filter: skip non-classifiable messages
    const botUserId = context.botUserId;
    if (!shouldClassify(msg, botUserId)) return;

    const teamId = (context as any).teamId || msg.team;
    if (!teamId) return;

    try {
      const workspace = await getWorkspaceByTeamId(teamId);
      if (!workspace) return;

      // Look up channel name and topic from DB
      const channelResult = await query(
        "SELECT name FROM channels WHERE workspace_id = $1 AND slack_channel_id = $2",
        [workspace.id, msg.channel]
      );
      const channelName = channelResult.rows[0]?.name || msg.channel;

      const result = await handleMessage(
        teamId,
        msg.channel,
        msg.user,
        msg.text || "",
        msg.ts,
        channelName,
        channelName, // channel context for classifier
        workspace.id
      );

      // If activity was stored, also buffer for Google Sheets
      if (result.stored && result.activity) {
        const userResult = await query(
          "SELECT display_name FROM users WHERE workspace_id = $1 AND slack_user_id = $2",
          [workspace.id, msg.user]
        );
        const agentName = userResult.rows[0]?.display_name || msg.user;
        const now = new Date();

        appendActivityRow(workspace.id, {
          date: now.toISOString().split("T")[0],
          time: now.toTimeString().split(" ")[0],
          agentName,
          actionType: result.activity.actionType,
          channelName,
          customerContext: result.activity.customerContext,
          notes: result.activity.notes,
          confidence: result.activity.confidence,
        });
      }
    } catch (err) {
      logger.error("Error in message classifier", {
        error: err instanceof Error ? err.message : "Unknown",
        channel: msg.channel,
      });
    }
  });
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd slack-agent-app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add slack-agent-app/src/app.ts
git commit -m "feat: wire message listener for agent activity classification"
```

---

## Chunk 3: Google Sheets Integration (TDD)

### Task 8: Write failing tests for Google Sheets service

**Files:**
- Create: `slack-agent-app/tests/services/google-sheets.test.ts`

- [ ] **Step 1: Write test file**

Create `slack-agent-app/tests/services/google-sheets.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock("../../src/utils/crypto", () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace("encrypted:", "")),
}));

// Mock googleapis
const mockAppend = vi.fn().mockResolvedValue({ data: {} });
const mockBatchUpdate = vi.fn().mockResolvedValue({ data: {} });
const mockCreate = vi.fn().mockResolvedValue({
  data: { spreadsheetId: "sheet-123" },
});

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
        generateAuthUrl: vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/auth?mock=true"),
        getToken: vi.fn().mockResolvedValue({
          tokens: {
            access_token: "ya29.mock-access-token",
            refresh_token: "1//mock-refresh-token",
            expiry_date: Date.now() + 3600000,
          },
        }),
        credentials: { access_token: "ya29.mock-access-token" },
      })),
    },
    sheets: vi.fn().mockReturnValue({
      spreadsheets: {
        create: mockCreate,
        values: { append: mockAppend },
        batchUpdate: mockBatchUpdate,
      },
    }),
  },
}));

import {
  getAuthUrl,
  handleGoogleCallback,
  appendActivityRow,
  flushBuffer,
  formatActivityRow,
} from "../../src/services/google-sheets";
import { query } from "../../src/db/client";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "mock-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "mock-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/google/oauth/callback";
});

describe("getAuthUrl", () => {
  it("generates a Google OAuth URL", () => {
    const url = getAuthUrl("T123");
    expect(url).toContain("accounts.google.com");
  });
});

describe("formatActivityRow", () => {
  it("formats an agent activity into a spreadsheet row", () => {
    const row = formatActivityRow({
      date: "2026-03-12",
      time: "14:30:00",
      agentName: "Ryan P.",
      actionType: "answer",
      channelName: "#support",
      customerContext: "refund inquiry",
      notes: "resolved successfully",
      confidence: 0.95,
    });

    expect(row).toEqual([
      "2026-03-12",
      "14:30:00",
      "Ryan P.",
      "answer",
      "#support",
      "refund inquiry",
      "resolved successfully",
      "0.95",
    ]);
  });

  it("handles null fields gracefully", () => {
    const row = formatActivityRow({
      date: "2026-03-12",
      time: "14:30:00",
      agentName: "Ryan P.",
      actionType: "transfer",
      channelName: "#billing",
      customerContext: null,
      notes: null,
      confidence: 0.82,
    });

    expect(row).toEqual([
      "2026-03-12",
      "14:30:00",
      "Ryan P.",
      "transfer",
      "#billing",
      "",
      "",
      "0.82",
    ]);
  });
});

describe("appendActivityRow", () => {
  it("adds a row to the write buffer", () => {
    appendActivityRow("ws-123", {
      date: "2026-03-12",
      time: "14:30:00",
      agentName: "Ryan P.",
      actionType: "answer",
      channelName: "#support",
      customerContext: "refund",
      notes: null,
      confidence: 0.9,
    });
    // Buffer is internal — we verify via flushBuffer behavior
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd slack-agent-app && npx vitest run tests/services/google-sheets.test.ts`
Expected: FAIL — `google-sheets` module not found

- [ ] **Step 3: Commit failing tests**

```bash
git add slack-agent-app/tests/services/google-sheets.test.ts
git commit -m "test: add failing tests for Google Sheets service"
```

---

### Task 9: Implement Google Sheets service

**Files:**
- Create: `slack-agent-app/src/services/google-sheets.ts`

- [ ] **Step 1: Write google-sheets.ts**

Create `slack-agent-app/src/services/google-sheets.ts`:

```typescript
import { google } from "googleapis";
import { query } from "../db/client";
import { encrypt, decrypt } from "../utils/crypto";
import { logger } from "../utils/logger";

// --- OAuth ---

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(teamId: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
    state: teamId,
  });
}

export async function handleGoogleCallback(
  code: string,
  teamId: string
): Promise<string> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Missing tokens from Google OAuth response");
  }

  // Encrypt tokens before storage
  const encryptedAccess = encrypt(tokens.access_token);
  const encryptedRefresh = encrypt(tokens.refresh_token);
  const expiry = new Date(tokens.expiry_date || Date.now() + 3600000);

  // Get workspace ID
  const wsResult = await query(
    "SELECT id, team_name FROM workspaces WHERE slack_team_id = $1 AND is_active = true",
    [teamId]
  );
  const workspace = wsResult.rows[0];
  if (!workspace) throw new Error(`Workspace not found for team ${teamId}`);

  // Create the Google Sheet
  client.setCredentials(tokens);
  const sheets = google.sheets({ version: "v4", auth: client });

  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `LS Agent Hub - ${workspace.team_name}` },
      sheets: [
        {
          properties: { title: "Activity Log", index: 0 },
          data: [{
            startRow: 0,
            startColumn: 0,
            rowData: [{
              values: [
                "Date", "Time", "Agent Name", "Action Type",
                "Channel", "Customer Context", "Notes", "Confidence",
              ].map((h) => ({
                userEnteredValue: { stringValue: h },
                userEnteredFormat: { textFormat: { bold: true } },
              })),
            }],
          }],
        },
        {
          properties: { title: "Daily Summary", index: 1 },
          data: [{
            startRow: 0,
            startColumn: 0,
            rowData: [{
              values: [
                "Date", "Total Actions", "Answers", "Transfers",
                "Escalations", "Holds", "Other",
              ].map((h) => ({
                userEnteredValue: { stringValue: h },
                userEnteredFormat: { textFormat: { bold: true } },
              })),
            }],
          }],
        },
        {
          properties: { title: "Agent Performance", index: 2 },
          data: [{
            startRow: 0,
            startColumn: 0,
            rowData: [{
              values: [
                "Date", "Agent", "Total", "Answers", "Transfers",
                "Escalations", "Holds", "Other", "Top Channel",
              ].map((h) => ({
                userEnteredValue: { stringValue: h },
                userEnteredFormat: { textFormat: { bold: true } },
              })),
            }],
          }],
        },
      ],
    },
  });

  const sheetId = spreadsheet.data.spreadsheetId!;

  // Store in DB
  await query(
    `INSERT INTO google_auth
      (workspace_id, encrypted_access_token, encrypted_refresh_token, sheet_id, token_expiry)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id) DO UPDATE SET
       encrypted_access_token = EXCLUDED.encrypted_access_token,
       encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
       sheet_id = EXCLUDED.sheet_id,
       token_expiry = EXCLUDED.token_expiry,
       updated_at = NOW()`,
    [workspace.id, encryptedAccess, encryptedRefresh, sheetId, expiry.toISOString()]
  );

  logger.info("Google Sheets connected", { teamId, sheetId });
  return sheetId;
}

// --- Authenticated Sheets Client ---

async function getAuthenticatedSheetsClient(workspaceId: string) {
  const result = await query(
    "SELECT * FROM google_auth WHERE workspace_id = $1",
    [workspaceId]
  );
  const auth = result.rows[0];
  if (!auth) return null;

  const client = getOAuth2Client();
  const accessToken = decrypt(auth.encrypted_access_token);
  const refreshToken = decrypt(auth.encrypted_refresh_token);

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: new Date(auth.token_expiry).getTime(),
  });

  // Check if token needs refresh
  if (new Date(auth.token_expiry) <= new Date()) {
    try {
      const { credentials } = await client.refreshAccessToken();
      const newEncryptedAccess = encrypt(credentials.access_token!);
      const newExpiry = new Date(credentials.expiry_date || Date.now() + 3600000);

      await query(
        `UPDATE google_auth SET encrypted_access_token = $1, token_expiry = $2, updated_at = NOW() WHERE workspace_id = $3`,
        [newEncryptedAccess, newExpiry.toISOString(), workspaceId]
      );
    } catch (err) {
      logger.error("Failed to refresh Google token", {
        workspaceId,
        error: err instanceof Error ? err.message : "Unknown",
      });
      return null;
    }
  }

  return {
    sheets: google.sheets({ version: "v4", auth: client }),
    sheetId: auth.sheet_id as string,
  };
}

// --- Batched Write Buffer ---

export interface ActivityRowData {
  date: string;
  time: string;
  agentName: string;
  actionType: string;
  channelName: string;
  customerContext: string | null;
  notes: string | null;
  confidence: number;
}

export function formatActivityRow(data: ActivityRowData): string[] {
  return [
    data.date,
    data.time,
    data.agentName,
    data.actionType,
    data.channelName,
    data.customerContext || "",
    data.notes || "",
    data.confidence.toFixed(2),
  ];
}

// Buffer: workspaceId -> rows[]
const writeBuffer: Map<string, string[][]> = new Map();

export function appendActivityRow(workspaceId: string, data: ActivityRowData): void {
  const row = formatActivityRow(data);
  const existing = writeBuffer.get(workspaceId) || [];
  existing.push(row);
  writeBuffer.set(workspaceId, existing);

  // Flush if buffer is large
  if (existing.length >= 20) {
    flushBuffer(workspaceId).catch((err) => {
      logger.error("Failed to flush write buffer", {
        workspaceId,
        error: err instanceof Error ? err.message : "Unknown",
      });
    });
  }
}

export async function flushBuffer(workspaceId?: string): Promise<void> {
  const workspaces = workspaceId ? [workspaceId] : Array.from(writeBuffer.keys());

  for (const wsId of workspaces) {
    const rows = writeBuffer.get(wsId);
    if (!rows || rows.length === 0) continue;

    // Clear the buffer before writing (so new rows aren't lost)
    writeBuffer.set(wsId, []);

    try {
      const client = await getAuthenticatedSheetsClient(wsId);
      if (!client) {
        logger.warn("No Google Sheets connection for workspace, skipping flush", { workspaceId: wsId });
        continue;
      }

      await client.sheets.spreadsheets.values.append({
        spreadsheetId: client.sheetId,
        range: "'Activity Log'!A:H",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      });

      logger.info("Flushed activity rows to Google Sheets", {
        workspaceId: wsId,
        rowCount: rows.length,
      });
    } catch (err) {
      logger.error("Failed to write to Google Sheets", {
        workspaceId: wsId,
        error: err instanceof Error ? err.message : "Unknown",
        rowCount: rows.length,
      });
      // Re-add rows to buffer for retry
      const current = writeBuffer.get(wsId) || [];
      writeBuffer.set(wsId, [...rows, ...current]);
    }
  }
}

// --- Summary Writes ---

export async function writeDailySummaryRow(
  workspaceId: string,
  row: string[]
): Promise<void> {
  const client = await getAuthenticatedSheetsClient(workspaceId);
  if (!client) return;

  await client.sheets.spreadsheets.values.append({
    spreadsheetId: client.sheetId,
    range: "'Daily Summary'!A:G",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

export async function writeAgentPerformanceRows(
  workspaceId: string,
  rows: string[][]
): Promise<void> {
  const client = await getAuthenticatedSheetsClient(workspaceId);
  if (!client) return;

  await client.sheets.spreadsheets.values.append({
    spreadsheetId: client.sheetId,
    range: "'Agent Performance'!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
}

// --- Disconnect ---

export async function disconnectSheets(workspaceId: string): Promise<void> {
  await query("DELETE FROM google_auth WHERE workspace_id = $1", [workspaceId]);
  writeBuffer.delete(workspaceId);
  logger.info("Google Sheets disconnected", { workspaceId });
}

// --- Periodic Flush (called from server.ts) ---

let flushInterval: ReturnType<typeof setInterval> | null = null;

export function startPeriodicFlush(intervalMs = 10000): void {
  if (flushInterval) return;
  flushInterval = setInterval(() => {
    flushBuffer().catch((err) => {
      logger.error("Periodic flush error", {
        error: err instanceof Error ? err.message : "Unknown",
      });
    });
  }, intervalMs);
}

export function stopPeriodicFlush(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd slack-agent-app && npx vitest run tests/services/google-sheets.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add slack-agent-app/src/services/google-sheets.ts
git commit -m "feat: implement Google Sheets service with OAuth, batched writes, and token refresh"
```

---

### Task 10: Create Google OAuth callback handler

**Files:**
- Create: `slack-agent-app/src/oauth/google-callback.ts`

- [ ] **Step 1: Write google-callback.ts**

Create `slack-agent-app/src/oauth/google-callback.ts`:

```typescript
import { Request, Response } from "express";
import { handleGoogleCallback } from "../services/google-sheets";
import { logger } from "../utils/logger";

export async function handleGoogleOAuthCallback(req: Request, res: Response): Promise<void> {
  const { code, state: teamId, error } = req.query as Record<string, string>;

  if (error) {
    logger.warn("Google OAuth denied", { error });
    res.status(400).send(page("Connection Cancelled", "Google Sheets connection was cancelled.", true));
    return;
  }

  if (!code || !teamId) {
    res.status(400).send(page("Error", "Missing authorization code or workspace ID.", true));
    return;
  }

  try {
    const sheetId = await handleGoogleCallback(code, teamId);
    res.send(page(
      "Google Sheets Connected!",
      `Your Google Sheet has been created and linked. <br><a href="https://docs.google.com/spreadsheets/d/${sheetId}" target="_blank">Open Sheet</a>`
    ));
  } catch (err) {
    logger.error("Google OAuth callback error", {
      error: err instanceof Error ? err.message : "Unknown",
    });
    res.status(500).send(page("Error", "Failed to connect Google Sheets. Please try again.", true));
  }
}

function page(title: string, message: string, isError = false): string {
  const color = isError ? "#d32f2f" : "#1a8";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f8f9fa;display:flex;justify-content:center;align-items:center;min-height:100vh}.card{background:white;border-radius:12px;padding:48px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center;max-width:480px}h1{color:${color};font-size:24px;margin-bottom:12px}p{color:#666;font-size:16px}a{color:#1a73e8;text-decoration:none}</style>
</head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}
```

- [ ] **Step 2: Register route in server.ts**

In `slack-agent-app/src/server.ts`, add after the Slack OAuth routes (line 27):

```typescript
import { handleGoogleOAuthCallback } from "./oauth/google-callback";
```

And add the route after `expressApp.get("/slack/oauth/callback", handleCallback);`:

```typescript
expressApp.get("/google/oauth/callback", handleGoogleOAuthCallback);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd slack-agent-app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add slack-agent-app/src/oauth/google-callback.ts slack-agent-app/src/server.ts
git commit -m "feat: add Google OAuth callback route and handler"
```

---

### Task 11: Add /connect-sheets and /disconnect-sheets commands to app.ts

**Files:**
- Modify: `slack-agent-app/src/app.ts`

- [ ] **Step 1: Add imports**

Add at top of `app.ts`:

```typescript
import { getAuthUrl, disconnectSheets } from "./services/google-sheets";
```

- [ ] **Step 2: Add /connect-sheets command**

Before `return app;`, add:

```typescript
  // /connect-sheets command
  app.command("/connect-sheets", async ({ command, ack, respond }: SlackCommandMiddlewareArgs) => {
    await ack();
    const { team_id } = command;

    try {
      const url = getAuthUrl(team_id);
      await respond({
        response_type: "ephemeral",
        text: `Click here to connect Google Sheets: ${url}\n\nThis will create a new spreadsheet to track agent activity.`,
      });
    } catch (err) {
      logger.error("Error in /connect-sheets", { error: err instanceof Error ? err.message : "Unknown" });
      await respond({ response_type: "ephemeral", text: "Failed to generate connection link. Please try again." });
    }
  });

  // /disconnect-sheets command
  app.command("/disconnect-sheets", async ({ command, ack, respond }: SlackCommandMiddlewareArgs) => {
    await ack();
    const { team_id } = command;

    try {
      const workspace = await getWorkspaceByTeamId(team_id);
      if (!workspace) {
        await respond({ response_type: "ephemeral", text: "Workspace not found." });
        return;
      }
      await disconnectSheets(workspace.id);
      await respond({ response_type: "ephemeral", text: "Google Sheets disconnected. The sheet itself was not deleted." });
    } catch (err) {
      logger.error("Error in /disconnect-sheets", { error: err instanceof Error ? err.message : "Unknown" });
      await respond({ response_type: "ephemeral", text: "Failed to disconnect. Please try again." });
    }
  });
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd slack-agent-app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add slack-agent-app/src/app.ts
git commit -m "feat: add /connect-sheets and /disconnect-sheets commands"
```

---

## Chunk 4: Daily Report Generator (TDD)

### Task 12: Write failing tests for daily report

**Files:**
- Create: `slack-agent-app/tests/services/daily-report.test.ts`

- [ ] **Step 1: Write test file**

Create `slack-agent-app/tests/services/daily-report.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/client", () => ({
  query: vi.fn(),
}));

vi.mock("../../src/services/google-sheets", () => ({
  writeDailySummaryRow: vi.fn().mockResolvedValue(undefined),
  writeAgentPerformanceRows: vi.fn().mockResolvedValue(undefined),
}));

import { aggregateDailyData, formatReportBlocks, formatDailySummaryRow, formatAgentPerformanceRows } from "../../src/services/daily-report";
import { query } from "../../src/db/client";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("aggregateDailyData", () => {
  it("aggregates activities into daily report data", async () => {
    (query as any).mockResolvedValueOnce({
      rows: [
        { action_type: "answer", count: "10" },
        { action_type: "transfer", count: "5" },
        { action_type: "escalation", count: "2" },
        { action_type: "hold", count: "1" },
        { action_type: "other", count: "0" },
      ],
    }).mockResolvedValueOnce({
      rows: [
        {
          agent_slack_id: "U001",
          display_name: "Ryan P.",
          total: "8",
          answers: "5",
          transfers: "2",
          escalations: "1",
          holds: "0",
          other: "0",
          top_channel: "#support",
        },
        {
          agent_slack_id: "U002",
          display_name: "Sarah K.",
          total: "10",
          answers: "5",
          transfers: "3",
          escalations: "1",
          holds: "1",
          other: "0",
          top_channel: "#billing",
        },
      ],
    });

    const data = await aggregateDailyData("ws-uuid-123", "2026-03-12");

    expect(data.total_actions).toBe(18);
    expect(data.answers).toBe(10);
    expect(data.transfers).toBe(5);
    expect(data.agents).toHaveLength(2);
    expect(data.agents[0].display_name).toBe("Ryan P.");
  });

  it("handles empty day with zero totals", async () => {
    (query as any).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const data = await aggregateDailyData("ws-uuid-123", "2026-03-12");

    expect(data.total_actions).toBe(0);
    expect(data.agents).toHaveLength(0);
  });
});

describe("formatReportBlocks", () => {
  it("generates Slack Block Kit blocks with agent selector", () => {
    const blocks = formatReportBlocks({
      date: "2026-03-12",
      workspace_id: "ws-123",
      total_actions: 18,
      answers: 10,
      transfers: 5,
      escalations: 2,
      holds: 1,
      other: 0,
      agents: [
        { agent_slack_id: "U001", display_name: "Ryan P.", total: 8, answers: 5, transfers: 2, escalations: 1, holds: 0, other: 0, top_channel: "#support" },
      ],
    });

    expect(blocks).toBeInstanceOf(Array);
    expect(blocks.length).toBeGreaterThan(0);
    // Should include a header block
    expect(blocks[0]).toHaveProperty("type", "header");
    // Should include agent selector action
    const actionBlock = blocks.find((b: any) => b.type === "actions");
    expect(actionBlock).toBeDefined();
  });

  it("handles empty report gracefully", () => {
    const blocks = formatReportBlocks({
      date: "2026-03-12",
      workspace_id: "ws-123",
      total_actions: 0,
      answers: 0, transfers: 0, escalations: 0, holds: 0, other: 0,
      agents: [],
    });

    expect(blocks).toBeInstanceOf(Array);
    // Should show "no activity" message
    const noActivity = blocks.find((b: any) =>
      b.type === "section" && JSON.stringify(b).includes("No activity")
    );
    expect(noActivity).toBeDefined();
  });
});

describe("formatDailySummaryRow", () => {
  it("formats a row for the Daily Summary sheet tab", () => {
    const row = formatDailySummaryRow({
      date: "2026-03-12",
      workspace_id: "ws-123",
      total_actions: 18,
      answers: 10, transfers: 5, escalations: 2, holds: 1, other: 0,
      agents: [],
    });

    expect(row).toEqual(["2026-03-12", "18", "10", "5", "2", "1", "0"]);
  });
});

describe("formatAgentPerformanceRows", () => {
  it("formats rows for Agent Performance sheet tab", () => {
    const rows = formatAgentPerformanceRows("2026-03-12", [
      { agent_slack_id: "U001", display_name: "Ryan P.", total: 8, answers: 5, transfers: 2, escalations: 1, holds: 0, other: 0, top_channel: "#support" },
    ]);

    expect(rows).toEqual([
      ["2026-03-12", "Ryan P.", "8", "5", "2", "1", "0", "0", "#support"],
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd slack-agent-app && npx vitest run tests/services/daily-report.test.ts`
Expected: FAIL — `daily-report` module not found

- [ ] **Step 3: Commit**

```bash
git add slack-agent-app/tests/services/daily-report.test.ts
git commit -m "test: add failing tests for daily report generator"
```

---

### Task 13: Implement daily report service

**Files:**
- Create: `slack-agent-app/src/services/daily-report.ts`

- [ ] **Step 1: Write daily-report.ts**

Create `slack-agent-app/src/services/daily-report.ts`:

```typescript
import { query } from "../db/client";
import { logger } from "../utils/logger";
import { DailyReportData, DailyAgentStats } from "../types";
import { writeDailySummaryRow, writeAgentPerformanceRows } from "./google-sheets";

// --- Data Aggregation ---

export async function aggregateDailyData(
  workspaceId: string,
  date: string
): Promise<DailyReportData> {
  // Get action type breakdown
  const summaryResult = await query(
    `SELECT action_type, COUNT(*)::int as count
     FROM agent_activities
     WHERE workspace_id = $1 AND created_at::date = $2::date
     GROUP BY action_type`,
    [workspaceId, date]
  );

  const counts: Record<string, number> = {
    answer: 0, transfer: 0, escalation: 0, hold: 0, other: 0,
  };
  for (const row of summaryResult.rows) {
    counts[row.action_type] = parseInt(row.count, 10);
  }

  // Get per-agent stats
  const agentResult = await query(
    `SELECT
       a.agent_slack_id,
       COALESCE(u.display_name, a.agent_slack_id) as display_name,
       COUNT(*)::int as total,
       COUNT(*) FILTER (WHERE a.action_type = 'answer')::int as answers,
       COUNT(*) FILTER (WHERE a.action_type = 'transfer')::int as transfers,
       COUNT(*) FILTER (WHERE a.action_type = 'escalation')::int as escalations,
       COUNT(*) FILTER (WHERE a.action_type = 'hold')::int as holds,
       COUNT(*) FILTER (WHERE a.action_type = 'other')::int as other,
       (SELECT c.name FROM channels c WHERE c.slack_channel_id = (
         SELECT aa.channel_slack_id FROM agent_activities aa
         WHERE aa.agent_slack_id = a.agent_slack_id
           AND aa.workspace_id = $1 AND aa.created_at::date = $2::date
         GROUP BY aa.channel_slack_id ORDER BY COUNT(*) DESC LIMIT 1
       ) AND c.workspace_id = $1 LIMIT 1) as top_channel
     FROM agent_activities a
     LEFT JOIN users u ON u.workspace_id = $1 AND u.slack_user_id = a.agent_slack_id
     WHERE a.workspace_id = $1 AND a.created_at::date = $2::date
     GROUP BY a.agent_slack_id, u.display_name
     ORDER BY total DESC`,
    [workspaceId, date]
  );

  const totalActions = Object.values(counts).reduce((sum, c) => sum + c, 0);

  return {
    date,
    workspace_id: workspaceId,
    total_actions: totalActions,
    answers: counts.answer,
    transfers: counts.transfer,
    escalations: counts.escalation,
    holds: counts.hold,
    other: counts.other,
    agents: agentResult.rows.map((r) => ({
      agent_slack_id: r.agent_slack_id,
      display_name: r.display_name,
      total: parseInt(r.total, 10),
      answers: parseInt(r.answers, 10),
      transfers: parseInt(r.transfers, 10),
      escalations: parseInt(r.escalations, 10),
      holds: parseInt(r.holds, 10),
      other: parseInt(r.other, 10),
      top_channel: r.top_channel || "N/A",
    })),
  };
}

// --- Slack Block Kit Report ---

export function formatReportBlocks(data: DailyReportData): object[] {
  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Daily Activity Report — ${data.date}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Total Actions:* ${data.total_actions}`,
          `Answers: ${data.answers} | Transfers: ${data.transfers} | Escalations: ${data.escalations} | Holds: ${data.holds} | Other: ${data.other}`,
        ].join("\n"),
      },
    },
    { type: "divider" },
  ];

  if (data.agents.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No activity recorded today._" },
    });
    return blocks;
  }

  // Agent selector dropdown
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "static_select",
        placeholder: { type: "plain_text", text: "Select an agent for details..." },
        action_id: "daily_report_agent_select",
        options: data.agents.map((a) => ({
          text: { type: "plain_text", text: `${a.display_name} (${a.total})` },
          value: a.agent_slack_id,
        })),
      },
    ],
  });

  // Top agents summary
  for (const agent of data.agents.slice(0, 5)) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${agent.display_name}* — ${agent.total} actions\n` +
          `Answers: ${agent.answers} | Transfers: ${agent.transfers} | Escalations: ${agent.escalations} | Top: ${agent.top_channel}`,
      },
    });
  }

  return blocks;
}

// --- Sheets Formatting ---

export function formatDailySummaryRow(data: DailyReportData): string[] {
  return [
    data.date,
    String(data.total_actions),
    String(data.answers),
    String(data.transfers),
    String(data.escalations),
    String(data.holds),
    String(data.other),
  ];
}

export function formatAgentPerformanceRows(date: string, agents: DailyAgentStats[]): string[][] {
  return agents.map((a) => [
    date,
    a.display_name,
    String(a.total),
    String(a.answers),
    String(a.transfers),
    String(a.escalations),
    String(a.holds),
    String(a.other),
    a.top_channel,
  ]);
}

// --- Generate Full Report ---

export async function generateDailyReport(
  workspaceId: string,
  date?: string
): Promise<{ blocks: object[]; data: DailyReportData }> {
  const reportDate = date || new Date().toISOString().split("T")[0];
  const data = await aggregateDailyData(workspaceId, reportDate);
  const blocks = formatReportBlocks(data);

  // Write to Google Sheets
  try {
    await writeDailySummaryRow(workspaceId, formatDailySummaryRow(data));
    await writeAgentPerformanceRows(workspaceId, formatAgentPerformanceRows(reportDate, data.agents));
  } catch (err) {
    logger.error("Failed to write daily report to Sheets", {
      workspaceId,
      error: err instanceof Error ? err.message : "Unknown",
    });
  }

  return { blocks, data };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd slack-agent-app && npx vitest run tests/services/daily-report.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add slack-agent-app/src/services/daily-report.ts
git commit -m "feat: implement daily report with aggregation, Slack blocks, and Sheets output"
```

---

### Task 14: Wire /daily-report command and agent selector action

**Files:**
- Modify: `slack-agent-app/src/app.ts`

- [ ] **Step 1: Add imports**

Add at top of `app.ts`:

```typescript
import { WebClient } from "@slack/web-api";
import { generateDailyReport, aggregateDailyData, formatReportBlocks } from "./services/daily-report";
```

- [ ] **Step 2: Add /daily-report command**

Before `return app;`, add:

```typescript
  // /daily-report command
  app.command("/daily-report", async ({ command, ack, respond }: SlackCommandMiddlewareArgs) => {
    await ack();
    const { team_id } = command;

    try {
      const workspace = await getWorkspaceByTeamId(team_id);
      if (!workspace) {
        await respond({ response_type: "ephemeral", text: "Workspace not found." });
        return;
      }

      await respond({ response_type: "ephemeral", text: "Generating daily report..." });

      const { blocks } = await generateDailyReport(workspace.id);

      const reportChannelId = process.env.REPORT_CHANNEL_ID || command.channel_id;
      const token = await getDecryptedToken(team_id);
      if (!token) throw new Error("Bot token not found");

      const slackClient = new WebClient(token);
      await slackClient.chat.postMessage({
        channel: reportChannelId,
        blocks: blocks as any,
        text: "Daily Activity Report",
      });

      await respond({ response_type: "ephemeral", text: "Daily report posted!" });
    } catch (err) {
      logger.error("Error in /daily-report", { error: err instanceof Error ? err.message : "Unknown" });
      await respond({ response_type: "ephemeral", text: "Failed to generate report. Please try again." });
    }
  });

  // Agent selector action handler (from daily report)
  app.action("daily_report_agent_select", async ({ action, ack, body, respond }) => {
    await ack();
    const selectedAgent = (action as any).selected_option?.value;
    if (!selectedAgent) return;

    try {
      const teamId = (body as any).team?.id;
      if (!teamId) return;

      const workspace = await getWorkspaceByTeamId(teamId);
      if (!workspace) return;

      const today = new Date().toISOString().split("T")[0];
      const data = await aggregateDailyData(workspace.id, today);
      const agent = data.agents.find((a) => a.agent_slack_id === selectedAgent);

      if (!agent) {
        await respond({ response_type: "ephemeral", text: "No activity found for this agent today." });
        return;
      }

      // Per-channel breakdown for this agent
      const channelResult = await query(
        `SELECT c.name as channel_name, a.action_type, COUNT(*)::int as count
         FROM agent_activities a
         LEFT JOIN channels c ON c.workspace_id = a.workspace_id AND c.slack_channel_id = a.channel_slack_id
         WHERE a.workspace_id = $1 AND a.agent_slack_id = $2 AND a.created_at::date = $3::date
         GROUP BY c.name, a.action_type ORDER BY count DESC`,
        [workspace.id, selectedAgent, today]
      );

      let channelBreakdown = channelResult.rows
        .map((r: any) => `  #${r.channel_name || "unknown"}: ${r.count} ${r.action_type}(s)`)
        .join("\n");
      if (!channelBreakdown) channelBreakdown = "  No channel data available";

      await respond({
        response_type: "ephemeral",
        text: [
          `*${agent.display_name}* — Detailed Stats (${today})`,
          `Total: ${agent.total} | Answers: ${agent.answers} | Transfers: ${agent.transfers} | Escalations: ${agent.escalations} | Holds: ${agent.holds}`,
          `Top Channel: ${agent.top_channel}`,
          `\n*Per-Channel Breakdown:*`,
          channelBreakdown,
        ].join("\n"),
      });
    } catch (err) {
      logger.error("Error in agent select action", { error: err instanceof Error ? err.message : "Unknown" });
    }
  });
```

- [ ] **Step 3: Verify imports**

Confirm these imports already exist at top of `app.ts` (added in Task 7):
- `getWorkspaceByTeamId`, `getDecryptedToken` from `./services/workspace`
- `WebClient` from `@slack/web-api`
- `query` from `./db/client`

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd slack-agent-app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add slack-agent-app/src/app.ts
git commit -m "feat: add /daily-report command and agent selector action handler"
```

---

### Task 15: Add cron scheduler and periodic flush to server.ts

**Files:**
- Modify: `slack-agent-app/src/server.ts`

- [ ] **Step 1: Add imports and cron scheduling**

In `server.ts`, add imports after existing ones:

```typescript
import cron from "node-cron";
import { startPeriodicFlush } from "./services/google-sheets";
import { generateDailyReport } from "./services/daily-report";
import { listActiveWorkspaces } from "./services/workspace";
```

After `expressApp.listen(PORT, ...)` callback, add:

```typescript
    // Start periodic Sheets buffer flush (every 10 seconds)
    startPeriodicFlush(10000);
    logger.info("Google Sheets periodic flush started");

    // Schedule daily report
    const reportTime = process.env.REPORT_TIME || "18:00";
    const [hour, minute] = reportTime.split(":");
    const timezone = process.env.REPORT_TIMEZONE || "America/New_York";

    cron.schedule(`${minute} ${hour} * * *`, async () => {
      logger.info("Running scheduled daily report");
      const reportChannelId = process.env.REPORT_CHANNEL_ID;
      if (!reportChannelId) {
        logger.warn("REPORT_CHANNEL_ID not set, skipping scheduled report");
        return;
      }

      try {
        const workspaces = await listActiveWorkspaces();
        for (const ws of workspaces) {
          const { blocks } = await generateDailyReport(ws.id);

          // Post to Slack
          const { getDecryptedToken } = await import("./services/workspace");
          const token = await getDecryptedToken(ws.slack_team_id);
          if (token) {
            const { WebClient } = await import("@slack/web-api");
            const client = new WebClient(token);
            await client.chat.postMessage({
              channel: reportChannelId,
              blocks: blocks as any,
              text: "Daily Activity Report",
            });
          }

          logger.info("Daily report generated and posted", { workspaceId: ws.id });
        }
      } catch (err) {
        logger.error("Scheduled report failed", {
          error: err instanceof Error ? err.message : "Unknown",
        });
      }
    }, { timezone });

    logger.info(`Daily report scheduled at ${reportTime} ${timezone}`);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd slack-agent-app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add slack-agent-app/src/server.ts
git commit -m "feat: add cron-scheduled daily report and periodic Sheets buffer flush"
```

---

## Chunk 5: E2E Mock Test Script

### Task 16: Create mock test script

**Files:**
- Create: `slack-agent-app/scripts/mock-test.ts`

- [ ] **Step 1: Create scripts directory**

```bash
mkdir -p slack-agent-app/scripts
```

- [ ] **Step 2: Write mock-test.ts**

Create `slack-agent-app/scripts/mock-test.ts`:

```typescript
import dotenv from "dotenv";
dotenv.config();

import { WebClient } from "@slack/web-api";
import { Pool } from "pg";

const MOCK_PREFIX = "[MOCK-TEST]";

// Mock agent messages with expected classifications
const MOCK_MESSAGES = [
  { text: `${MOCK_PREFIX} Just answered a customer about their refund status in billing`, expected: "answer" },
  { text: `${MOCK_PREFIX} Transferred the VIP client to the retention team`, expected: "transfer" },
  { text: `${MOCK_PREFIX} Escalated ticket #4521 to senior support — needs immediate attention`, expected: "escalation" },
  { text: `${MOCK_PREFIX} Put the caller on hold while checking inventory`, expected: "hold" },
  { text: `${MOCK_PREFIX} Resolved a shipping delay inquiry for order #8834`, expected: "answer" },
  { text: `${MOCK_PREFIX} Handed off the enterprise client to account management`, expected: "transfer" },
  { text: `${MOCK_PREFIX} Customer asked about premium plan pricing, gave them the full comparison`, expected: "answer" },
  { text: `${MOCK_PREFIX} Escalated the network outage to the infrastructure team immediately`, expected: "escalation" },
  { text: `${MOCK_PREFIX} Answered the billing dispute — customer was overcharged by $50`, expected: "answer" },
  { text: `${MOCK_PREFIX} Transferred the Spanish-speaking customer to our bilingual support team`, expected: "transfer" },
  { text: `${MOCK_PREFIX} Put client on hold to verify their account details with the backend`, expected: "hold" },
  { text: `${MOCK_PREFIX} Took care of a returns question about their damaged package`, expected: "answer" },
  // Non-activity messages (should be ignored)
  { text: `${MOCK_PREFIX} Hey team, lunch is here!`, expected: null },
  { text: `${MOCK_PREFIX} Meeting in 5 minutes everyone`, expected: null },
  { text: `${MOCK_PREFIX} Happy Friday! Anyone want coffee?`, expected: null },
];

async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  const slack = new WebClient(token);
  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  // Get channels the bot is in
  const channelsResult = await slack.conversations.list({ types: "public_channel", limit: 10 });
  const channels = (channelsResult.channels || []).filter((c) => c.is_member).slice(0, 3);

  if (channels.length === 0) {
    console.error("Bot is not a member of any channels. Add the bot to at least one channel first.");
    process.exit(1);
  }

  console.log(`\nPosting ${MOCK_MESSAGES.length} mock messages across ${channels.length} channels...\n`);

  const expectedActivities = MOCK_MESSAGES.filter((m) => m.expected !== null).length;
  let posted = 0;

  // Post messages across channels
  for (let i = 0; i < MOCK_MESSAGES.length; i++) {
    const channel = channels[i % channels.length];
    const msg = MOCK_MESSAGES[i];

    try {
      await slack.chat.postMessage({
        channel: channel.id!,
        text: msg.text,
      });
      posted++;
      console.log(`  [${posted}/${MOCK_MESSAGES.length}] → #${channel.name}: "${msg.text.slice(0, 60)}..." (expect: ${msg.expected || "IGNORE"})`);
    } catch (err) {
      console.error(`  FAILED to post to #${channel.name}:`, err);
    }

    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 1200));
  }

  console.log(`\nPosted ${posted} messages. Waiting for bot to process (30s)...\n`);
  await new Promise((r) => setTimeout(r, 30000));

  // Verify DB entries
  const dbResult = await pool.query(
    `SELECT action_type, raw_message, confidence FROM agent_activities WHERE raw_message LIKE $1 ORDER BY created_at DESC`,
    [`${MOCK_PREFIX}%`]
  );

  console.log(`\n=== RESULTS ===`);
  console.log(`Expected activities: ${expectedActivities}`);
  console.log(`Found in DB: ${dbResult.rows.length}`);
  console.log(`Match rate: ${((dbResult.rows.length / expectedActivities) * 100).toFixed(1)}%\n`);

  for (const row of dbResult.rows) {
    console.log(`  [${row.action_type}] (conf: ${Number(row.confidence).toFixed(2)}) ${row.raw_message.slice(0, 70)}...`);
  }

  // Verify non-activity was NOT stored
  const nonActivityStored = dbResult.rows.filter((r) =>
    MOCK_MESSAGES.some((m) => m.expected === null && r.raw_message === m.text)
  );
  if (nonActivityStored.length > 0) {
    console.log(`\n  WARNING: ${nonActivityStored.length} non-activity messages were incorrectly stored!`);
  } else {
    console.log(`\n  Non-activity filtering: PASS (0 false positives)`);
  }

  // Cleanup
  console.log(`\nCleaning up test data...`);
  const deleted = await pool.query(
    `DELETE FROM agent_activities WHERE raw_message LIKE $1`,
    [`${MOCK_PREFIX}%`]
  );
  console.log(`  Deleted ${deleted.rowCount} test rows from agent_activities.`);

  await pool.end();

  const pass = dbResult.rows.length >= expectedActivities * 0.8;
  console.log(`\n${pass ? "PASS" : "FAIL"}: E2E mock test ${pass ? "completed successfully" : "below 80% threshold"}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("Mock test failed:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Add run script to package.json**

In `package.json`, add to `"scripts"`:

```json
"mock-test": "tsx scripts/mock-test.ts"
```

- [ ] **Step 4: Commit**

```bash
git add slack-agent-app/scripts/mock-test.ts slack-agent-app/package.json
git commit -m "feat: add E2E mock test script with 15 test messages and auto-cleanup"
```

---

### Task 17: Run all unit tests

- [ ] **Step 1: Run full test suite**

Run: `cd slack-agent-app && npm test`
Expected: All tests pass (existing + new)

- [ ] **Step 2: Fix any failures and re-run**

If failures, fix and re-run until all pass.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve test issues from integration"
```

---

### Task 18: Run database migration

- [ ] **Step 1: Apply migration to Supabase**

Run: `cd slack-agent-app && cat src/db/migrations/002-agent-activities.sql | npx tsx -e "
import dotenv from 'dotenv'; dotenv.config();
import { getPool } from './src/db/client';
import fs from 'fs';
const sql = fs.readFileSync('src/db/migrations/002-agent-activities.sql', 'utf8');
getPool().query(sql).then(() => { console.log('Migration applied'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
"`

Or connect directly:
```bash
psql "$DATABASE_URL" -f src/db/migrations/002-agent-activities.sql
```

Expected: Tables `agent_activities` and `google_auth` created

- [ ] **Step 2: Verify tables exist**

```bash
psql "$DATABASE_URL" -c "\dt agent_activities; \dt google_auth;"
```

---

### Task 19: Run E2E mock test

- [ ] **Step 1: Start the bot in dev mode**

```bash
cd slack-agent-app && npm run dev
```

- [ ] **Step 2: In a separate terminal, run mock test**

```bash
cd slack-agent-app && npm run mock-test
```

Expected: Output shows ~80%+ match rate, non-activity filtering passes, test data cleaned up.

- [ ] **Step 3: Verify results and iterate**

If classification accuracy is low, adjust the system prompt in `message-interpreter.ts` and re-run.

---

## Execution Summary

| Task | Component | Est. |
|------|-----------|------|
| 1 | Install dependencies | 2 min |
| 2 | TypeScript interfaces | 3 min |
| 3 | Database migration file | 3 min |
| 4 | Env vars | 2 min |
| 5-6 | Message interpreter (TDD) | 10 min |
| 7 | Wire message listener | 5 min |
| 8-9 | Google Sheets service (TDD) | 10 min |
| 10 | Google OAuth callback | 5 min |
| 11 | Connect/disconnect commands | 5 min |
| 12-13 | Daily report service (TDD) | 10 min |
| 14 | Daily report command + action | 5 min |
| 15 | Cron scheduler | 3 min |
| 16 | E2E mock test script | 5 min |
| 17-19 | Run tests + migration + E2E | 10 min |
