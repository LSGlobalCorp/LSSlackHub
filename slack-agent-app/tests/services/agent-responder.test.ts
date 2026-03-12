import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock("../../src/services/workspace", () => ({
  getDecryptedToken: vi.fn().mockResolvedValue("xoxb-test-token"),
}));

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: function MockAnthropic() {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "This is an AI response." }],
          }),
        },
      };
    },
  };
});

vi.mock("@slack/web-api", () => ({
  WebClient: function MockWebClient() {
    return {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "123.456" }),
      },
    };
  },
}));

import { generateResponse, postResponse, logResponse } from "../../src/services/agent-responder";
import { query } from "../../src/db/client";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
});

describe("agent-responder", () => {
  it("generateResponse returns AI-generated text", async () => {
    const answer = await generateResponse("What is TypeScript?");
    expect(answer).toBe("This is an AI response.");
  });

  it("postResponse posts message to Slack channel", async () => {
    const ts = await postResponse("T123", "C123", "Hello!", undefined);
    expect(ts).toBe("123.456");
  });

  it("postResponse supports thread replies", async () => {
    const ts = await postResponse("T123", "C123", "Thread reply", "111.222");
    expect(ts).toBe("123.456");
  });

  it("logResponse inserts into database", async () => {
    await logResponse("T123", "U001", "C123", "question", "answer", null, "123.456");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO responses"),
      expect.arrayContaining(["T123", "U001", "C123", "question", "answer"])
    );
  });
});
