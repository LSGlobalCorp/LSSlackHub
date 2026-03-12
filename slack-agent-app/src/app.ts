import { App, SlackCommandMiddlewareArgs, SlackEventMiddlewareArgs } from "@slack/bolt";
import { handleAgentRespond } from "./services/agent-responder";
import { getTally, formatTallyBlocks, generateCsvExport } from "./services/tally";
import { syncAll } from "./services/data-sync";
import { query } from "./db/client";
import { logger } from "./utils/logger";

export function createApp(): App {
  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
  });

  // /agent-respond command
  app.command("/agent-respond", async ({ command, ack, respond }: SlackCommandMiddlewareArgs) => {
    await ack();

    const { team_id, channel_id, text, user_id, thread_ts } = command as any;

    if (!text.trim()) {
      await respond({
        response_type: "ephemeral",
        text: "Please provide a question or context. Usage: `/agent-respond [question]`",
      });
      return;
    }

    try {
      await respond({
        response_type: "ephemeral",
        text: "Generating response...",
      });

      await handleAgentRespond(team_id, channel_id, text, user_id, thread_ts);
    } catch (err) {
      logger.error("Error handling /agent-respond", {
        error: err instanceof Error ? err.message : "Unknown",
        teamId: team_id,
      });
      await respond({
        response_type: "ephemeral",
        text: "Sorry, an error occurred while generating the response. Please try again.",
      });
    }
  });

  // /tally command
  app.command("/tally", async ({ command, ack, respond }: SlackCommandMiddlewareArgs) => {
    await ack();

    const { team_id, text } = command;
    const args = text.trim().split(/\s+/);
    let timeframe: "today" | "week" | "month" = "today";
    let agentFilter: string | undefined;

    for (const arg of args) {
      if (["today", "week", "month"].includes(arg)) {
        timeframe = arg as "today" | "week" | "month";
      } else if (arg.startsWith("agent:")) {
        agentFilter = arg.replace("agent:", "").replace(/[<@>]/g, "");
      }
    }

    try {
      const tally = await getTally(team_id, timeframe, agentFilter);
      const blocks = formatTallyBlocks(tally);

      await respond({
        response_type: "ephemeral",
        blocks: blocks as any,
      });

      // If they want CSV, send it as a follow-up ephemeral
      if (text.includes("csv") || text.includes("export")) {
        const csv = generateCsvExport(tally);
        await respond({
          response_type: "ephemeral",
          text: `\`\`\`\n${csv}\n\`\`\``,
        });
      }
    } catch (err) {
      logger.error("Error handling /tally", {
        error: err instanceof Error ? err.message : "Unknown",
      });
      await respond({
        response_type: "ephemeral",
        text: "Sorry, an error occurred while generating the tally. Please try again.",
      });
    }
  });

  // /sync-data command
  app.command("/sync-data", async ({ command, ack, respond }: SlackCommandMiddlewareArgs) => {
    await ack();

    const { team_id } = command;

    try {
      await respond({
        response_type: "ephemeral",
        text: "Starting workspace data sync...",
      });

      const result = await syncAll(team_id);

      await respond({
        response_type: "ephemeral",
        text: `Sync complete! Synced ${result.channels} channels and ${result.users} users.`,
      });
    } catch (err) {
      logger.error("Error handling /sync-data", {
        error: err instanceof Error ? err.message : "Unknown",
      });
      await respond({
        response_type: "ephemeral",
        text: "Sorry, an error occurred during sync. Please try again.",
      });
    }
  });

  // app_mention event — respond when the bot is @mentioned
  app.event("app_mention", async ({ event, say }: SlackEventMiddlewareArgs<"app_mention">) => {
    const { team, channel, text, user, thread_ts, ts } = event as any;

    // Strip the bot mention from the text
    const question = text.replace(/<@[A-Z0-9]+>/g, "").trim();

    if (!question) {
      await say({
        text: "Hi! Mention me with a question and I'll generate a response. Example: `@LS Agent Hub What is our refund policy?`",
        thread_ts: thread_ts || ts,
      });
      return;
    }

    try {
      await handleAgentRespond(team, channel, question, user, thread_ts || ts);
    } catch (err) {
      logger.error("Error handling app_mention", {
        error: err instanceof Error ? err.message : "Unknown",
      });
      await say({
        text: "Sorry, I encountered an error. Please try again.",
        thread_ts: thread_ts || ts,
      });
    }
  });

  // reaction_added event — track quality metrics
  app.event("reaction_added", async ({ event }: SlackEventMiddlewareArgs<"reaction_added">) => {
    const { reaction, item } = event as any;

    if (item.type !== "message") return;

    const isPositive = ["+1", "thumbsup", "white_check_mark", "heart"].includes(reaction);
    const isNegative = ["-1", "thumbsdown", "x"].includes(reaction);

    if (!isPositive && !isNegative) return;

    const column = isPositive ? "positive_reactions" : "negative_reactions";

    try {
      await query(
        `UPDATE responses SET ${column} = ${column} + 1 WHERE message_ts = $1`,
        [item.ts]
      );
    } catch (err) {
      logger.debug("Reaction update skipped (message may not be a tracked response)", {
        ts: item.ts,
      });
    }
  });

  return app;
}
