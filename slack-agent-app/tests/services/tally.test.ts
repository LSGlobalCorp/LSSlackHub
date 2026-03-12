import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/client", () => ({
  query: vi.fn(),
}));

import { query } from "../../src/db/client";
import { getTally, formatTallyBlocks, generateCsvExport } from "../../src/services/tally";
import { TallyResult } from "../../src/types";

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tally service", () => {
  it("getTally queries responses for timeframe", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { agent_slack_id: "U001", display_name: "Alice", response_count: 10, positive_reactions: 5, negative_reactions: 1 },
        { agent_slack_id: "U002", display_name: "Bob", response_count: 7, positive_reactions: 3, negative_reactions: 0 },
      ],
      rowCount: 2,
    } as any);

    const result = await getTally("T123", "today");
    expect(result.total_responses).toBe(17);
    expect(result.entries).toHaveLength(2);
    expect(result.timeframe).toBe("today");
  });

  it("getTally supports agent filter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await getTally("T123", "week", "U001");
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("agent_slack_id = $4");
  });

  it("formatTallyBlocks returns Block Kit blocks", () => {
    const tally: TallyResult = {
      workspace_id: "T123",
      timeframe: "today",
      entries: [
        { agent_slack_id: "U001", display_name: "Alice", response_count: 10, positive_reactions: 8, negative_reactions: 2 },
      ],
      total_responses: 10,
    };

    const blocks = formatTallyBlocks(tally);
    expect(blocks.length).toBeGreaterThanOrEqual(3); // header + total + divider + entry
    expect(blocks[0]).toHaveProperty("type", "header");
  });

  it("formatTallyBlocks shows message for empty results", () => {
    const tally: TallyResult = {
      workspace_id: "T123",
      timeframe: "month",
      entries: [],
      total_responses: 0,
    };

    const blocks = formatTallyBlocks(tally);
    const text = JSON.stringify(blocks);
    expect(text).toContain("No responses found");
  });

  it("generateCsvExport returns valid CSV", () => {
    const tally: TallyResult = {
      workspace_id: "T123",
      timeframe: "today",
      entries: [
        { agent_slack_id: "U001", display_name: "Alice", response_count: 5, positive_reactions: 3, negative_reactions: 1 },
      ],
      total_responses: 5,
    };

    const csv = generateCsvExport(tally);
    expect(csv).toContain("Agent,Display Name,Responses");
    expect(csv).toContain("U001,Alice,5,3,1");
  });
});
