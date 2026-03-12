import Anthropic from "@anthropic-ai/sdk";
import { query } from "../db/client";
import { logger } from "../utils/logger";
import { ClassificationResult } from "../types";

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

interface SlackMessage {
  text: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  thread_ts?: string;
}

const MINIMUM_WORD_COUNT = 5;

export function shouldClassify(message: SlackMessage, botUserId?: string): boolean {
  if (message.bot_id) return false;
  if (message.subtype) return false;
  if (botUserId && message.user === botUserId) return false;
  const wordCount = (message.text || "").trim().split(/\s+/).length;
  if (wordCount < MINIMUM_WORD_COUNT) return false;
  return true;
}

const CLASSIFICATION_SYSTEM_PROMPT = `You are a message classifier for a customer service team's Slack workspace.
Your job is to determine if a Slack message is an agent reporting an action they took (answered a customer, transferred a call, escalated a ticket, put someone on hold, etc.) versus general chatter.

Classify the message and respond with ONLY valid JSON (no markdown, no code fences):
{
  "isAgentActivity": boolean,
  "actionType": "answer" | "transfer" | "escalation" | "hold" | "other",
  "customerContext": "brief description of the customer/topic if applicable",
  "notes": "any additional relevant details",
  "confidence": 0.0 to 1.0
}

Action type definitions:
- "answer": Agent answered/resolved a customer question or issue
- "transfer": Agent transferred/handed off a customer to another team or agent
- "escalation": Agent escalated an issue to senior support or management
- "hold": Agent put a customer on hold
- "other": Agent performed some other tracked activity

If the message is NOT agent activity (general chatter, greetings, scheduling, etc.), return:
{ "isAgentActivity": false, "confidence": <your confidence it's NOT activity> }

Be strict: only classify as agent activity when the message clearly describes an action taken with/for a customer.`;

export async function classifyMessage(
  messageText: string,
  channelName: string,
  channelTopic: string
): Promise<ClassificationResult> {
  const client = getAnthropicClient();

  const userMessage = `Channel: #${channelName}
Channel topic: ${channelTopic}

Message: "${messageText}"`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 256,
    system: CLASSIFICATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    logger.warn("No text block in classification response");
    return { isAgentActivity: false, confidence: 0 };
  }

  try {
    const parsed = JSON.parse(textBlock.text) as ClassificationResult;
    return parsed;
  } catch (err) {
    logger.error("Failed to parse classification response", {
      response: textBlock.text,
      error: err instanceof Error ? err.message : "Unknown",
    });
    return { isAgentActivity: false, confidence: 0 };
  }
}

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

const CONFIDENCE_THRESHOLD = 0.7;

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
  channelTopic: string,
  workspaceId: string
): Promise<HandleMessageResult> {
  const classification = await classifyMessage(messageText, channelName, channelTopic);

  if (!classification.isAgentActivity || classification.confidence < CONFIDENCE_THRESHOLD) {
    return { stored: false };
  }

  const actionType = classification.actionType || "other";
  const customerContext = classification.customerContext || null;
  const notes = classification.notes || null;

  await storeActivity({
    workspaceId,
    agentSlackId: userId,
    actionType,
    channelSlackId: channelId,
    customerContext,
    notes,
    rawMessage: messageText,
    messageTs,
    confidence: classification.confidence,
  });

  return {
    stored: true,
    activity: { actionType, customerContext, notes, confidence: classification.confidence },
  };
}
