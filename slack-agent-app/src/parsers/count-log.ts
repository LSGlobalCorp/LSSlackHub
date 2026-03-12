import { Parser, ParseContext, ParseResult } from "./types";
import { query } from "../db/client";
import { appendActivityRow } from "../services/google-sheets";
import { logger } from "../utils/logger";

// --- Pattern ---
// Format: <agentId> <customerId> a <count> t <count>
// Examples: 235 879 a 2 t 1 | 100 450 a 0 t 3

interface CountLogData {
  agentId: string;
  customerId: string;
  answered: number;
  transferred: number;
}

const QUICK_CHECK = /^\S+\s+\S+\s+(?:answered|answer|ans|a)\s*:?\s*\d+\s+(?:transferred|transfer|trans|t)\s*:?\s*\d+$/i;

function extract(text: string): CountLogData | null {
  const match = text.match(
    /^(\S+)\s+(\S+)\s+(?:answered|answer|ans|a)\s*:?\s*(\d+)\s+(?:transferred|transfer|trans|t)\s*:?\s*(\d+)$/i
  );
  if (!match) return null;

  return {
    agentId: match[1],
    customerId: match[2],
    answered: parseInt(match[3], 10),
    transferred: parseInt(match[4], 10),
  };
}

// --- Storage ---

async function storeInDb(ctx: ParseContext, data: CountLogData): Promise<void> {
  const actionType = data.answered > 0 ? "answer" : (data.transferred > 0 ? "transfer" : "other");

  await query(
    `INSERT INTO agent_activities
      (workspace_id, agent_slack_id, action_type, channel_slack_id, customer_context, notes, raw_message, message_ts, confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (workspace_id, channel_slack_id, message_ts) DO NOTHING`,
    [
      ctx.workspaceId, data.agentId, actionType, ctx.channelId,
      `Customer ${data.customerId}`,
      `Answered: ${data.answered} | Transferred: ${data.transferred}`,
      ctx.text, ctx.messageTs, 1.0,
    ]
  );
}

function storeInSheet(ctx: ParseContext, data: CountLogData): void {
  const now = new Date();
  appendActivityRow(ctx.workspaceId, {
    date: now.toISOString().split("T")[0],
    time: now.toTimeString().split(" ")[0],
    agentId: data.agentId,
    channelName: ctx.channelName,
    customerId: data.customerId,
    answered: data.answered,
    transferred: data.transferred,
  });
}

// --- Export ---

export const countLogParser: Parser = {
  name: "count-log",
  description: "Parses: <agentId> <customerId> a <count> t <count>",

  match(text: string): boolean {
    return QUICK_CHECK.test(text);
  },

  async execute(ctx: ParseContext): Promise<ParseResult> {
    const data = extract(ctx.text);
    if (!data) return { matched: false };

    await storeInDb(ctx, data);
    storeInSheet(ctx, data);

    logger.info("Count log parsed", {
      parser: "count-log", agentId: data.agentId, customerId: data.customerId,
      answered: data.answered, transferred: data.transferred,
    });

    return { matched: true, reaction: "white_check_mark" };
  },
};
