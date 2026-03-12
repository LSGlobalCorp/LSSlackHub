import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";

// In-memory state store with TTL (10 minutes)
const stateStore = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

export function generateState(): string {
  const state = uuidv4();
  stateStore.set(state, Date.now());
  return state;
}

export function validateState(state: string): boolean {
  const created = stateStore.get(state);
  if (!created) return false;

  stateStore.delete(state);

  if (Date.now() - created > STATE_TTL_MS) return false;

  return true;
}

export function clearStateStore(): void {
  stateStore.clear();
}

export function handleInstall(req: Request, res: Response): void {
  const clientId = process.env.SLACK_CLIENT_ID;
  const appUrl = process.env.APP_URL;

  if (!clientId || !appUrl) {
    logger.error("Missing SLACK_CLIENT_ID or APP_URL");
    res.status(500).send("Server configuration error");
    return;
  }

  const state = generateState();
  const redirectUri = `${appUrl}/slack/oauth/callback`;

  const scopes = [
    "chat:write",
    "chat:write.public",
    "channels:read",
    "channels:history",
    "groups:read",
    "groups:history",
    "users:read",
    "users:read.email",
    "commands",
    "im:read",
    "im:write",
    "team:read",
    "reactions:read",
    "reactions:write",
  ].join(",");

  const slackAuthUrl =
    `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Install LS Agent Hub</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f9fa; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; padding: 48px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; max-width: 480px; }
    h1 { font-size: 28px; color: #1a1a1a; margin-bottom: 12px; }
    p { color: #666; font-size: 16px; line-height: 1.5; margin-bottom: 32px; }
    .btn { display: inline-block; background: #1A73E8; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; transition: background 0.2s; }
    .btn:hover { background: #1557b0; }
    .features { text-align: left; margin: 24px 0; }
    .features li { color: #444; padding: 6px 0; list-style: none; }
    .features li::before { content: "\\2713"; color: #1A73E8; font-weight: bold; margin-right: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>LS Agent Hub</h1>
    <p>AI-powered agent response system for your Slack workspace</p>
    <ul class="features">
      <li>AI-generated answers posted in your channels</li>
      <li>Agent response tally and analytics</li>
      <li>Automatic workspace data sync</li>
    </ul>
    <a href="${slackAuthUrl}" class="btn">Add to Slack</a>
  </div>
</body>
</html>`;

  res.set("Content-Type", "text/html");
  res.send(html);
}
