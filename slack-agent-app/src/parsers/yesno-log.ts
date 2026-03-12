import { Parser, ParseContext, ParseResult } from "./types";
import { query } from "../db/client";
import { appendActivityRow } from "../services/google-sheets";
import { logger } from "../utils/logger";

// --- Pattern ---
// Format: <agentId> a <yes/no> t <yes/no>
// Examples: 235 a yes t no | 235 a y t n | 235 a:yes t:no
// Stored as: answered=1/0, transferred=1/0

interface YesNoLogData {
  agentId: string;
  answered: number;   // 1 or 0
  transferred: number; // 1 or 0
}

const YES_VALUES = new Set(["yes", "y", "true", "1"]);
const NO_VALUES = new Set(["no", "n", "false", "0"]);

function parseYesNo(value: string): number | null {
  const v = value.toLowerCase().trim();
  if (YES_VALUES.has(v)) return 1;
  if (NO_VALUES.has(v)) return 0;
  return null;
}

const QUICK_CHECK = /^\S+\s+(?:answered|answer|ans|a)\s*[:  ]\s*\S+\s+(?:transferred|transfer|trans|t)\s*[:  ]\s*\S+$/i;

function extract(text: string): YesNoLogData | null {
  // Colon format: 235 a:yes t:no
  const colonMatch = text.match(
    /^(\S+)\s+(?:answered|answer|ans|a)\s*:\s*(\S+)\s+(?:transferred|transfer|trans|t)\s*:\s*(\S+)$/i
  );
  if (colonMatch) {
    const answered = parseYesNo(colonMatch[2]);
    const transferred = parseYesNo(colonMatch[3]);
    if (answered !== null && transferred !== null) {
      return { agentId: colonMatch[1], answered, transferred };
    }
  }

  // Space format: 235 a yes t no
  const spaceMatch = text.match(
    /^(\S+)\s+(?:answered|answer|ans|a)\s+(\S+)\s+(?:transferred|transfer|trans|t)\s+(\S+)$/i
  );
  if (spaceMatch) {
    const answered = parseYesNo(spaceMatch[2]);
    const transferred = parseYesNo(spaceMatch[3]);
    if (answered !== null && transferred !== null) {
      return { agentId: spaceMatch[1], answered, transferred };
    }
  }

  return null;
}

// --- Storage ---

async function storeInDb(ctx: ParseContext, data: YesNoLogData): Promise<void> {
  const actionType = data.answered ? "answer" : (data.transferred ? "transfer" : "other");

  await query(
    `INSERT INTO agent_activities
      (workspace_id, agent_slack_id, action_type, channel_slack_id, customer_context, notes, raw_message, message_ts, confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (workspace_id, channel_slack_id, message_ts) DO NOTHING`,
    [
      ctx.workspaceId, data.agentId, actionType, ctx.channelId,
      null,
      `Answered: ${data.answered} | Transferred: ${data.transferred}`,
      ctx.text, ctx.messageTs, 1.0,
    ]
  );
}

function storeInSheet(ctx: ParseContext, data: YesNoLogData): void {
  const now = new Date();
  appendActivityRow(ctx.workspaceId, {
    date: now.toISOString().split("T")[0],
    time: now.toTimeString().split(" ")[0],
    agentId: data.agentId,
    channelName: ctx.channelName,
    customerId: "",
    answered: data.answered,
    transferred: data.transferred,
  });
}

// --- Export ---

export const yesnoLogParser: Parser = {
  name: "yesno-log",
  description: "Parses: <agentId> a <yes/no> t <yes/no> — stored as 1/0",

  match(text: string): boolean {
    return QUICK_CHECK.test(text);
  },

  async execute(ctx: ParseContext): Promise<ParseResult> {
    const data = extract(ctx.text);
    if (!data) return { matched: false };

    await storeInDb(ctx, data);
    storeInSheet(ctx, data);

    logger.info("YesNo log parsed", {
      parser: "yesno-log", agentId: data.agentId,
      answered: data.answered, transferred: data.transferred,
    });

    return { matched: true, reaction: "white_check_mark" };
  },
};
