import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { RequestHandler } from "express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser() as RequestHandler);
  const port = Number(process.env["API_PORT"] ?? 3001);
  await app.listen(port);
}

// eslint-disable-next-line no-console
bootstrap().catch((e) => console.error(e));
