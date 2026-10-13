import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const CIPHER = "aes-256-gcm";
const IV_BYTES = 12;

function encryptionKey(secret: string | undefined): Buffer {
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error("APPROVAL_QUEUE_ENCRYPTION_KEY_INVALID");
  }
  return Buffer.from(secret, "hex");
}

/** Fail at boot instead of discovering an unusable key when a manager approves a request. */
export function assertProductionApprovalQueueKey(env: NodeJS.ProcessEnv): void {
  if (env["NODE_ENV"] === "production") {
    encryptionKey(env["APPROVAL_QUEUE_ENCRYPTION_KEY"]);
  }
}

/** Encrypt short-lived manager grants while waiting for their original requester to claim them. */
export function encryptApprovalToken(token: string, secret: string | undefined): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptApprovalToken(envelope: string, secret: string | undefined): string {
  const [ivPart, tagPart, ciphertextPart, extra] = envelope.split(".");
  if (!ivPart || !tagPart || !ciphertextPart || extra !== undefined) {
    throw new Error("APPROVAL_QUEUE_TOKEN_INVALID");
  }
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error("APPROVAL_QUEUE_TOKEN_INVALID");
  }
  try {
    const decipher = createDecipheriv(CIPHER, encryptionKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("APPROVAL_QUEUE_TOKEN_INVALID");
  }
}
