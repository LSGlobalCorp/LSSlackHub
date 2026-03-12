import Anthropic from "@anthropic-ai/sdk";
import { WebClient } from "@slack/web-api";
import { query } from "../db/client";
import { getDecryptedToken } from "./workspace";
import { logger } from "../utils/logger";

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

export async function generateResponse(
  question: string,
  context?: string
): Promise<string> {
  const client = getAnthropicClient();

  const systemPrompt = `You are LS Agent Hub, an AI assistant integrated into Slack workspaces.
You provide helpful, concise, and professional answers to questions asked in Slack channels.
Keep responses clear and well-formatted for Slack (use *bold*, _italic_, and bullet points where appropriate).
If additional context is provided, use it to give more relevant answers.`;

  const userMessage = context
    ? `Context: ${context}\n\nQuestion: ${question}`
    : question;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock ? textBlock.text : "I was unable to generate a response.";
}

export async function postResponse(
  teamId: string,
  channelId: string,
  text: string,
  threadTs?: string
): Promise<string | undefined> {
  const token = await getDecryptedToken(teamId);
  if (!token) {
    throw new Error(`No token found for workspace ${teamId}`);
  }

  const client = new WebClient(token);
  const result = await client.chat.postMessage({
    channel: channelId,
    text,
    thread_ts: threadTs,
    unfurl_links: false,
  });

  return result.ts;
}

export async function logResponse(
  workspaceId: string,
  agentSlackId: string,
  channelSlackId: string,
  question: string,
  answer: string,
  threadTs: string | null,
  messageTs: string | null
): Promise<void> {
  await query(
    `INSERT INTO responses (workspace_id, agent_slack_id, channel_slack_id, question, answer, thread_ts, message_ts)
     VALUES ((SELECT id FROM workspaces WHERE slack_team_id = $1), $2, $3, $4, $5, $6, $7)`,
    [workspaceId, agentSlackId, channelSlackId, question, answer, threadTs, messageTs]
  );
  logger.info("Response logged", { workspaceId, channelSlackId });
}

export async function handleAgentRespond(
  teamId: string,
  channelId: string,
  question: string,
  userId: string,
  threadTs?: string
): Promise<void> {
  const answer = await generateResponse(question);
  const messageTs = await postResponse(teamId, channelId, answer, threadTs);
  await logResponse(teamId, userId, channelId, question, answer, threadTs || null, messageTs || null);
}
