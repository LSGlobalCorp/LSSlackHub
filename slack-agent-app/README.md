# LS Agent Hub

AI-powered multi-tenant Slack agent response system. Build once, install into any workspace via OAuth.

## Features

- **Agent Responses**: AI-generated answers posted in Slack channels via `/agent-respond` or @mentions
- **Tally Dashboard**: Response analytics for team leads via `/tally`
- **Data Sync**: Automatic workspace data sync (channels, users, messages) via `/sync-data`
- **Multi-Tenant**: Install into unlimited workspaces — each gets isolated data and encrypted tokens

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL (or Supabase)
- A Slack App created at [api.slack.com/apps](https://api.slack.com/apps)
- Anthropic API key

### 1. Clone and install

```bash
cd slack-agent-app
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|----------|-------------|
| `SLACK_CLIENT_ID` | From Slack app Basic Information |
| `SLACK_CLIENT_SECRET` | From Slack app Basic Information |
| `SLACK_SIGNING_SECRET` | From Slack app Basic Information |
| `SLACK_STATE_SECRET` | Random string for OAuth state |
| `ENCRYPTION_KEY` | Run `openssl rand -hex 32` |
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | From Anthropic console |
| `APP_URL` | Your public HTTPS URL |
| `PORT` | Default: 3000 |

### 3. Set up the database

```bash
psql $DATABASE_URL -f src/db/schema.sql
```

### 4. Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From an app manifest
2. Paste the contents of `manifest.yml`
3. Update the redirect URL to match your `APP_URL`
4. Copy Client ID, Client Secret, and Signing Secret to `.env`

### 5. Run

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

### Docker

```bash
docker compose up -d
```

## Client Installation

Share your install link with clients:

```
https://your-domain.com/slack/install
```

The client admin clicks the link → sees OAuth consent → clicks Allow → done. No developer portal access needed.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/agent-respond [question]` | Generate and post an AI response |
| `/tally [today\|week\|month]` | Show agent response stats |
| `/tally agent:@user` | Filter tally by agent |
| `/tally week csv` | Export tally as CSV |
| `/sync-data` | Sync workspace channels and users |

## Deployment

Works with Railway, Render, Fly.io, or any VPS with Docker support.

### Railway / Render

1. Connect your repo
2. Set environment variables
3. Deploy — the Dockerfile handles the rest

### VPS

```bash
docker compose up -d
```

## Testing

```bash
npm test
```

## Architecture

```
Client Workspace → OAuth Install → Your Server → Encrypted Token Storage
                                         ↓
                    Slash Commands / Events → AI Response → Post to Channel
                                         ↓
                    Cron / Manual Trigger → Data Sync → Your Database
```
