import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { verifySlackSignature } from "../../src/middleware/auth";

const SIGNING_SECRET = "test_signing_secret_12345";

function makeRequest(body: string, timestamp?: string, signature?: string) {
  const ts = timestamp || String(Math.floor(Date.now() / 1000));
  const sigBasestring = `v0:${ts}:${body}`;
  const sig =
    signature ||
    "v0=" + crypto.createHmac("sha256", SIGNING_SECRET).update(sigBasestring).digest("hex");

  return {
    headers: {
      "x-slack-request-timestamp": ts,
      "x-slack-signature": sig,
    },
    rawBody: body,
  } as any;
}

function makeResponse() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  return res;
}

beforeEach(() => {
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
});

describe("verifySlackSignature", () => {
  it("calls next() for valid signature", () => {
    const req = makeRequest('{"text":"hello"}');
    const res = makeResponse();
    const next = vi.fn();

    verifySlackSignature(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid signature", () => {
    const req = makeRequest('{"text":"hello"}', undefined, "v0=badsignature");
    const res = makeResponse();
    const next = vi.fn();

    verifySlackSignature(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 for expired timestamp", () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 min ago
    const req = makeRequest('{"text":"hello"}', oldTimestamp);
    const res = makeResponse();
    const next = vi.fn();

    verifySlackSignature(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when headers are missing", () => {
    const req = { headers: {} } as any;
    const res = makeResponse();
    const next = vi.fn();

    verifySlackSignature(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
