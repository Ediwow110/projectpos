export interface Env {
  nodeEnv: string;
  databaseUrl: string;
  apiPort: number;
  webPort: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const databaseUrl = source["DATABASE_URL"];
  if (!databaseUrl) throw new Error("ENV_MISSING_DATABASE_URL");
  return {
    nodeEnv: source["NODE_ENV"] ?? "development",
    databaseUrl,
    apiPort: Number(source["API_PORT"] ?? 3001),
    webPort: Number(source["WEB_PORT"] ?? 3000),
  };
}
