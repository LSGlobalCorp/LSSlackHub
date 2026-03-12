import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createApp } from "./app";
import { handleInstall } from "./oauth/install";
import { handleCallback } from "./oauth/callback";
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

// Start both: Bolt (socket mode) + Express (OAuth/health)
(async () => {
  await boltApp.start();
  logger.info("Bolt app started in socket mode");

  expressApp.listen(PORT, () => {
    logger.info(`Express server running on port ${PORT}`, {
      environment: process.env.NODE_ENV || "development",
    });
  });
})();

export { boltApp, expressApp };
