import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock("../../src/services/workspace", () => ({
  getWorkspaceByTeamId: vi.fn().mockResolvedValue({
    id: "ws-uuid-123",
    slack_team_id: "T123",
    team_name: "Test Team",
    bot_user_id: "U_BOT",
    is_active: true,
  }),
}));

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: function MockAnthropic() {
      return {
        messages: { create: mockCreate },
      };
    },
  };
});

import { shouldClassify, classifyMessage, storeActivity, handleMessage } from "../../src/services/message-interpreter";
import { query } from "../../src/db/client";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
});

describe("shouldClassify (pre-filter)", () => {
  it("rejects bot messages", () => {
    expect(shouldClassify({ text: "Hello world from bot", bot_id: "B123", user: "U123" })).toBe(false);
  });

  it("rejects messages with subtype", () => {
    expect(shouldClassify({ text: "joined the channel", subtype: "channel_join", user: "U123" })).toBe(false);
  });

  it("rejects short messages under 5 words", () => {
    expect(shouldClassify({ text: "okay thanks", user: "U123" })).toBe(false);
  });

  it("rejects messages from the bot itself", () => {
    expect(shouldClassify({ text: "Here is a long enough message", user: "U_BOT" }, "U_BOT")).toBe(false);
  });

  it("accepts valid agent messages", () => {
    expect(shouldClassify({ text: "Just answered a customer about their refund status", user: "U123" })).toBe(true);
  });

  it("accepts thread replies", () => {
    expect(shouldClassify({
      text: "Transferred the client to the billing team for resolution",
      user: "U123",
      thread_ts: "111.222",
    })).toBe(true);
  });
});

describe("classifyMessage", () => {
  it("classifies an answer message", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({
        isAgentActivity: true, actionType: "answer",
        customerContext: "refund status inquiry", notes: "billing department", confidence: 0.95,
      })}],
    });
    const result = await classifyMessage("Just answered a customer about their refund status in billing", "#support", "Support channel");
    expect(result.isAgentActivity).toBe(true);
    expect(result.actionType).toBe("answer");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("classifies a transfer message", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({
        isAgentActivity: true, actionType: "transfer",
        customerContext: "VIP client", notes: "retention team", confidence: 0.92,
      })}],
    });
    const result = await classifyMessage("Transferred the VIP client to the retention team", "#general", "General");
    expect(result.isAgentActivity).toBe(true);
    expect(result.actionType).toBe("transfer");
  });

  it("classifies non-activity correctly", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ isAgentActivity: false, confidence: 0.1 })}],
    });
    const result = await classifyMessage("Hey team, lunch is here!", "#general", "General");
    expect(result.isAgentActivity).toBe(false);
  });

  it("handles malformed JSON response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "not valid json" }],
    });
    const result = await classifyMessage("Some message text here for testing", "#general", "General");
    expect(result.isAgentActivity).toBe(false);
    expect(result.confidence).toBe(0);
  });
});

describe("storeActivity", () => {
  it("inserts with ON CONFLICT DO NOTHING", async () => {
    await storeActivity({
      workspaceId: "ws-uuid-123", agentSlackId: "U001", actionType: "answer",
      channelSlackId: "C123", customerContext: "refund inquiry", notes: "resolved",
      rawMessage: "Answered about refunds", messageTs: "1234567890.123456", confidence: 0.95,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_activities"),
      expect.arrayContaining(["ws-uuid-123", "U001", "answer", "C123"])
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT"),
      expect.any(Array)
    );
  });
});

describe("handleMessage", () => {
  it("returns stored:true with activity data when classified", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({
        isAgentActivity: true, actionType: "answer",
        customerContext: "refund", notes: "done", confidence: 0.9,
      })}],
    });
    const result = await handleMessage("T123", "C123", "U001", "Answered a customer refund question here", "111.222", "#support", "Support", "ws-uuid-123");
    expect(result.stored).toBe(true);
    expect(result.activity?.actionType).toBe("answer");
    expect(result.activity?.confidence).toBe(0.9);
  });

  it("returns stored:false when confidence below threshold", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ isAgentActivity: true, actionType: "answer", confidence: 0.3 })}],
    });
    const result = await handleMessage("T123", "C123", "U001", "Maybe I answered something not sure about it", "111.222", "#support", "Support", "ws-uuid-123");
    expect(result.stored).toBe(false);
  });

  it("returns stored:false for non-activity", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ isAgentActivity: false, confidence: 0.1 })}],
    });
    const result = await handleMessage("T123", "C123", "U001", "Hey team lunch is ready in the kitchen", "111.222", "#general", "General", "ws-uuid-123");
    expect(result.stored).toBe(false);
  });
});
