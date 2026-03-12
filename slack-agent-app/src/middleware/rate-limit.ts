import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const limits = new Map<string, RateLimitEntry>();
const DEFAULT_MAX_REQUESTS = 100;
const WINDOW_MS = 60_000; // 1 minute

export function rateLimiter(maxRequests: number = DEFAULT_MAX_REQUESTS) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const workspaceId =
      (req.body?.team_id as string) ||
      (req.query?.team_id as string) ||
      "unknown";

    const now = Date.now();
    const entry = limits.get(workspaceId);

    if (!entry || now - entry.windowStart > WINDOW_MS) {
      limits.set(workspaceId, { count: 1, windowStart: now });
      next();
      return;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
      logger.warn("Rate limit exceeded", { workspaceId, count: entry.count });
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Rate limit exceeded", retry_after: retryAfter });
      return;
    }

    next();
  };
}

/** Clear all rate limit entries (for testing) */
export function clearLimits(): void {
  limits.clear();
}
