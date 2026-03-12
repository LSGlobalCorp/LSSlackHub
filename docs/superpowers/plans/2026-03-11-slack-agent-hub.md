# LS Agent Hub - Slack App Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready multi-tenant Slack App (Node.js + TypeScript + Bolt) that posts AI-generated agent responses, provides tally dashboards for team leads, and syncs workspace data — installable into any Slack workspace via OAuth.

**Architecture:** Express server hosts OAuth install/callback endpoints alongside Bolt's Slack event handling. Each workspace gets an encrypted bot token stored in Postgres. Services are isolated by workspace_id for full multi-tenancy. Claude API generates agent responses.

**Tech Stack:** Node.js 20, TypeScript, @slack/bolt, Express, PostgreSQL (Supabase), Anthropic SDK, AES-256-GCM encryption, Docker, Vitest for testing.

---

## File Structure

```
slack-agent-app/
  src/
    app.ts                    # Bolt app initialization + event handlers
    server.ts                 # Express server for OAuth + health checks (entry point)
    oauth/
      install.ts              # GET /slack/install — "Add to Slack" landing page
      callback.ts             # GET /slack/oauth/callback — exchange code for token
    services/
      workspace.ts            # Multi-tenant workspace CRUD
      agent-responder.ts      # AI answer generation + posting
      tally.ts                # Team lead tally/review logic
      data-sync.ts            # Pull channels, users, messages per workspace
    db/
      client.ts               # Postgres pool client
      schema.sql              # All table DDL
    middleware/
      auth.ts                 # Slack signature verification
      rate-limit.ts           # Per-workspace rate limiting
    utils/
      logger.ts               # Structured logging (redacts tokens)
      crypto.ts               # AES-256-GCM encrypt/decrypt
    types/
      index.ts                # Shared TypeScript interfaces
  tests/
    utils/crypto.test.ts
    db/client.test.ts
    services/workspace.test.ts
    services/agent-responder.test.ts
    services/tally.test.ts
    services/data-sync.test.ts
    oauth/callback.test.ts
    oauth/install.test.ts
    middleware/auth.test.ts
    middleware/rate-limit.test.ts
    integration/oauth-flow.test.ts
    integration/slash-commands.test.ts
  manifest.yml
  .env.example
  package.json
  tsconfig.json
  Dockerfile
  docker-compose.yml
```

---

## Chunk 1: Project Foundation

### Task 1: Initialize Node.js + TypeScript project

**Files:**
- Create: `slack-agent-app/package.json`
- Create: `slack-agent-app/tsconfig.json`
- Create: `slack-agent-app/.env.example`
- Create: `slack-agent-app/manifest.yml`
- Create: `slack-agent-app/.gitignore`

- [ ] **Step 1: Create project directory and initialize npm**

```bash
mkdir -p slack-agent-app && cd slack-agent-app && npm init -y
```

- [ ] **Step 2: Install production dependencies**

