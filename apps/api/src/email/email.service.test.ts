import { describe, expect, it } from "vitest";

import {
  BrevoApiTransport,
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
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "smtp-user",
      pass: "smtp-pass",
      from: "NexPOS <noreply@example.com>",
      webUrl: "https://pos.example.com",
    });
  });

  it("accepts Brevo HTTPS API configuration without SMTP", () => {
    expect(
      loadEmailConfig({
        NODE_ENV: "production",
        BREVO_API_KEY: "test-api-key",
        EMAIL_FROM: "NexPOS <noreply@example.com>",
        WEB_URL: "https://pos.example.com/",
      }),
    ).toEqual({
      enabled: true,
      provider: "brevo-api",
      apiKey: "test-api-key",
      from: "NexPOS <noreply@example.com>",
      webUrl: "https://pos.example.com",
    });
  });

  it("rejects ambiguous SMTP plus Brevo API configuration", () => {
    expect(() =>
      loadEmailConfig({
        NODE_ENV: "production",
        BREVO_API_KEY: "test-api-key",
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        EMAIL_FROM: "NexPOS <noreply@example.com>",
        WEB_URL: "https://pos.example.com",
      }),
    ).toThrow("ENV_INVALID_EMAIL_CONFIG");
  });

  it("sends through Brevo's HTTPS API without leaking the API key into payloads", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ messageId: "msg-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    };
    const transport = new BrevoApiTransport("secret-api-key", fakeFetch);

    await transport.send({
      from: "NexPOS <noreply@example.com>",
      to: "owner@example.com",
      subject: "Verify your NexPOS email",
      text: "plain fallback",
      html: "<p>Verify</p>",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.brevo.com/v3/smtp/email");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("secret-api-key");
    const body = String(calls[0]!.init.body);
    expect(body).not.toContain("secret-api-key");
    expect(JSON.parse(body)).toMatchObject({
      sender: { name: "NexPOS", email: "noreply@example.com" },
      to: [{ email: "owner@example.com" }],
      subject: "Verify your NexPOS email",
      htmlContent: "<p>Verify</p>",
    });
  });

  it("turns Brevo API failures into a generic delivery error", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "provider detail" }), { status: 401 });
    const transport = new BrevoApiTransport("bad-key", fakeFetch);

    await expect(
      transport.send({
        from: "NexPOS <noreply@example.com>",
        to: "owner@example.com",
        subject: "Reset",
        text: "text",
        html: "<p>text</p>",
      }),
    ).rejects.toThrow("EMAIL_DELIVERY_FAILED");
  });
});
