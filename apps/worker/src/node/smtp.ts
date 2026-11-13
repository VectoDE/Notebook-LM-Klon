import { createTransport } from "nodemailer";
import type { CloudflareSendEmailBinding } from "../mail-adapter.js";
import type { EnvSource } from "./config.js";

/**
 * SMTP delivery for the Node runtime (nodemailer). It is handed to the app as the
 * `SEND_EMAIL` binding, so the worker code stays free of Node-only imports and the
 * existing mail selection in src/index.ts applies. createNodeEnv leaves RESEND_API_KEY out
 * when SMTP is configured, so SMTP is then the only mail path.
 */

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  /** STARTTLS is mandatory unless SMTP_REQUIRE_TLS=false (only for a local test server). */
  readonly requireTls: boolean;
  readonly user: string | undefined;
  readonly pass: string | undefined;
  readonly from: string;
}

interface Transport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<unknown>;
}

/** Reads SMTP_* settings. Returns undefined when SMTP_HOST is not set (SMTP disabled). */
export function readSmtpSettings(source: EnvSource): SmtpSettings | undefined {
  const host = source.SMTP_HOST?.trim();
  if (!host) {
    return undefined;
  }
  const port = Number(source.SMTP_PORT?.trim() || "587");
  const secureRaw = source.SMTP_SECURE?.trim().toLowerCase();
  return {
    host,
    port,
    // Port 465 is implicit TLS; other ports upgrade with STARTTLS (nodemailer default).
    secure: secureRaw === undefined || secureRaw === "" ? port === 465 : secureRaw === "true",
    requireTls: source.SMTP_REQUIRE_TLS?.trim().toLowerCase() !== "false",
    user: source.SMTP_USER?.trim() || undefined,
    pass: source.SMTP_PASS || undefined,
    from: source.MAIL_FROM?.trim() ?? ""
  };
}

export function createSmtpBinding(
  settings: SmtpSettings,
  makeTransport: (settings: SmtpSettings) => Transport = defaultTransport
): CloudflareSendEmailBinding {
  const transport = makeTransport(settings);
  return {
    send: async (message) => {
      await transport.sendMail({ from: settings.from, ...message });
    }
  };
}

export function defaultTransport(settings: SmtpSettings): Transport {
  return createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    // Refuse to send credentials or mail over an unencrypted connection.
    requireTLS: !settings.secure && settings.requireTls,
    ...(settings.user !== undefined
      ? { auth: { user: settings.user, pass: settings.pass ?? "" } }
      : {})
  });
}
