import { describe, expect, it } from "vitest";

import {
  BrevoApiTransport,
  TransactionalEmailService,
  createTransactionalEmailFromEnv,
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
    expect(message.text).toContain("This link expires in 15 minutes.");
    expect(message.html).toContain(
      "https://pos.example.com/password-reset?token=reset+token%2F%2B%3F%26",
    );
    expect(message.html).toContain("This link expires in 15 minutes.");
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

  it("sends a customer receipt link without exposing internal sale data in the URL", async () => {
    const transport = new CaptureTransport();
    const service = new TransactionalEmailService(transport, {
      from: "NexPOS <noreply@example.com>",
      webUrl: "https://pos.example.com",
    });

    await service.sendReceiptShare({
      to: "customer@example.com",
      customerName: "Ana <Cruz>",
      receiptNo: "2026-000123",
      token: "receipt-token/+?&",
    });

    const message = transport.messages[0]!;
    expect(message.to).toBe("customer@example.com");
    expect(message.subject).toContain("2026-000123");
    expect(message.text).toContain("https://pos.example.com/receipts/shared/receipt-token%2F%2B%3F%26");
    expect(message.html).toContain("https://pos.example.com/receipts/shared/receipt-token%2F%2B%3F%26");
    expect(message.html).not.toContain("Ana <Cruz>");
  });

  it("sends Order status links in the URL fragment, not the query string", async () => {
    const transport = new CaptureTransport();
    const service = new TransactionalEmailService(transport, {
      from: "NexPOS <noreply@example.com>",
      webUrl: "https://pos.example.com",
    });

    await service.sendOrderUpdate({
      to: "ana@example.com",
      contactName: "Ana",
      orderId: "ord_1",
      event: "SUBMITTED",
      token: "secret-status-token",
    });

    const message = transport.messages[0]!;
    expect(message.text).toContain("https://pos.example.com/order-status#token=secret-status-token");
    expect(message.html).toContain("/order-status#token=secret-status-token");
    expect(message.text).not.toContain("?token=");
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

  it("keeps email disabled in development when only the shared WEB_URL is configured", () => {
    expect(loadEmailConfig({
      NODE_ENV: "development",
      WEB_URL: "http://localhost:3100",
    })).toEqual({ enabled: false });
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

  it("opts into Brevo API sandbox only with an explicit drop value", () => {
    expect(loadEmailConfig({
      NODE_ENV: "production",
      BREVO_API_KEY: "test-api-key",
      BREVO_SANDBOX_MODE: "drop",
      EMAIL_FROM: "NexPOS <noreply@example.com>",
      WEB_URL: "https://pos.example.com",
    })).toEqual({
      enabled: true,
      provider: "brevo-api",
      apiKey: "test-api-key",
      sandbox: "drop",
      from: "NexPOS <noreply@example.com>",
      webUrl: "https://pos.example.com",
    });
  });

  it("supports an order-only Brevo sandbox without suppressing account emails", async () => {
    const env = {
      NODE_ENV: "production",
      BREVO_API_KEY: "sandbox-api-key",
      ORDER_NOTIFICATION_BREVO_SANDBOX: "drop",
      EMAIL_FROM: "NexPOS <noreply@example.com>",
      WEB_URL: "https://pos.example.com",
    };
    expect(loadEmailConfig(env)).toEqual({
      enabled: true, provider: "brevo-api", apiKey: "sandbox-api-key",
      orderSandbox: "drop", from: "NexPOS <noreply@example.com>",
      webUrl: "https://pos.example.com",
    });
    const bodies: Array<Record<string, unknown>> = [];
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ messageId: "synthetic" }), { status: 201 });
    }) as typeof fetch;
    try {
      const service = createTransactionalEmailFromEnv(env);
      await service.sendEmailVerification({ to: "owner@example.test", name: "Owner", token: "qa-only" });
      await service.sendOrderUpdate({
        to: "customer@example.test", contactName: "QA", orderId: "qa-order",
        event: "CONFIRMED", token: "qa-status",
      });
      expect(bodies).toHaveLength(2);
      expect(bodies[0]).not.toHaveProperty("headers");
      expect(bodies[1]).toHaveProperty("headers", { "X-Sib-Sandbox": "drop" });
      expect(bodies[1]).toHaveProperty("to", [{ email: "customer@example.test" }]);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("fails closed on mistyped sandbox modes or non-Brevo transports", () => {
    const base = {
      NODE_ENV: "production",
      EMAIL_FROM: "NexPOS <noreply@example.com>",
      WEB_URL: "https://pos.example.com",
    };
    for (const invalid of ["DROP", "true", "off", "send", "dorp"]) {
      expect(() => loadEmailConfig({ ...base, BREVO_API_KEY: "key", BREVO_SANDBOX_MODE: invalid }))
        .toThrow("ENV_INVALID_EMAIL_CONFIG");
      expect(() => loadEmailConfig({ ...base, BREVO_API_KEY: "key", ORDER_NOTIFICATION_BREVO_SANDBOX: invalid }))
        .toThrow("ENV_INVALID_EMAIL_CONFIG");
    }
    expect(() => loadEmailConfig({ ...base, BREVO_SANDBOX_MODE: "drop" }))
      .toThrow("ENV_INVALID_EMAIL_CONFIG");
    expect(() => loadEmailConfig({
      ...base, BREVO_SANDBOX_MODE: "drop", SMTP_HOST: "smtp.example.com", SMTP_PORT: "587",
    })).toThrow("ENV_INVALID_EMAIL_CONFIG");
    expect(() => loadEmailConfig({
      ...base, BREVO_SANDBOX_MODE: "drop", BREVO_API_KEY: "key",
      SMTP_HOST: "smtp.example.com", SMTP_PORT: "587",
    })).toThrow("ENV_INVALID_EMAIL_CONFIG");
    expect(() => loadEmailConfig({
      ...base, ORDER_NOTIFICATION_BREVO_SANDBOX: "drop", BREVO_API_KEY: "key",
      SMTP_HOST: "smtp.example.com", SMTP_PORT: "587",
    })).toThrow("ENV_INVALID_EMAIL_CONFIG");
    expect(() => loadEmailConfig({
      ...base, ORDER_NOTIFICATION_BREVO_SANDBOX: "drop",
    })).toThrow("ENV_INVALID_EMAIL_CONFIG");
    expect(() => loadEmailConfig({ NODE_ENV: "development", BREVO_SANDBOX_MODE: "drop" }))
      .toThrow("ENV_INVALID_EMAIL_CONFIG");
  });

  it("adds Brevo's drop header to the JSON payload, never HTTP headers", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ messageId: "sandbox-msg" }), {
        status: 201, headers: { "content-type": "application/json" },
      });
    };
    const transport = new BrevoApiTransport("sandbox-api-key", fakeFetch, true);
    await transport.send({
      from: "NexPOS <noreply@example.com>",
      to: "qa@example.test",
      subject: "QA-only Order",
      text: "sandbox test",
      html: "<p>QA only</p>",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(calls[0]!.init.headers).not.toHaveProperty("X-Sib-Sandbox");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      sender: { name: "NexPOS", email: "noreply@example.com" },
      to: [{ email: "qa@example.test" }],
      headers: { "X-Sib-Sandbox": "drop" },
    });
    expect(String(calls[0]!.init.body)).not.toContain("sandbox-api-key");
  });

  it("passes the fail-closed sandbox setting through the runtime factory", async () => {
    const requests: RequestInit[] = [];
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({ messageId: "sandbox-msg" }), { status: 201 });
    }) as typeof fetch;
    try {
      const service = createTransactionalEmailFromEnv({
        NODE_ENV: "production",
        BREVO_API_KEY: "sandbox-api-key",
        BREVO_SANDBOX_MODE: "drop",
        EMAIL_FROM: "NexPOS <noreply@example.com>",
        WEB_URL: "https://pos.example.com",
      });
      await service.sendOrderUpdate({
        to: "qa@example.test", contactName: "QA", orderId: "test-order",
        event: "CONFIRMED", token: "synthetic-token",
      });
      expect(requests).toHaveLength(1);
      const payload = JSON.parse(String(requests[0]!.body));
      expect(payload.headers).toEqual({ "X-Sib-Sandbox": "drop" });
      expect(payload.textContent).toContain("/order-status#token=synthetic-token");
    } finally {
      globalThis.fetch = oldFetch;
    }
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
      textContent: "plain fallback",
      htmlContent: "<p>Verify</p>",
    });
    expect(JSON.parse(body)).not.toHaveProperty("headers");
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

  it("normalizes Brevo network errors and timeouts without leaking provider details", async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error("secret upstream DNS and key detail");
    };
    const transport = new BrevoApiTransport("secret-api-key", fakeFetch);
    await expect(transport.send({
      from: "NexPOS <noreply@example.com>",
      to: "owner@example.com",
      subject: "Verify",
      text: "Test",
      html: "<p>Test</p>",
    })).rejects.toThrow(/^EMAIL_DELIVERY_FAILED$/);
  });
});
