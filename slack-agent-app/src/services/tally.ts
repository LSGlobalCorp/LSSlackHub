import { query } from "../db/client";
import { TallyResult, TallyEntry } from "../types";
import { logger } from "../utils/logger";

type Timeframe = "today" | "week" | "month";

function getDateRange(timeframe: Timeframe): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);

  switch (timeframe) {
    case "today":
      start.setHours(0, 0, 0, 0);
      break;
    case "week":
      start.setDate(start.getDate() - 7);
      break;
    case "month":
      start.setMonth(start.getMonth() - 1);
      break;
  }

  return { start, end };
}

export async function getTally(
  teamId: string,
  timeframe: Timeframe = "today",
  agentFilter?: string
): Promise<TallyResult> {
  const { start, end } = getDateRange(timeframe);

  let sql = `
    SELECT
      r.agent_slack_id,
      COALESCE(u.display_name, r.agent_slack_id) as display_name,
      COUNT(*)::int as response_count,
      COALESCE(SUM(r.positive_reactions), 0)::int as positive_reactions,
      COALESCE(SUM(r.negative_reactions), 0)::int as negative_reactions
    FROM responses r
    JOIN workspaces w ON r.workspace_id = w.id
    LEFT JOIN users u ON u.workspace_id = w.id AND u.slack_user_id = r.agent_slack_id
    WHERE w.slack_team_id = $1
      AND r.created_at >= $2
      AND r.created_at <= $3
  `;

  const params: unknown[] = [teamId, start.toISOString(), end.toISOString()];

  if (agentFilter) {
    sql += ` AND r.agent_slack_id = $4`;
    params.push(agentFilter);
  }

  sql += ` GROUP BY r.agent_slack_id, u.display_name ORDER BY response_count DESC`;

  const result = await query(sql, params);
  const entries: TallyEntry[] = result.rows;
  const totalResponses = entries.reduce((sum, e) => sum + e.response_count, 0);

  logger.info("Tally generated", { teamId, timeframe, totalResponses });

  return {
    workspace_id: teamId,
    timeframe,
    entries,
    total_responses: totalResponses,
  };
}

export function formatTallyBlocks(tally: TallyResult): object[] {
  const blocks: object[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Agent Response Tally - ${tally.timeframe.charAt(0).toUpperCase() + tally.timeframe.slice(1)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Total Responses:* ${tally.total_responses}`,
      },
    },
    { type: "divider" },
  ];

  if (tally.entries.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No responses found for this timeframe._",
      },
    });
    return blocks;
  }

  for (const entry of tally.entries) {
    const quality =
      entry.positive_reactions + entry.negative_reactions > 0
        ? Math.round(
            (entry.positive_reactions /
              (entry.positive_reactions + entry.negative_reactions)) *
              100
          )
        : null;

    const qualityText = quality !== null ? ` | Quality: ${quality}%` : "";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${entry.display_name}*\nResponses: ${entry.response_count}${qualityText}\n+${entry.positive_reactions} / -${entry.negative_reactions} reactions`,
      },
    });
  }

  return blocks;
}

export function generateCsvExport(tally: TallyResult): string {
  const header = "Agent,Display Name,Responses,Positive Reactions,Negative Reactions\n";
  const rows = tally.entries
    .map(
      (e) =>
        `${e.agent_slack_id},${e.display_name},${e.response_count},${e.positive_reactions},${e.negative_reactions}`
    )
    .join("\n");
  return header + rows;
}
