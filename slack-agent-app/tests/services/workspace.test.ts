import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import crypto from "crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
});

// Mock the db module
vi.mock("../../src/db/client", () => ({
  query: vi.fn(),
}));

import { query } from "../../src/db/client";
import {
  createWorkspace,
  getWorkspaceByTeamId,
  getDecryptedToken,
  deactivateWorkspace,
  listActiveWorkspaces,
} from "../../src/services/workspace";
import { encrypt } from "../../src/utils/crypto";

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("workspace service", () => {
  it("createWorkspace inserts and returns workspace", async () => {
    const workspace = {
      id: "uuid-1",
      slack_team_id: "T123",
      team_name: "Test Team",
      encrypted_bot_token: "encrypted",
      bot_user_id: "U999",
      installed_by: "U001",
      installed_at: new Date(),
      is_active: true,
      metadata: {},
    };
    mockQuery.mockResolvedValueOnce({ rows: [workspace], rowCount: 1 } as any);

    const result = await createWorkspace("T123", "Test Team", "xoxb-token", "U999", "U001");
    expect(result.slack_team_id).toBe("T123");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    // Verify the token param is encrypted (not the raw token)
    const callArgs = mockQuery.mock.calls[0][1] as string[];
    expect(callArgs[2]).not.toBe("xoxb-token");
    expect(callArgs[2]).toContain(":");
  });

  it("getWorkspaceByTeamId returns workspace or null", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const result = await getWorkspaceByTeamId("TNOTFOUND");
    expect(result).toBeNull();
  });

  it("getDecryptedToken decrypts the stored token", async () => {
    const token = "xoxb-real-token-123";
    const encryptedToken = encrypt(token);
    mockQuery.mockResolvedValueOnce({
      rows: [{ encrypted_bot_token: encryptedToken, is_active: true }],
      rowCount: 1,
    } as any);

    const result = await getDecryptedToken("T123");
    expect(result).toBe(token);
  });

  it("deactivateWorkspace sets is_active to false", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    await deactivateWorkspace("T123");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("is_active = false"),
      ["T123"]
    );
  });

  it("listActiveWorkspaces returns only active workspaces", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ slack_team_id: "T1" }, { slack_team_id: "T2" }],
      rowCount: 2,
    } as any);
    const result = await listActiveWorkspaces();
    expect(result).toHaveLength(2);
  });
});
