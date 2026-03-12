import { Parser, ParseContext, ParseResult } from "./types";
import { countLogParser } from "./count-log";
import { yesnoLogParser } from "./yesno-log";
import { logger } from "../utils/logger";

// --- Parser Registry ---
// First match wins. More specific parsers go first.
const parsers: Parser[] = [
  countLogParser,   // 235 879 a 2 t 1 (has customer ID + counts)
  yesnoLogParser,   // 235 a yes t no  (no customer ID, yes/no → 1/0)
];

/**
 * Strip Slack formatting before parsing.
 */
export function cleanMessage(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/<#[A-Z0-9]+\|?[^>]*>/g, "")
    .trim();
}

/**
 * Run a message through all registered parsers.
 * Returns on first match.
 */
export async function runParsers(ctx: ParseContext): Promise<ParseResult> {
  for (const parser of parsers) {
    if (!parser.match(ctx.text)) continue;

    try {
      const result = await parser.execute(ctx);
      if (result.matched) {
        logger.debug("Parser matched", { parser: parser.name, channel: ctx.channelId });
        return result;
      }
    } catch (err) {
      logger.error("Parser error", {
        parser: parser.name,
        error: err instanceof Error ? err.message : "Unknown",
      });
    }
  }

  return { matched: false };
}

/**
 * Pre-filter: skip bots, subtypes, empty messages.
 */
export function shouldProcess(message: { text?: string; bot_id?: string; subtype?: string; user?: string }, botUserId?: string): boolean {
  if (message.bot_id) return false;
  if (message.subtype) return false;
  if (botUserId && message.user === botUserId) return false;
  if (!message.text || message.text.trim().length === 0) return false;
  return true;
}

export type { Parser, ParseContext, ParseResult };
