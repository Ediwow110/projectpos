import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { RequestHandler } from "express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
}

// eslint-disable-next-line no-console
bootstrap().catch((e) => console.error(e));
