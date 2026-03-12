import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import express from "express";
import cron from "node-cron";
import { createApp } from "./app";
import { handleInstall } from "./oauth/install";
import { handleCallback } from "./oauth/callback";
import { handleGoogleOAuthCallback } from "./oauth/google-callback";
import { startPeriodicFlush } from "./services/google-sheets";
import { generateDailyReport } from "./services/daily-report";
import { listActiveWorkspaces, getDecryptedToken } from "./services/workspace";
import { WebClient } from "@slack/web-api";
import { logger } from "./utils/logger";

const PORT = parseInt(process.env.PORT || "3000", 10);

// Initialize Bolt app with socket mode
const boltApp = createApp();

// Separate Express server for OAuth + health check
const expressApp = express();

expressApp.use(express.json());

// Health check
expressApp.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// OAuth routes
expressApp.get("/slack/install", handleInstall);
expressApp.get("/slack/oauth/callback", handleCallback);
expressApp.get("/google/oauth/callback", handleGoogleOAuthCallback);

// Start both: Bolt (socket mode) + Express (OAuth/health)
(async () => {
  await boltApp.start();
  logger.info("Bolt app started in socket mode");

  expressApp.listen(PORT, () => {
    logger.info(`Express server running on port ${PORT}`, {
      environment: process.env.NODE_ENV || "development",
    });
  });

  // Start periodic Google Sheets buffer flush (every 10 seconds)
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

        const token = await getDecryptedToken(ws.slack_team_id);
        if (token) {
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
})();

export { boltApp, expressApp };
