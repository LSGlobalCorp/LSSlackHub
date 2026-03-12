import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { generateState, clearStateStore } from "../../src/oauth/install";

// Mock db and workspace service
vi.mock("../../src/db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [{}], rowCount: 1 }),
}));

import { handleCallback } from "../../src/oauth/callback";

beforeEach(() => {
  clearStateStore();
  process.env.SLACK_CLIENT_ID = "test-client-id";
  process.env.SLACK_CLIENT_SECRET = "test-client-secret";
  process.env.APP_URL = "https://test.example.com";
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  vi.restoreAllMocks();
});

function makeResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  } as any;
}

describe("handleCallback", () => {
  it("rejects missing code or state", async () => {
    const req = { query: {} } as any;
    const res = makeResponse();
    await handleCallback(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects invalid state", async () => {
    const req = { query: { code: "abc", state: "invalid" } } as any;
    const res = makeResponse();
    await handleCallback(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send.mock.calls[0][0]).toContain("Invalid or expired state");
  });

  it("handles OAuth denial from user", async () => {
    const req = { query: { error: "access_denied" } } as any;
    const res = makeResponse();
    await handleCallback(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send.mock.calls[0][0]).toContain("cancelled");
  });

  it("exchanges code for token and creates workspace", async () => {
    const state = generateState();

    // Mock fetch for Slack API
    const mockFetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          ok: true,
          access_token: "xoxb-new-token",
          bot_user_id: "U123",
          team: { id: "T999", name: "Test Workspace" },
          authed_user: { id: "UADMIN" },
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = { query: { code: "valid-code", state } } as any;
    const res = makeResponse();

    await handleCallback(req, res);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/oauth.v2.access",
      expect.objectContaining({ method: "POST" })
    );
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain("Successfully Installed");
    expect(html).toContain("Test Workspace");

    vi.unstubAllGlobals();
  });

  it("handles Slack API error response", async () => {
    const state = generateState();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: false, error: "invalid_code" }),
      })
    );

    const req = { query: { code: "bad-code", state } } as any;
    const res = makeResponse();

    await handleCallback(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send.mock.calls[0][0]).toContain("invalid_code");

    vi.unstubAllGlobals();
  });
});
