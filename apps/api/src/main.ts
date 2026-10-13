import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { RequestHandler } from "express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { assertProductionApprovalQueueKey } from "./auth/approval-token-crypto";
import {
  listPayMongoPaymentMethodCapabilitiesFromEnv,
  listPayMongoWebhookDiagnosticsFromEnv,
  payMongoModeFromEnv,
} from "./payments/paymongo";

async function bootstrap(): Promise<void> {
  assertProductionApprovalQueueKey(process.env);
  // rawBody preserves the exact request bytes so billing webhooks can verify a
  // provider's signature over what was actually sent instead of over
  // re-serialized JSON.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Render and the documented production topologies terminate TLS at one
  // reverse-proxy hop. Trust that hop so req.ip / req.protocol reflect the
  // real client values used by auth rate limits and audit rows.
  app.set("trust proxy", 1);
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
  console.info(`PayMongo mode: ${payMongoModeFromEnv(process.env)}`);
  if (process.env["PAYMONGO_WEBHOOK_DIAGNOSTICS"] === "1") {
    try {
      const diagnostics = await listPayMongoWebhookDiagnosticsFromEnv(process.env);
      console.info(`PayMongo webhook diagnostics: ${JSON.stringify(diagnostics)}`);
    } catch {
      console.warn("PayMongo webhook diagnostics: unavailable");
    }
  }
  if (process.env["PAYMONGO_CAPABILITY_DIAGNOSTICS"] === "1") {
    try {
      const methods = await listPayMongoPaymentMethodCapabilitiesFromEnv(process.env);
      console.info(`PayMongo payment method capabilities: ${JSON.stringify(methods)}`);
    } catch {
      console.warn("PayMongo payment method capabilities: unavailable");
    }
  }
  // SIGTERM/SIGINT end the PostgreSQL pool via AppModule's shutdown hook, so
  // platform rollouts drain in-flight requests instead of dropping them.
  app.enableShutdownHooks();
}

bootstrap().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
