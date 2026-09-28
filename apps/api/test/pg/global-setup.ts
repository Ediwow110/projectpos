import { ensurePgTestDatabase } from "./helpers";

export default async function setup(): Promise<void> {
  await ensurePgTestDatabase();
}
