import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { RequestHandler } from "express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  // rawBody preserves the exact request bytes so billing webhooks can verify a
  // provider's signature over what was actually sent instead of over
  // re-serialized JSON.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.use(cookieParser() as RequestHandler);
  // Explicit JSON body limit through Nest's own parser (a second manual
  // json() middleware would double-parse and break requests).
  // Documents the abuse-suite 413 expectation.
  app.useBodyParser("json", { limit: "100kb" });
  // The web app runs on a separate origin (port); the API must answer its
  // credentialed preflights. Single configurable origin on purpose.
  app.enableCors({
    origin: process.env["WEB_URL"] ?? "http://localhost:3000",
    credentials: true,
  });
  const port = Number(process.env["API_PORT"] ?? 3001);
  await app.listen(port);
  // SIGTERM/SIGINT end the PostgreSQL pool via AppModule's shutdown hook, so
  // platform rollouts drain in-flight requests instead of dropping them.
  app.enableShutdownHooks();
}

// eslint-disable-next-line no-console
bootstrap().catch((e) => console.error(e));
