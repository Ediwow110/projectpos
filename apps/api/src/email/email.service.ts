import nodemailer from "nodemailer";

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export interface TransactionalEmailPort {
  sendPasswordReset(input: { to: string; name: string; token: string }): Promise<void>;
  sendEmailVerification(input: { to: string; name: string; token: string }): Promise<void>;
}

export const TRANSACTIONAL_EMAIL_PORT = "TransactionalEmailPort";

export const NOOP_TRANSACTIONAL_EMAIL: TransactionalEmailPort = {
  async sendPasswordReset(): Promise<void> {},
  async sendEmailVerification(): Promise<void> {},
};

export type EmailRuntimeConfig =
  | { enabled: false }
  | {
      enabled: true;
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      pass?: string;
      from: string;
      webUrl: string;
    };

function normalizeWebUrl(raw: string, production = false): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("ENV_INVALID_EMAIL_CONFIG");
  }
  if (production && url.protocol !== "https:") {
    throw new Error("ENV_INVALID_EMAIL_CONFIG");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("ENV_INVALID_EMAIL_CONFIG");
  }
  return port;
}

export function loadEmailConfig(source: NodeJS.ProcessEnv = process.env): EmailRuntimeConfig {
  const production = (source["NODE_ENV"] ?? "development") === "production";
  const values = {
    host: source["SMTP_HOST"]?.trim() ?? "",
    port: source["SMTP_PORT"]?.trim() ?? "",
    user: source["SMTP_USER"]?.trim() ?? "",
    pass: source["SMTP_PASS"] ?? "",
    from: source["EMAIL_FROM"]?.trim() ?? "",
    webUrl: source["WEB_URL"]?.trim() ?? "",
  };
  const anyConfigured = Object.values(values).some(Boolean) || source["SMTP_SECURE"] !== undefined;
  if (!anyConfigured && !production) return { enabled: false };
  if (!values.host || !values.port || !values.from || !values.webUrl) {
    throw new Error("ENV_MISSING_EMAIL_CONFIG");
  }
  if (Boolean(values.user) !== Boolean(values.pass)) {
    throw new Error("ENV_INVALID_EMAIL_CONFIG");
  }
  const secureRaw = (source["SMTP_SECURE"] ?? "false").toLowerCase();
  if (!["true", "false", "1", "0"].includes(secureRaw)) {
    throw new Error("ENV_INVALID_EMAIL_CONFIG");
  }
  let webUrl: string;
  try {
    webUrl = normalizeWebUrl(values.webUrl, production);
  } catch {
    throw new Error("ENV_INVALID_EMAIL_CONFIG");
  }
  return {
    enabled: true,
    host: values.host,
    port: parsePort(values.port),
    secure: secureRaw === "true" || secureRaw === "1",
    ...(values.user ? { user: values.user, pass: values.pass } : {}),
    from: values.from,
    webUrl,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function actionUrl(webUrl: string, path: string, token: string): string {
  const url = new URL(path, `${webUrl}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

function htmlShell(input: { eyebrow: string; title: string; body: string; href: string; cta: string; note: string }): string {
  return `<!doctype html>
<html><body style="margin:0;background:#FCF8F3;font-family:Arial,sans-serif;color:#211814">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FCF8F3;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #eadfd6;border-radius:18px;padding:32px">
        <tr><td style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#F35D3F">${input.eyebrow}</td></tr>
        <tr><td style="padding-top:12px;font-size:28px;font-weight:700">${input.title}</td></tr>
        <tr><td style="padding-top:14px;font-size:15px;line-height:1.65;color:#554a44">${input.body}</td></tr>
        <tr><td style="padding-top:24px"><a href="${escapeHtml(input.href)}" style="display:inline-block;background:#F35D3F;color:#211814;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:10px">${input.cta}</a></td></tr>
        <tr><td style="padding-top:24px;font-size:12px;line-height:1.55;color:#7a6d66">${input.note}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export class TransactionalEmailService implements TransactionalEmailPort {
  constructor(
    private readonly transport: MailTransport,
    private readonly config: { from: string; webUrl: string },
  ) {}

  async sendPasswordReset(input: { to: string; name: string; token: string }): Promise<void> {
    const href = actionUrl(this.config.webUrl, "/password-reset", input.token);
    const safeName = escapeHtml(input.name || "there");
    await this.transport.send({
      from: this.config.from,
      to: input.to,
      subject: "Reset your NexPOS password",
      text: `Hi ${input.name || "there"},\n\nReset your NexPOS password using this link:\n${href}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`,
      html: htmlShell({
        eyebrow: "NexPOS security",
        title: "Reset your password",
        body: `Hi ${safeName}. We received a request to reset your NexPOS password.`,
        href,
        cta: "Reset password",
        note: "This link expires in 1 hour. If you did not request this reset, no action is needed.",
      }),
    });
  }

  async sendEmailVerification(input: { to: string; name: string; token: string }): Promise<void> {
    const href = actionUrl(this.config.webUrl, "/verify-email", input.token);
    const safeName = escapeHtml(input.name || "there");
    await this.transport.send({
      from: this.config.from,
      to: input.to,
      subject: "Verify your NexPOS email",
      text: `Hi ${input.name || "there"},\n\nVerify your email to activate NexPOS:\n${href}\n\nThis link expires in 24 hours.`,
      html: htmlShell({
        eyebrow: "NexPOS account",
        title: "Verify your email",
        body: `Hi ${safeName}. Confirm this email address to finish setting up your NexPOS account.`,
        href,
        cta: "Verify email",
        note: "This verification link expires in 24 hours. If you did not create this account, you can ignore this email.",
      }),
    });
  }
}

export function createTransactionalEmailFromEnv(source: NodeJS.ProcessEnv = process.env): TransactionalEmailPort {
  const config = loadEmailConfig(source);
  if (!config.enabled) return NOOP_TRANSACTIONAL_EMAIL;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user && config.pass ? { auth: { user: config.user, pass: config.pass } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  const transport: MailTransport = {
    async send(message): Promise<void> {
      await transporter.sendMail(message);
    },
  };
  return new TransactionalEmailService(transport, { from: config.from, webUrl: config.webUrl });
}
