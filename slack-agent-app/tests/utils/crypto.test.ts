import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { encrypt, decrypt } from "../../src/utils/crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
});

describe("crypto", () => {
  it("encrypts and decrypts a token round-trip", () => {
    const token = "xoxb-test-token-12345";
    const encrypted = encrypt(token);
    expect(encrypted).not.toBe(token);
    expect(encrypted).toContain(":");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(token);
  });

  it("produces different ciphertexts for same input (random IV)", () => {
    const token = "xoxb-test-token";
    const a = encrypt(token);
    const b = encrypt(token);
    expect(a).not.toBe(b);
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("xoxb-test");
    const parts = encrypted.split(":");
    parts[2] = parts[2].slice(0, -2) + "ff";
    const tampered = parts.join(":");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws on invalid format", () => {
    expect(() => decrypt("notvalidformat")).toThrow("Invalid encrypted text format");
  });
});
