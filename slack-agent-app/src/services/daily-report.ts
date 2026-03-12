import { query } from "../db/client";
import { logger } from "../utils/logger";
import { DailyReportData, DailyAgentStats } from "../types";
import { writeDailySummaryRow, writeAgentPerformanceRows } from "./google-sheets";

export async function aggregateDailyData(workspaceId: string, date: string): Promise<DailyReportData> {
  const summaryResult = await query(
    `SELECT action_type, COUNT(*)::int as count
     FROM agent_activities
     WHERE workspace_id = $1 AND created_at::date = $2::date
     GROUP BY action_type`,
    [workspaceId, date]
  );

  const counts: Record<string, number> = { answer: 0, transfer: 0, escalation: 0, hold: 0, other: 0 };
  for (const row of summaryResult.rows) {
    counts[row.action_type] = typeof row.count === "string" ? parseInt(row.count, 10) : row.count;
  }

  const agentResult = await query(
    `SELECT
       a.agent_slack_id,
       COALESCE(u.display_name, a.agent_slack_id) as display_name,
       COUNT(*)::int as total,
       COUNT(*) FILTER (WHERE a.action_type = 'answer')::int as answers,
       COUNT(*) FILTER (WHERE a.action_type = 'transfer')::int as transfers,
       COUNT(*) FILTER (WHERE a.action_type = 'escalation')::int as escalations,
       COUNT(*) FILTER (WHERE a.action_type = 'hold')::int as holds,
       COUNT(*) FILTER (WHERE a.action_type = 'other')::int as other,
       (SELECT c.name FROM channels c WHERE c.slack_channel_id = (
         SELECT aa.channel_slack_id FROM agent_activities aa
         WHERE aa.agent_slack_id = a.agent_slack_id
           AND aa.workspace_id = $1 AND aa.created_at::date = $2::date
         GROUP BY aa.channel_slack_id ORDER BY COUNT(*) DESC LIMIT 1
       ) AND c.workspace_id = $1 LIMIT 1) as top_channel
     FROM agent_activities a
     LEFT JOIN users u ON u.workspace_id = $1 AND u.slack_user_id = a.agent_slack_id
     WHERE a.workspace_id = $1 AND a.created_at::date = $2::date
     GROUP BY a.agent_slack_id, u.display_name
     ORDER BY total DESC`,
    [workspaceId, date]
  );

  const totalActions = Object.values(counts).reduce((sum, c) => sum + c, 0);

  const toNum = (val: any): number => typeof val === "string" ? parseInt(val, 10) : (val || 0);

  return {
    date,
    workspace_id: workspaceId,
    total_actions: totalActions,
    answers: counts.answer,
    transfers: counts.transfer,
    escalations: counts.escalation,
    holds: counts.hold,
    other: counts.other,
    agents: agentResult.rows.map((r) => ({
      agent_slack_id: r.agent_slack_id,
      display_name: r.display_name,
      total: toNum(r.total),
      answers: toNum(r.answers),
      transfers: toNum(r.transfers),
      escalations: toNum(r.escalations),
      holds: toNum(r.holds),
      other: toNum(r.other),
      top_channel: r.top_channel || "N/A",
    })),
  };
}

export function formatReportBlocks(data: DailyReportData): object[] {
  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Daily Activity Report — ${data.date}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Total Actions:* ${data.total_actions}`,
          `Answers: ${data.answers} | Transfers: ${data.transfers} | Escalations: ${data.escalations} | Holds: ${data.holds} | Other: ${data.other}`,
        ].join("\n"),
      },
    },
    { type: "divider" },
  ];

  if (data.agents.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No activity recorded today._" },
    });
    return blocks;
  }

  blocks.push({
    type: "actions",
    elements: [{
      type: "static_select",
      placeholder: { type: "plain_text", text: "Select an agent for details..." },
      action_id: "daily_report_agent_select",
      options: data.agents.map((a) => ({
        text: { type: "plain_text", text: `${a.display_name} (${a.total})` },
        value: a.agent_slack_id,
      })),
    }],
  });

  for (const agent of data.agents.slice(0, 5)) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${agent.display_name}* — ${agent.total} actions\n` +
          `Answers: ${agent.answers} | Transfers: ${agent.transfers} | Escalations: ${agent.escalations} | Top: ${agent.top_channel}`,
      },
    });
  }

  return blocks;
}

export function formatDailySummaryRow(data: DailyReportData): string[] {
  return [
    data.date, String(data.total_actions), String(data.answers),
    String(data.transfers), String(data.escalations), String(data.holds), String(data.other),
  ];
}

export function formatAgentPerformanceRows(date: string, agents: DailyAgentStats[]): string[][] {
  return agents.map((a) => [
    date, a.display_name, String(a.total), String(a.answers),
    String(a.transfers), String(a.escalations), String(a.holds), String(a.other), a.top_channel,
  ]);
}

export async function generateDailyReport(
  workspaceId: string,
  date?: string
): Promise<{ blocks: object[]; data: DailyReportData }> {
  const reportDate = date || new Date().toISOString().split("T")[0];
  const data = await aggregateDailyData(workspaceId, reportDate);
  const blocks = formatReportBlocks(data);

  try {
    await writeDailySummaryRow(workspaceId, formatDailySummaryRow(data));
    await writeAgentPerformanceRows(workspaceId, formatAgentPerformanceRows(reportDate, data.agents));
  } catch (err) {
    logger.error("Failed to write daily report to Sheets", {
      workspaceId, error: err instanceof Error ? err.message : "Unknown",
    });
  }

  return { blocks, data };
}
