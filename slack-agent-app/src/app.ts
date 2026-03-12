import { App, SlackCommandMiddlewareArgs, SlackEventMiddlewareArgs } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { handleAgentRespond } from "./services/agent-responder";
import { getTally, formatTallyBlocks, generateCsvExport } from "./services/tally";
import { syncAll } from "./services/data-sync";
import { shouldClassify, handleMessage } from "./services/message-interpreter";
import { getWorkspaceByTeamId, getDecryptedToken } from "./services/workspace";
import { getAuthUrl, appendActivityRow, disconnectSheets } from "./services/google-sheets";
import { generateDailyReport, aggregateDailyData } from "./services/daily-report";
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

  // Message listener — classify agent activity
  app.message(async ({ message, context }) => {
    const msg = message as any;

    const botUserId = context.botUserId;
    if (!shouldClassify(msg, botUserId)) return;

    const teamId = (context as any).teamId || msg.team;
    if (!teamId) return;

    try {
      const workspace = await getWorkspaceByTeamId(teamId);
      if (!workspace) return;

      const channelResult = await query(
        "SELECT name FROM channels WHERE workspace_id = $1 AND slack_channel_id = $2",
        [workspace.id, msg.channel]
      );
      const channelName = channelResult.rows[0]?.name || msg.channel;

      const result = await handleMessage(
        teamId, msg.channel, msg.user, msg.text || "",
        msg.ts, channelName, channelName, workspace.id
      );

      if (result.stored && result.activity) {
        const userResult = await query(
          "SELECT display_name FROM users WHERE workspace_id = $1 AND slack_user_id = $2",
          [workspace.id, msg.user]
        );
        const agentName = userResult.rows[0]?.display_name || msg.user;
        const now = new Date();

        appendActivityRow(workspace.id, {
          date: now.toISOString().split("T")[0],
          time: now.toTimeString().split(" ")[0],
          agentName,
          actionType: result.activity.actionType,
          channelName,
          customerContext: result.activity.customerContext,
          notes: result.activity.notes,
          confidence: result.activity.confidence,
        });
      }
    } catch (err) {
      logger.error("Error in message classifier", {
        error: err instanceof Error ? err.message : "Unknown",
        channel: msg.channel,
      });
    }
  });

  // /connect-sheets command
  app.command("/connect-sheets", async ({ command, ack, respond }: SlackCommandMiddlewareArgs) => {
    await ack();
    const { team_id } = command;

    try {
      const url = getAuthUrl(team_id);
      await respond({
        response_type: "ephemeral",
        text: `Click here to connect Google Sheets: ${url}\n\nThis will create a new spreadsheet to track agent activity.`,
      });
    } catch (err) {
      logger.error("Error in /connect-sheets", { error: err instanceof Error ? err.message : "Unknown" });
      await respond({ response_type: "ephemeral", text: "Failed to generate connection link. Please try again." });
    }
  });

  // /disconnect-sheets command
  app.command("/disconnect-sheets", async ({ command, ack, respond }: SlackCommandMiddlewareArgs) => {
    await ack();
    const { team_id } = command;

    try {
      const workspace = await getWorkspaceByTeamId(team_id);
      if (!workspace) {
        await respond({ response_type: "ephemeral", text: "Workspace not found." });
        return;
      }
      await disconnectSheets(workspace.id);
      await respond({ response_type: "ephemeral", text: "Google Sheets disconnected. The sheet itself was not deleted." });
    } catch (err) {
      logger.error("Error in /disconnect-sheets", { error: err instanceof Error ? err.message : "Unknown" });
      await respond({ response_type: "ephemeral", text: "Failed to disconnect. Please try again." });
    }
  });

  // /daily-report command
  app.command("/daily-report", async ({ command, ack, respond }: SlackCommandMiddlewareArgs) => {
    await ack();
    const { team_id } = command;

    try {
      const workspace = await getWorkspaceByTeamId(team_id);
      if (!workspace) {
        await respond({ response_type: "ephemeral", text: "Workspace not found." });
        return;
      }

      await respond({ response_type: "ephemeral", text: "Generating daily report..." });

      const { blocks } = await generateDailyReport(workspace.id);

      const reportChannelId = process.env.REPORT_CHANNEL_ID || command.channel_id;
      const token = await getDecryptedToken(team_id);
      if (!token) throw new Error("Bot token not found");

      const slackClient = new WebClient(token);
      await slackClient.chat.postMessage({
        channel: reportChannelId,
        blocks: blocks as any,
        text: "Daily Activity Report",
      });

      await respond({ response_type: "ephemeral", text: "Daily report posted!" });
    } catch (err) {
      logger.error("Error in /daily-report", { error: err instanceof Error ? err.message : "Unknown" });
      await respond({ response_type: "ephemeral", text: "Failed to generate report. Please try again." });
    }
  });

  // Agent selector action handler (from daily report)
  app.action("daily_report_agent_select", async ({ action, ack, body, respond }) => {
    await ack();
    const selectedAgent = (action as any).selected_option?.value;
    if (!selectedAgent) return;

    try {
      const teamId = (body as any).team?.id;
      if (!teamId) return;

      const workspace = await getWorkspaceByTeamId(teamId);
      if (!workspace) return;

      const today = new Date().toISOString().split("T")[0];
      const data = await aggregateDailyData(workspace.id, today);
      const agent = data.agents.find((a) => a.agent_slack_id === selectedAgent);

      if (!agent) {
        await respond({ response_type: "ephemeral", text: "No activity found for this agent today." });
        return;
      }

      const channelResult = await query(
        `SELECT c.name as channel_name, a.action_type, COUNT(*)::int as count
         FROM agent_activities a
         LEFT JOIN channels c ON c.workspace_id = a.workspace_id AND c.slack_channel_id = a.channel_slack_id
         WHERE a.workspace_id = $1 AND a.agent_slack_id = $2 AND a.created_at::date = $3::date
         GROUP BY c.name, a.action_type ORDER BY count DESC`,
        [workspace.id, selectedAgent, today]
      );

      let channelBreakdown = channelResult.rows
        .map((r: any) => `  #${r.channel_name || "unknown"}: ${r.count} ${r.action_type}(s)`)
        .join("\n");
      if (!channelBreakdown) channelBreakdown = "  No channel data available";

      await respond({
        response_type: "ephemeral",
        text: [
          `*${agent.display_name}* — Detailed Stats (${today})`,
          `Total: ${agent.total} | Answers: ${agent.answers} | Transfers: ${agent.transfers} | Escalations: ${agent.escalations} | Holds: ${agent.holds}`,
          `Top Channel: ${agent.top_channel}`,
          `\n*Per-Channel Breakdown:*`,
          channelBreakdown,
        ].join("\n"),
      });
    } catch (err) {
      logger.error("Error in agent select action", { error: err instanceof Error ? err.message : "Unknown" });
    }
  });

  return app;
}
