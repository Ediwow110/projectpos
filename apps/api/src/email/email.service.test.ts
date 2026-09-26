import { describe, expect, it } from "vitest";

import {
  TransactionalEmailService,
  loadEmailConfig,
  type MailMessage,
  type MailTransport,
} from "./email.service";

class CaptureTransport implements MailTransport {
  readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }
}

describe("transactional email", () => {
  it("builds an encoded password-reset link without exposing the token elsewhere", async () => {
    const transport = new CaptureTransport();
    const service = new TransactionalEmailService(transport, {
      from: "NexPOS <noreply@example.com>",
      webUrl: "https://pos.example.com",
    });

    await service.sendPasswordReset({
      to: "owner@example.com",
      name: "Owner <script>",
      token: "reset token/+?&",
    });

    expect(transport.messages).toHaveLength(1);
    const message = transport.messages[0]!;
    expect(message.to).toBe("owner@example.com");
    expect(message.subject).toMatch(/reset/i);
    expect(message.text).toContain(
      "https://pos.example.com/password-reset?token=reset+token%2F%2B%3F%26",
    );
    expect(message.html).toContain(
      "https://pos.example.com/password-reset?token=reset+token%2F%2B%3F%26",
    );
    expect(message.html).not.toContain("Owner <script>");
  });

  it("builds a verification link to the web verification route", async () => {
    const transport = new CaptureTransport();
    const service = new TransactionalEmailService(transport, {
      from: "NexPOS <noreply@example.com>",
      webUrl: "https://pos.example.com/base/",
    });

    await service.sendEmailVerification({
      to: "owner@example.com",
      name: "Owner",
      token: "verify-token",
    });

    expect(transport.messages[0]!.text).toContain(
      "https://pos.example.com/verify-email?token=verify-token",
    );
  });

  it("requires complete SMTP configuration in production", () => {
    expect(() => loadEmailConfig({ NODE_ENV: "production" })).toThrow("ENV_MISSING_EMAIL_CONFIG");
    expect(() =>
      loadEmailConfig({
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        EMAIL_FROM: "noreply@example.com",
        WEB_URL: "https://pos.example.com",
        SMTP_USER: "user-only",
      }),
    ).toThrow("ENV_INVALID_EMAIL_CONFIG");
    expect(() =>
      loadEmailConfig({
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        EMAIL_FROM: "noreply@example.com",
        WEB_URL: "http://pos.example.com",
      }),
    ).toThrow("ENV_INVALID_EMAIL_CONFIG");
  });

  it("accepts authenticated SMTP configuration and normalizes the web URL", () => {
    expect(
      loadEmailConfig({
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "smtp-user",
        SMTP_PASS: "smtp-pass",
        SMTP_SECURE: "false",
        EMAIL_FROM: "NexPOS <noreply@example.com>",
        WEB_URL: "https://pos.example.com/",
      }),
    ).toEqual({
      enabled: true,
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "smtp-user",
      pass: "smtp-pass",
      from: "NexPOS <noreply@example.com>",
      webUrl: "https://pos.example.com",
    });
  });
});