```bash
npm install @slack/bolt express pg dotenv @anthropic-ai/sdk uuid
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D typescript @types/node @types/express @types/pg @types/uuid vitest tsx
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Create .env.example**

```
SLACK_CLIENT_ID=your_app_client_id
SLACK_CLIENT_SECRET=your_app_client_secret
SLACK_SIGNING_SECRET=your_signing_secret
SLACK_STATE_SECRET=random_string_for_oauth_state
ENCRYPTION_KEY=32_byte_hex_key_for_token_encryption
DATABASE_URL=postgresql://user:pass@host:5432/db
ANTHROPIC_API_KEY=sk-ant-...
APP_URL=https://your-domain.com
PORT=3000
NODE_ENV=development
```

- [ ] **Step 6: Create manifest.yml**

Full Slack app manifest with bot scopes, slash commands, event subscriptions.

- [ ] **Step 7: Create .gitignore**

Standard Node.js gitignore + .env, dist/, node_modules/.

- [ ] **Step 8: Add npm scripts to package.json**

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 9: Commit**

```bash
git init && git add -A && git commit -m "chore: initialize project with TypeScript, deps, and Slack manifest"
```

---

### Task 2: TypeScript types and shared interfaces

**Files:**
- Create: `slack-agent-app/src/types/index.ts`

- [ ] **Step 1: Define all shared interfaces**

Workspace, Channel, User, Response, Message, OAuthState, EncryptedToken types.

- [ ] **Step 2: Commit**

```bash
git add src/types/ && git commit -m "feat: add shared TypeScript interfaces"
```

---

### Task 3: Structured logger utility

**Files:**
- Create: `slack-agent-app/src/utils/logger.ts`
- Create: `slack-agent-app/tests/utils/logger.test.ts`

- [ ] **Step 1: Write failing test for logger redaction**

Test that logger.info({token: "xoxb-secret"}) redacts the token value.

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement logger with redaction**

JSON structured logger that replaces any value matching `xoxb-*` or `xoxp-*` patterns with `[REDACTED]`.

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

---

### Task 4: AES-256-GCM crypto utility

**Files:**
- Create: `slack-agent-app/src/utils/crypto.ts`
- Create: `slack-agent-app/tests/utils/crypto.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("crypto", () => {
  it("encrypts and decrypts a token round-trip", () => {
    const token = "xoxb-test-token-12345";
    const encrypted = encrypt(token);
    expect(encrypted).not.toBe(token);
    expect(encrypted).toContain(":"); // iv:authTag:ciphertext
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(token);
  });

  it("produces different ciphertexts for same input (random IV)", () => {
    const token = "xoxb-test-token";
    const a = encrypt(token);
    const b = encrypt(token);
    expect(a).not.toBe(b);
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("xoxb-test");
    const tampered = encrypted.slice(0, -2) + "ff";
    expect(() => decrypt(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement encrypt/decrypt using Node.js crypto**

Uses `crypto.createCipheriv("aes-256-gcm")` with random 12-byte IV, 16-byte auth tag. Format: `iv_hex:authTag_hex:ciphertext_hex`. Key from `ENCRYPTION_KEY` env var.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

### Task 5: Database client and schema

**Files:**
- Create: `slack-agent-app/src/db/client.ts`
- Create: `slack-agent-app/src/db/schema.sql`

- [ ] **Step 1: Write schema.sql**

All 5 tables: workspaces, channels, users, responses, messages — with UUIDs, foreign keys, unique constraints, indexes.

- [ ] **Step 2: Implement db client**

Singleton pg.Pool using `DATABASE_URL`. Export `query()` helper and `getPool()`.

- [ ] **Step 3: Commit**

---

## Chunk 2: Core Services

### Task 6: Workspace service (multi-tenant CRUD)

**Files:**
- Create: `slack-agent-app/src/services/workspace.ts`
- Create: `slack-agent-app/tests/services/workspace.test.ts`

- [ ] **Step 1: Write failing tests**

Tests for: `createWorkspace()`, `getWorkspaceByTeamId()`, `getDecryptedToken()`, `deactivateWorkspace()`. Mock the db module.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement workspace service**

- `createWorkspace(teamId, teamName, botToken, botUserId, installedBy)` — encrypts token, inserts row, returns workspace
- `getWorkspaceByTeamId(teamId)` — fetches workspace row
- `getDecryptedToken(teamId)` — fetches + decrypts bot token
- `deactivateWorkspace(teamId)` — sets is_active = false
- `listActiveWorkspaces()` — returns all active workspaces

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

### Task 7: Auth middleware (Slack signature verification)

**Files:**
- Create: `slack-agent-app/src/middleware/auth.ts`
- Create: `slack-agent-app/tests/middleware/auth.test.ts`

- [ ] **Step 1: Write failing tests**

Test valid signature passes, invalid signature returns 401, expired timestamp returns 401.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement verifySlackSignature middleware**

Uses `crypto.timingSafeEqual` to compare HMAC-SHA256 of `v0:timestamp:body` against `X-Slack-Signature`. Rejects if timestamp > 5 min old.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

### Task 8: Per-workspace rate limiter

**Files:**
- Create: `slack-agent-app/src/middleware/rate-limit.ts`
- Create: `slack-agent-app/tests/middleware/rate-limit.test.ts`

- [ ] **Step 1: Write failing tests**

Test: allows requests under limit, blocks at 100/min, resets after window, isolates per workspace.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement sliding window rate limiter**

In-memory Map<workspaceId, {count, windowStart}>. 100 req/min default. Returns 429 with Retry-After header.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

## Chunk 3: OAuth Flow

### Task 9: OAuth install endpoint

**Files:**
- Create: `slack-agent-app/src/oauth/install.ts`
- Create: `slack-agent-app/tests/oauth/install.test.ts`

- [ ] **Step 1: Write failing tests**

Test: returns HTML page with "Add to Slack" button, generates state parameter, redirects to Slack authorize URL with correct params.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement install handler**

GET `/slack/install` — generates UUID state, stores in-memory (Map with TTL), returns HTML page with styled "Add to Slack" button linking to `https://slack.com/oauth/v2/authorize?client_id=...&scope=...&redirect_uri=...&state=...`

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

### Task 10: OAuth callback endpoint

**Files:**
- Create: `slack-agent-app/src/oauth/callback.ts`
- Create: `slack-agent-app/tests/oauth/callback.test.ts`

- [ ] **Step 1: Write failing tests**

Test: verifies state, exchanges code for token via Slack API, encrypts and stores token, handles errors (invalid state, API failure).

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement callback handler**

GET `/slack/oauth/callback`:
1. Verify `state` matches stored state
2. POST to `https://slack.com/api/oauth.v2.access` with code, client_id, client_secret, redirect_uri
3. Extract access_token, team.id, team.name, bot_user_id, authed_user.id
4. Call `workspace.createWorkspace(...)` to encrypt and store
5. Trigger initial data sync
6. Redirect to success page

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

## Chunk 4: AI Agent Response System

### Task 11: Agent responder service

**Files:**
- Create: `slack-agent-app/src/services/agent-responder.ts`
- Create: `slack-agent-app/tests/services/agent-responder.test.ts`

- [ ] **Step 1: Write failing tests**

Test: generates AI response via Claude API, posts to correct channel, handles thread replies (thread_ts), logs response to DB.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement agent responder**

- `generateResponse(question, context)` — calls Anthropic SDK with system prompt + question
- `postResponse(teamId, channelId, answer, threadTs?)` — gets decrypted token, calls chat.postMessage
- `logResponse(workspaceId, agentId, channelId, question, answer, threadTs, messageTs)` — inserts into responses table

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

## Chunk 5: Tally Dashboard

### Task 12: Tally service

**Files:**
- Create: `slack-agent-app/src/services/tally.ts`
- Create: `slack-agent-app/tests/services/tally.test.ts`

- [ ] **Step 1: Write failing tests**

Test: counts responses per agent for today/week/month, filters by agent, formats Block Kit message, generates CSV export.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement tally service**

- `getTally(workspaceId, timeframe, agentFilter?)` — queries responses table with date range
- `formatTallyBlocks(tallyData)` — returns Slack Block Kit sections with dividers
- `generateCsvExport(tallyData)` — returns CSV string

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

## Chunk 6: Data Sync

### Task 13: Data sync service

**Files:**
- Create: `slack-agent-app/src/services/data-sync.ts`
- Create: `slack-agent-app/tests/services/data-sync.test.ts`

- [ ] **Step 1: Write failing tests**

Test: fetches paginated channels, fetches paginated users, fetches message history, handles rate limits (Retry-After), stores all data keyed by workspace_id.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement data sync**

- `syncChannels(teamId)` — paginated conversations.list, upsert into channels table
- `syncUsers(teamId)` — paginated users.list, upsert into users table
- `syncMessages(teamId, channelId)` — paginated conversations.history, upsert into messages table
- `syncAll(teamId)` — orchestrates all syncs with exponential backoff
- Helper: `paginatedFetch(method, params)` — handles cursor pagination + Retry-After

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

## Chunk 7: Bolt App + Express Server

### Task 14: Bolt app initialization + event/command handlers

**Files:**
- Create: `slack-agent-app/src/app.ts`

- [ ] **Step 1: Initialize Bolt app**

Create Bolt App instance with signing secret. Register:
- `/agent-respond` command handler → calls agent-responder service
- `/tally` command handler → calls tally service, posts Block Kit response
- `/sync-data` command handler → triggers data sync, posts ephemeral confirmation
- `app_mention` event handler → calls agent-responder service
- `message.channels` / `message.groups` event handlers → optional logging
- `reaction_added` event handler → updates response reaction counts

- [ ] **Step 2: Commit**

---

### Task 15: Express server (entry point)

**Files:**
- Create: `slack-agent-app/src/server.ts`

- [ ] **Step 1: Implement Express server**

- Mount Bolt's receiver at `/slack/events`
- Mount OAuth routes: GET `/slack/install`, GET `/slack/oauth/callback`
- Health check: GET `/health` returns `{ status: "ok", timestamp }`
- Apply rate-limit middleware to Slack routes
- Apply CORS headers to `/slack/install` only
- Start server on `PORT` env var

- [ ] **Step 2: Verify server starts with `npm run dev`**

- [ ] **Step 3: Commit**

---

## Chunk 8: Docker + Deployment

### Task 16: Dockerfile and docker-compose

**Files:**
- Create: `slack-agent-app/Dockerfile`
- Create: `slack-agent-app/docker-compose.yml`

- [ ] **Step 1: Create Dockerfile**

Multi-stage build: Node 20 Alpine, install deps, build TypeScript, copy dist, run with non-root user.

- [ ] **Step 2: Create docker-compose.yml**

Services: app (builds from Dockerfile, env_file, port 3000) + postgres (image: postgres:16, volume, health check).

- [ ] **Step 3: Commit**

---

### Task 17: README with setup + deployment instructions

**Files:**
- Create: `slack-agent-app/README.md`

- [ ] **Step 1: Write README**

Sections: Overview, Prerequisites, Quick Start, Environment Variables, Database Setup, Slack App Setup, Deployment (Railway/Render/VPS), Client Installation Flow, Development.

- [ ] **Step 2: Commit**

---

## Chunk 9: Integration Tests

### Task 18: Integration tests

**Files:**
- Create: `slack-agent-app/tests/integration/oauth-flow.test.ts`
- Create: `slack-agent-app/tests/integration/slash-commands.test.ts`

- [ ] **Step 1: Write OAuth flow integration test**

Mock Slack API responses. Test full flow: install → callback → token stored → workspace active.

- [ ] **Step 2: Write slash command integration tests**

Mock Slack payloads for /agent-respond, /tally, /sync-data. Verify correct responses and DB writes.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "feat: complete LS Agent Hub Slack app"
```
