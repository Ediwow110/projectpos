import * as argon2 from "argon2";

export function checkPasswordPolicy(plain: string): void {
  if (plain.length < 12 || plain.length > 128) throw new Error("AUTH_WEAK_PASSWORD");
}

export async function hashPassword(plain: string): Promise<string> {
  checkPasswordPolicy(plain);
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
