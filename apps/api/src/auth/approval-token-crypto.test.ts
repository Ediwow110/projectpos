import { describe, expect, it } from "vitest";
import { assertProductionApprovalQueueKey, decryptApprovalToken, encryptApprovalToken } from "./approval-token-crypto";

const KEY = "a3".repeat(32);

describe("approval queue token encryption", () => {
  it("round-trips a manager grant without storing its raw bearer value", () => {
    const token = "mgr_sensitive-one-use-token";
    const encrypted = encryptApprovalToken(token, KEY);
    expect(encrypted).not.toContain(token);
    expect(decryptApprovalToken(encrypted, KEY)).toBe(token);
  });

  it("fails closed for missing keys and modified ciphertext", () => {
    expect(() => encryptApprovalToken("mgr_token", undefined)).toThrow("APPROVAL_QUEUE_ENCRYPTION_KEY_INVALID");
    const encrypted = encryptApprovalToken("mgr_token", KEY);
    const [iv, tag, ciphertext] = encrypted.split(".");
    const modifiedCiphertext = Buffer.from(ciphertext!, "base64url");
    modifiedCiphertext[0] ^= 0x01;
    const changed = `${iv}.${tag}.${modifiedCiphertext.toString("base64url")}`;
    expect(() => decryptApprovalToken(changed, KEY)).toThrow("APPROVAL_QUEUE_TOKEN_INVALID");
    expect(() => decryptApprovalToken(encrypted, "ff".repeat(32))).toThrow("APPROVAL_QUEUE_TOKEN_INVALID");
  });

  it("rejects missing and malformed encryption keys before production startup", () => {
    for (const key of [undefined, "", "abc", "0".repeat(63) + "x"]) {
      expect(() => assertProductionApprovalQueueKey({ NODE_ENV: "production", APPROVAL_QUEUE_ENCRYPTION_KEY: key })).toThrow(
        "APPROVAL_QUEUE_ENCRYPTION_KEY_INVALID",
      );
    }
    expect(() => assertProductionApprovalQueueKey({ NODE_ENV: "production", APPROVAL_QUEUE_ENCRYPTION_KEY: KEY })).not.toThrow();
    expect(() => assertProductionApprovalQueueKey({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertProductionApprovalQueueKey({ NODE_ENV: "test" })).not.toThrow();
  });
});
