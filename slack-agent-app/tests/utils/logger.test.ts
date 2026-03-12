import { describe, it, expect, vi } from "vitest";
import { logger } from "../../src/utils/logger";

describe("logger", () => {
  it("redacts bot tokens in log data", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test", { token: "xoxb-1234-secret-token" });

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.token).toBe("[REDACTED]");
    expect(logged.token).not.toContain("xoxb");
    spy.mockRestore();
  });

  it("redacts user tokens in log data", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test", { token: "xoxp-user-token-999" });

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.token).toBe("[REDACTED]");
    spy.mockRestore();
  });

  it("redacts anthropic keys in log data", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test", { key: "sk-ant-api03-secret" });

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.key).toBe("[REDACTED]");
    spy.mockRestore();
  });

  it("includes timestamp and level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("hello world");

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.level).toBe("info");
    expect(logged.message).toBe("hello world");
    expect(logged.timestamp).toBeDefined();
    spy.mockRestore();
  });

  it("uses console.error for error level", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("bad thing");

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.level).toBe("error");
    spy.mockRestore();
  });
});
