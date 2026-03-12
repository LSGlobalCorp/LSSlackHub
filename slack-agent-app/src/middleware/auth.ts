import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

export function verifySlackSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    logger.error("SLACK_SIGNING_SECRET not configured");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const slackSignature = req.headers["x-slack-signature"] as string;

  if (!timestamp || !slackSignature) {
    res.status(401).json({ error: "Missing Slack signature headers" });
    return;
  }

  // Reject requests older than 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > MAX_TIMESTAMP_AGE_SECONDS) {
    res.status(401).json({ error: "Request timestamp too old" });
    return;
  }

  const body = (req as Request & { rawBody?: string }).rawBody || "";
  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(sigBasestring)
      .digest("hex");

  const myBuf = Buffer.from(mySignature);
  const theirBuf = Buffer.from(slackSignature);

  if (
    myBuf.length !== theirBuf.length ||
    !crypto.timingSafeEqual(myBuf, theirBuf)
  ) {
    logger.warn("Invalid Slack signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  next();
}
