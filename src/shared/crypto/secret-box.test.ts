import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  encryptionConfigured,
  isEncrypted,
} from "./secret-box";

/**
 * Secret box (6.5): application-level AES-256-GCM for third-party credentials at
 * rest. Pure crypto — no DB — so these are fast and deterministic. They lean on
 * BETTER_AUTH_SECRET being set (vitest loads .env.local), the same fallback the
 * app uses when ENCRYPTION_KEY is absent.
 */

describe("secret-box", () => {
  it("round-trips a secret through encrypt/decrypt", () => {
    const secret = "ghs_installationTokenLookAlike_1234567890";
    const token = encryptSecret(secret);
    expect(decryptSecret(token)).toBe(secret);
  });

  it("has key material configured in the test environment", () => {
    expect(encryptionConfigured()).toBe(true);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b); // no equality oracle across two stored rows
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("tags every token with the version prefix", () => {
    const token = encryptSecret("x");
    expect(token.startsWith("v1.")).toBe(true);
    expect(isEncrypted(token)).toBe(true);
    expect(isEncrypted("plaintext-legacy-value")).toBe(false);
  });

  it("round-trips an empty string and unicode", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
    expect(decryptSecret(encryptSecret("héllo 🔐 世界"))).toBe("héllo 🔐 世界");
  });

  it("throws when the ciphertext is tampered (auth tag fails)", () => {
    const token = encryptSecret("tamper-me");
    const parts = token.split(".");
    // Flip a byte in the ciphertext segment.
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 0xff;
    parts[3] = ct.toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("throws when the auth tag is tampered", () => {
    const token = encryptSecret("tamper-tag");
    const parts = token.split(".");
    const tag = Buffer.from(parts[2], "base64url");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("rejects a malformed or unversioned token", () => {
    expect(() => decryptSecret("not-a-token")).toThrow();
    expect(() => decryptSecret("v2.a.b.c")).toThrow();
    expect(() => decryptSecret("plaintext-that-was-never-encrypted")).toThrow();
  });
});
