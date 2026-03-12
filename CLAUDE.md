# LS Agent Hub - Slack Bot

## Project Overview
Multi-tenant Slack bot (LS Agent Hub) that monitors agent activity in Slack channels, interprets messages using AI, logs data to PostgreSQL + Google Sheets, and generates end-of-day reports with per-agent tallies.

## Tech Stack
- Node.js 20, TypeScript 5.9
- @slack/bolt (Socket Mode), Express 5
- PostgreSQL (Supabase), @anthropic-ai/sdk (Claude)
- Vitest for testing
- Docker + Docker Compose

## Key Directories
- `slack-agent-app/src/` — main source code
- `slack-agent-app/src/services/` — business logic (agent-responder, tally, data-sync, workspace)
- `slack-agent-app/src/db/` — database client + schema
- `slack-agent-app/tests/` — test suites

## Development Preferences
- Always use `AskUserQuestion` tool during planning/brainstorming for better UI and clearer communication
- Keep responses concise; the user reads diffs and doesn't need trailing summaries
- Follow existing code patterns (services layer, structured logging, encrypted tokens)
- Use Vitest for all tests

## Commands
```bash
cd slack-agent-app
npm install        # Install dependencies
npm run dev        # Dev server (tsx watch)
npm run build      # Compile TypeScript
npm test           # Run tests
```
