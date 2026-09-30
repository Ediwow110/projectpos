import * as argon2 from "argon2";

export function checkApprovalPinPolicy(pin: string): void {
  if (!/^\d{6}$/.test(pin)) throw new Error("VALIDATION");
}

export async function hashApprovalPin(pin: string): Promise<string> {
  checkApprovalPinPolicy(pin);
  return argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyApprovalPin(hash: string, pin: string): Promise<boolean> {
  if (!/^\d{6}$/.test(pin)) return false;
  try {
    return await argon2.verify(hash, pin);
  } catch {
    return false;
  }
}
