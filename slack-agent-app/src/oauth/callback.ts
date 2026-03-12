import { Request, Response } from "express";
import { validateState } from "./install";
import { createWorkspace } from "../services/workspace";
import { logger } from "../utils/logger";
import { OAuthTokenResponse } from "../types";

export async function handleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    logger.warn("OAuth denied by user", { error });
    res.status(400).send(errorPage("Installation was cancelled or denied."));
    return;
  }

  if (!code || !state) {
    res.status(400).send(errorPage("Missing code or state parameter."));
    return;
  }

  if (!validateState(state)) {
    res.status(400).send(errorPage("Invalid or expired state. Please try installing again."));
    return;
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    logger.error("Missing OAuth environment variables");
    res.status(500).send(errorPage("Server configuration error."));
    return;
  }

  try {
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${appUrl}/slack/oauth/callback`,
      }),
    });

    const data: OAuthTokenResponse = await tokenResponse.json() as OAuthTokenResponse;

    if (!data.ok || !data.access_token) {
      logger.error("OAuth token exchange failed", { error: data.error });
      res.status(400).send(errorPage(`Slack API error: ${data.error || "Unknown error"}`));
      return;
    }

    await createWorkspace(
      data.team.id,
      data.team.name,
      data.access_token,
      data.bot_user_id,
      data.authed_user.id
    );

    logger.info("Workspace installed successfully", {
      teamId: data.team.id,
      teamName: data.team.name,
    });

    res.send(successPage(data.team.name));
  } catch (err) {
    logger.error("OAuth callback error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    res.status(500).send(errorPage("An unexpected error occurred. Please try again."));
  }
}

function successPage(teamName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Installation Complete</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f8f9fa; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; padding: 48px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; max-width: 480px; }
    h1 { color: #1a8; font-size: 24px; margin-bottom: 12px; }
    p { color: #666; font-size: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Successfully Installed!</h1>
    <p>LS Agent Hub has been installed to <strong>${teamName}</strong>.</p>
    <p style="margin-top: 16px;">You can now use /agent-respond, /tally, and /sync-data in your Slack workspace.</p>
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Installation Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f8f9fa; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; padding: 48px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; max-width: 480px; }
    h1 { color: #d32f2f; font-size: 24px; margin-bottom: 12px; }
    p { color: #666; font-size: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Installation Error</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
