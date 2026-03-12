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
