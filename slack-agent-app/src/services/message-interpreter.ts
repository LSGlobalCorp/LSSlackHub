import { query } from "../db/client";
import { logger } from "../utils/logger";

interface SlackMessage {
  text: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
}

export function shouldClassify(message: SlackMessage, botUserId?: string): boolean {
  if (message.bot_id) return false;
  if (message.subtype) return false;
  if (botUserId && message.user === botUserId) return false;
  if (!message.text || message.text.trim().length === 0) return false;
  return true;
}

// --- Pattern Parser ---

export interface ParsedLog {
  customerId: string;
  answered: boolean;
  transfer: boolean;
}

const YES_VALUES = new Set(["yes", "y", "true", "1"]);
const NO_VALUES = new Set(["no", "n", "false", "0"]);

function parseYesNo(value: string): boolean | null {
  const v = value.toLowerCase().trim();
  if (YES_VALUES.has(v)) return true;
  if (NO_VALUES.has(v)) return false;
  return null;
}

/**
 * Parse agent log messages. Accepts formats like:
 *   user 279 a yes t no
 *   user 279 a:yes t:no
 *   279 a yes t no
 *   279 a y t n
 */
export function parseLogMessage(text: string): ParsedLog | null {
  // Strip Slack mentions like <@U0AKYU7PYF7>
  const cleaned = text.replace(/<@[A-Z0-9]+>/g, "").trim();

  // Extract customer ID — with or without "user" prefix
  const idMatch = cleaned.match(/^(?:user\s+)?(\S+)\s+(.+)$/i);
  if (!idMatch) return null;

  const customerId = idMatch[1];
  const rest = idMatch[2].toLowerCase();

  // Try colon format: a:yes t:no
  const colonPattern = /\b(?:answered|answer|ans|a)\s*:\s*(\S+)\s+(?:transfer|trans|t)\s*:\s*(\S+)/i;
  const colonMatch = rest.match(colonPattern);
  if (colonMatch) {
    const answered = parseYesNo(colonMatch[1]);
    const transfer = parseYesNo(colonMatch[2]);
    if (answered !== null && transfer !== null) {
      return { customerId, answered, transfer };
    }
  }

  // Try space format: a yes t no
  const spacePattern = /\b(?:answered|answer|ans|a)\s+(\S+)\s+(?:transfer|trans|t)\s+(\S+)/i;
  const spaceMatch = rest.match(spacePattern);
  if (spaceMatch) {
    const answered = parseYesNo(spaceMatch[1]);
    const transfer = parseYesNo(spaceMatch[2]);
    if (answered !== null && transfer !== null) {
      return { customerId, answered, transfer };
    }
  }

  return null;
}

// --- Storage ---

interface StoreActivityParams {
  workspaceId: string;
  agentSlackId: string;
  actionType: string;
  channelSlackId: string;
  customerContext: string | null;
  notes: string | null;
  rawMessage: string;
  messageTs: string;
  confidence: number;
}

export async function storeActivity(params: StoreActivityParams): Promise<void> {
  await query(
    `INSERT INTO agent_activities
      (workspace_id, agent_slack_id, action_type, channel_slack_id, customer_context, notes, raw_message, message_ts, confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (workspace_id, channel_slack_id, message_ts) DO NOTHING`,
    [
      params.workspaceId, params.agentSlackId, params.actionType, params.channelSlackId,
      params.customerContext, params.notes, params.rawMessage, params.messageTs, params.confidence,
    ]
  );
  logger.info("Agent activity stored", {
    workspaceId: params.workspaceId, actionType: params.actionType, agent: params.agentSlackId,
  });
}

// --- Main Handler ---

export interface HandleMessageResult {
  stored: boolean;
  activity?: {
    actionType: string;
    customerContext: string | null;
    notes: string | null;
    confidence: number;
  };
}

export async function handleMessage(
  teamId: string,
  channelId: string,
  userId: string,
  messageText: string,
  messageTs: string,
  channelName: string,
  _channelTopic: string,
  workspaceId: string
): Promise<HandleMessageResult> {
  const parsed = parseLogMessage(messageText);

  if (!parsed) {
    return { stored: false };
  }

  // Determine action type from parsed result
  const actionType = parsed.answered ? "answer" : (parsed.transfer ? "transfer" : "other");
  const notes = `Answered: ${parsed.answered ? "Yes" : "No"} | Transfer: ${parsed.transfer ? "Yes" : "No"}`;

  await storeActivity({
    workspaceId,
    agentSlackId: userId,
    actionType,
    channelSlackId: channelId,
    customerContext: null,
    notes,
    rawMessage: messageText,
    messageTs,
    confidence: 1.0,
  });

  return {
    stored: true,
    activity: { actionType, customerContext: null, notes, confidence: 1.0 },
  };
}
