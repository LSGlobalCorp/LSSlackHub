import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateState, validateState, clearStateStore, handleInstall } from "../../src/oauth/install";

beforeEach(() => {
  clearStateStore();
  process.env.SLACK_CLIENT_ID = "test-client-id";
  process.env.APP_URL = "https://test.example.com";
});

describe("state management", () => {
  it("generates a valid UUID state", () => {
    const state = generateState();
    expect(state).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("validates a state that was just generated", () => {
    const state = generateState();
    expect(validateState(state)).toBe(true);
  });

  it("rejects an unknown state", () => {
    expect(validateState("unknown-state")).toBe(false);
  });

  it("invalidates state after first use (one-time use)", () => {
    const state = generateState();
    expect(validateState(state)).toBe(true);
    expect(validateState(state)).toBe(false);
  });
});

describe("handleInstall", () => {
  it("returns HTML with Add to Slack button", () => {
    const req = {} as any;
    const res = {
      set: vi.fn(),
      send: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    handleInstall(req, res);

    expect(res.set).toHaveBeenCalledWith("Content-Type", "text/html");
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain("Add to Slack");
    expect(html).toContain("slack.com/oauth/v2/authorize");
    expect(html).toContain("test-client-id");
  });

  it("returns 500 when env vars are missing", () => {
    delete process.env.SLACK_CLIENT_ID;
    const req = {} as any;
    const res = {
      set: vi.fn(),
      send: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    handleInstall(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
