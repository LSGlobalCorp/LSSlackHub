import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock("../../src/utils/crypto", () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace("encrypted:", "")),
}));

const { mockAppend, mockBatchUpdate, mockSpreadsheetCreate } = vi.hoisted(() => ({
  mockAppend: vi.fn().mockResolvedValue({ data: {} }),
  mockBatchUpdate: vi.fn().mockResolvedValue({ data: {} }),
  mockSpreadsheetCreate: vi.fn().mockResolvedValue({
    data: { spreadsheetId: "sheet-123" },
  }),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(function () {
        this.setCredentials = vi.fn();
        this.generateAuthUrl = vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/auth?mock=true");
        this.getToken = vi.fn().mockResolvedValue({
          tokens: {
            access_token: "ya29.mock-access-token",
            refresh_token: "1//mock-refresh-token",
            expiry_date: Date.now() + 3600000,
          },
        });
        this.credentials = { access_token: "ya29.mock-access-token" };
        this.refreshAccessToken = vi.fn().mockResolvedValue({
          credentials: { access_token: "ya29.new-token", expiry_date: Date.now() + 3600000 },
        });
      }),
    },
    sheets: vi.fn().mockReturnValue({
      spreadsheets: {
        create: mockSpreadsheetCreate,
        values: { append: mockAppend },
        batchUpdate: mockBatchUpdate,
      },
    }),
  },
}));

import {
  getAuthUrl,
  appendActivityRow,
  formatActivityRow,
  disconnectSheets,
} from "../../src/services/google-sheets";
import { query } from "../../src/db/client";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "mock-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "mock-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/google/oauth/callback";
});

describe("getAuthUrl", () => {
  it("generates a Google OAuth URL", () => {
    const url = getAuthUrl("T123");
    expect(url).toContain("accounts.google.com");
  });
});

describe("formatActivityRow", () => {
  it("formats an agent activity into a spreadsheet row", () => {
    const row = formatActivityRow({
      date: "2026-03-12", time: "14:30:00", agentName: "Ryan P.",
      actionType: "answer", channelName: "#support",
      customerContext: "refund inquiry", notes: "resolved", confidence: 0.95,
    });
    expect(row).toEqual(["2026-03-12", "14:30:00", "Ryan P.", "answer", "#support", "refund inquiry", "resolved", "0.95"]);
  });

  it("handles null fields", () => {
    const row = formatActivityRow({
      date: "2026-03-12", time: "14:30:00", agentName: "Ryan P.",
      actionType: "transfer", channelName: "#billing",
      customerContext: null, notes: null, confidence: 0.82,
    });
    expect(row).toEqual(["2026-03-12", "14:30:00", "Ryan P.", "transfer", "#billing", "", "", "0.82"]);
  });
});

describe("appendActivityRow", () => {
  it("adds a row to the write buffer without throwing", () => {
    expect(() => appendActivityRow("ws-123", {
      date: "2026-03-12", time: "14:30:00", agentName: "Ryan P.",
      actionType: "answer", channelName: "#support",
      customerContext: "refund", notes: null, confidence: 0.9,
    })).not.toThrow();
  });
});

describe("disconnectSheets", () => {
  it("deletes google_auth record and clears buffer", async () => {
    await disconnectSheets("ws-123");
    expect(query).toHaveBeenCalledWith(
      "DELETE FROM google_auth WHERE workspace_id = $1",
      ["ws-123"]
    );
  });
});
