import { Request, Response } from "express";
import { WebClient } from "@slack/web-api";
import { handleGoogleCallback } from "../services/google-sheets";
import { getDecryptedToken } from "../services/workspace";
import { logger } from "../utils/logger";

export async function handleGoogleOAuthCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    logger.warn("Google OAuth denied", { error });
    res.status(400).send(page("Connection Cancelled", "Google Sheets connection was cancelled.", true));
    return;
  }

  if (!code || !state) {
    res.status(400).send(page("Error", "Missing authorization code or workspace ID.", true));
    return;
  }

  // Parse state: "teamId" or "teamId:channelId"
  const [teamId, channelId] = state.split(":");

  try {
    const sheetId = await handleGoogleCallback(code, teamId);

    // Send confirmation to Slack
    if (channelId) {
      try {
        const token = await getDecryptedToken(teamId);
        if (token) {
          const client = new WebClient(token);
          await client.chat.postMessage({
            channel: channelId,
            text: `:white_check_mark: *Google Sheets connected!*\n\nA spreadsheet has been created to track agent activity.\n<https://docs.google.com/spreadsheets/d/${sheetId}|Open Google Sheet>`,
          });
        }
      } catch (slackErr) {
        logger.warn("Failed to send Sheets confirmation to Slack", {
          error: slackErr instanceof Error ? slackErr.message : "Unknown",
        });
      }
    }

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
