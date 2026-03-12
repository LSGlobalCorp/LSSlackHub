import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock("../../src/services/workspace", () => ({
  getDecryptedToken: vi.fn().mockResolvedValue("xoxb-test-token"),
  getWorkspaceByTeamId: vi.fn().mockResolvedValue({ id: "uuid-1", slack_team_id: "T123" }),
}));

vi.mock("@slack/web-api", () => ({
  WebClient: function MockWebClient() {
    return {
      conversations: {
        list: vi.fn().mockResolvedValue({
          channels: [
            { id: "C1", name: "general", is_private: false, num_members: 50 },
            { id: "C2", name: "random", is_private: false, num_members: 30 },
          ],
          response_metadata: { next_cursor: "" },
        }),
        history: vi.fn().mockResolvedValue({
          messages: [
            { ts: "1111.1111", user: "U001", text: "Hello world" },
            { ts: "2222.2222", user: "U002", text: "Hi there", thread_ts: "1111.1111" },
          ],
        }),
      },
      users: {
        list: vi.fn().mockResolvedValue({
          members: [
            { id: "U001", real_name: "Alice", is_admin: false, is_bot: false, profile: { display_name: "alice", email: "alice@test.com" } },
            { id: "U002", real_name: "Bob", is_admin: true, is_bot: false, profile: { display_name: "bob", email: "bob@test.com" } },
            { id: "UBOT", is_bot: true },
          ],
          response_metadata: { next_cursor: "" },
        }),
      },
    };
  },
}));

import { query } from "../../src/db/client";
import { syncChannels, syncUsers, syncMessages, syncAll } from "../../src/services/data-sync";

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any);
});

describe("data-sync", () => {
  it("syncChannels fetches and upserts channels", async () => {
    const count = await syncChannels("T123");
    expect(count).toBe(2);
    // 2 channels = 2 INSERT calls
    const insertCalls = mockQuery.mock.calls.filter(
      (c) => (c[0] as string).includes("INSERT INTO channels")
    );
    expect(insertCalls).toHaveLength(2);
  });

  it("syncUsers fetches and upserts non-bot users", async () => {
    const count = await syncUsers("T123");
    expect(count).toBe(2); // Excludes bot
  });

  it("syncMessages fetches and inserts messages", async () => {
    const count = await syncMessages("T123", "C1");
    expect(count).toBe(2);
  });

  it("syncAll runs channels and users sync", async () => {
    const result = await syncAll("T123");
    expect(result.channels).toBe(2);
    expect(result.users).toBe(2);
  });
});
