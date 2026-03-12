import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/client", () => ({
  query: vi.fn(),
}));

vi.mock("../../src/services/google-sheets", () => ({
  writeDailySummaryRow: vi.fn().mockResolvedValue(undefined),
  writeAgentPerformanceRows: vi.fn().mockResolvedValue(undefined),
}));

import { aggregateDailyData, formatReportBlocks, formatDailySummaryRow, formatAgentPerformanceRows } from "../../src/services/daily-report";
import { query } from "../../src/db/client";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("aggregateDailyData", () => {
  it("aggregates activities into daily report data", async () => {
    (query as any)
      .mockResolvedValueOnce({
        rows: [
          { action_type: "answer", count: 10 },
          { action_type: "transfer", count: 5 },
          { action_type: "escalation", count: 2 },
          { action_type: "hold", count: 1 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { agent_slack_id: "U001", display_name: "Ryan P.", total: 8, answers: 5, transfers: 2, escalations: 1, holds: 0, other: 0, top_channel: "#support" },
          { agent_slack_id: "U002", display_name: "Sarah K.", total: 10, answers: 5, transfers: 3, escalations: 1, holds: 1, other: 0, top_channel: "#billing" },
        ],
      });

    const data = await aggregateDailyData("ws-uuid-123", "2026-03-12");
    expect(data.total_actions).toBe(18);
    expect(data.answers).toBe(10);
    expect(data.transfers).toBe(5);
    expect(data.agents).toHaveLength(2);
  });

  it("handles empty day", async () => {
    (query as any)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const data = await aggregateDailyData("ws-uuid-123", "2026-03-12");
    expect(data.total_actions).toBe(0);
    expect(data.agents).toHaveLength(0);
  });
});

describe("formatReportBlocks", () => {
  it("generates Slack blocks with agent selector", () => {
    const blocks = formatReportBlocks({
      date: "2026-03-12", workspace_id: "ws-123",
      total_actions: 18, answers: 10, transfers: 5, escalations: 2, holds: 1, other: 0,
      agents: [
        { agent_slack_id: "U001", display_name: "Ryan P.", total: 8, answers: 5, transfers: 2, escalations: 1, holds: 0, other: 0, top_channel: "#support" },
      ],
    });
    expect(blocks).toBeInstanceOf(Array);
    expect(blocks[0]).toHaveProperty("type", "header");
    const actionBlock = blocks.find((b: any) => b.type === "actions");
    expect(actionBlock).toBeDefined();
  });

  it("handles empty report", () => {
    const blocks = formatReportBlocks({
      date: "2026-03-12", workspace_id: "ws-123",
      total_actions: 0, answers: 0, transfers: 0, escalations: 0, holds: 0, other: 0,
      agents: [],
    });
    const noActivity = blocks.find((b: any) => b.type === "section" && JSON.stringify(b).includes("No activity"));
    expect(noActivity).toBeDefined();
  });
});

describe("formatDailySummaryRow", () => {
  it("formats row for Daily Summary sheet", () => {
    const row = formatDailySummaryRow({
      date: "2026-03-12", workspace_id: "ws-123",
      total_actions: 18, answers: 10, transfers: 5, escalations: 2, holds: 1, other: 0,
      agents: [],
    });
    expect(row).toEqual(["2026-03-12", "18", "10", "5", "2", "1", "0"]);
  });
});

describe("formatAgentPerformanceRows", () => {
  it("formats rows for Agent Performance sheet", () => {
    const rows = formatAgentPerformanceRows("2026-03-12", [
      { agent_slack_id: "U001", display_name: "Ryan P.", total: 8, answers: 5, transfers: 2, escalations: 1, holds: 0, other: 0, top_channel: "#support" },
    ]);
    expect(rows).toEqual([
      ["2026-03-12", "Ryan P.", "8", "5", "2", "1", "0", "0", "#support"],
    ]);
  });
});
