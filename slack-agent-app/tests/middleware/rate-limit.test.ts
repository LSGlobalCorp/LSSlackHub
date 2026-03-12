import { describe, it, expect, vi, beforeEach } from "vitest";
import { rateLimiter, clearLimits } from "../../src/middleware/rate-limit";

function makeRequest(teamId: string) {
  return { body: { team_id: teamId }, query: {} } as any;
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
  clearLimits();
});

describe("rateLimiter", () => {
  it("allows requests under the limit", () => {
    const middleware = rateLimiter(5);
    const req = makeRequest("T123");
    const res = makeResponse();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks requests over the limit", () => {
    const middleware = rateLimiter(3);
    const req = makeRequest("T123");

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      const res = makeResponse();
      const next = vi.fn();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    }

    // Next request should be blocked
    const res = makeResponse();
    const next = vi.fn();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("isolates rate limits per workspace", () => {
    const middleware = rateLimiter(2);

    // Exhaust limit for T1
    for (let i = 0; i < 2; i++) {
      middleware(makeRequest("T1"), makeResponse(), vi.fn());
    }

    // T2 should still be allowed
    const res = makeResponse();
    const next = vi.fn();
    middleware(makeRequest("T2"), res, next);
    expect(next).toHaveBeenCalled();
  });

  it("includes Retry-After header on 429", () => {
    const middleware = rateLimiter(1);
    const req = makeRequest("T123");

    middleware(req, makeResponse(), vi.fn()); // use up limit

    const res = makeResponse();
    middleware(req, res, vi.fn());
    expect(res.set).toHaveBeenCalledWith("Retry-After", expect.any(String));
  });
});
