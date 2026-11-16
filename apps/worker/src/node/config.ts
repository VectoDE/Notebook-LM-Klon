import { resolve } from "node:path";
import { TURNSTILE_TEST_SECRET_ALWAYS_PASSES } from "../turnstile.js";
import { DEFAULT_CLEANUP_INTERVAL_MINUTES } from "./scheduler.js";
import { type SmtpSettings, readSmtpSettings } from "./smtp.js";

/**
 * Configuration of the Node runtime, read from environment variables.
 *
 * Mandatory secrets refuse the start with a clear message (no silent defaults).
 * Optional features that are missing keep failing closed at request time and are
 * reported once at startup as warnings (e.g. guest login without Turnstile: 503).
 */

export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Variables copied from the process environment into the app `env` (same names as on Cloudflare). */
export const PASSTHROUGH_VARS = [
  "APP_PROFILE",
  "APP_ORIGIN",
  "SESSION_SALT_SECRET",
  "TURNSTILE_SECRET_KEY",
  "TRUSTED_PROXY_HEADER",
  "BYOK_MASTER_KEY",
  "KEK_CURRENT_VERSION",
  ...Array.from({ length: 10 }, (_, i) => `KEK_V${i + 1}`),
  "RESEND_API_KEY",
  "MAIL_FROM",
  "DEMO_GEMINI_KEY",
  // C2PA signing of exports (Issue #353), see node/c2pa-signer.ts
  "C2PATOOL_PATH",
  "C2PA_SIGN_CERT",
  "C2PA_PRIVATE_KEY",
  "C2PA_CERT_KIND",
  "C2PA_TSA_URL"
] as const;

/** Minimum length for secrets that protect stored data (e.g. `openssl rand -hex 32` gives 64). */
export const MIN_SECRET_LENGTH = 32;

export const DEFAULT_PORT = 8787;

export interface NodeRuntimeConfig {
  readonly port: number;
  readonly dataDir: string;
  readonly staticDir: string;
  readonly appProfile: "demo" | "full";
  readonly appOrigin: string;
  readonly trustedProxyHeader: string | undefined;
  /** Interval of the in-process cleanup (cron replacement); 0 disables it for an external cron. */
  readonly cleanupIntervalMinutes: number;
  /** SMTP delivery, when SMTP_HOST is set. Takes precedence over Resend. */
  readonly smtp: SmtpSettings | undefined;
  /** Values for the app `env`, only the names from PASSTHROUGH_VARS, blank values dropped. */
  readonly vars: Readonly<Record<string, string>>;
}

export class NodeConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      [
        "Start abgebrochen: Die Konfiguration ist unvollständig oder ungültig.",
        ...problems.map((problem) => `  - ${problem}`),
        "Details: README, Abschnitt „Betrieb mit Node.js“."
      ].join("\n")
    );
    this.name = "NodeConfigError";
    this.problems = problems;
  }
}

function present(source: EnvSource, name: string): string | undefined {
  const value = source[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasKek(vars: Readonly<Record<string, string>>): boolean {
  return (
    vars.BYOK_MASTER_KEY !== undefined ||
    Array.from({ length: 10 }, (_, i) => vars[`KEK_V${i + 1}`]).some((v) => v !== undefined)
  );
}

function checkSecretLength(name: string, value: string | undefined, problems: string[]): void {
  if (value !== undefined && value.length < MIN_SECRET_LENGTH) {
    problems.push(
      `${name} ist zu kurz (${value.length} Zeichen, mindestens ${MIN_SECRET_LENGTH}). Erzeugen z. B. mit: openssl rand -hex 32`
    );
  }
}

/**
 * Reads and validates the configuration. Throws NodeConfigError listing every problem at
 * once, so an operator can fix the environment in one pass.
 */
export function loadNodeConfig(source: EnvSource = process.env): {
  config: NodeRuntimeConfig;
  warnings: string[];
} {
  const problems: string[] = [];
  const warnings: string[] = [];

  const vars: Record<string, string> = {};
  for (const name of PASSTHROUGH_VARS) {
    const value = present(source, name);
    if (value !== undefined) {
      vars[name] = value;
    }
  }

  const portRaw = present(source, "PORT");
  const port = portRaw === undefined ? DEFAULT_PORT : Number(portRaw);
  const portValid = Number.isInteger(port) && port >= 0 && port <= 65_535;
  if (!portValid) {
    problems.push(`PORT muss eine ganze Zahl zwischen 0 und 65535 sein (ist: "${portRaw}").`);
  }

  const profileRaw = vars.APP_PROFILE ?? "demo";
  if (profileRaw !== "demo" && profileRaw !== "full") {
    problems.push(`APP_PROFILE muss "demo" oder "full" sein (ist: "${profileRaw}").`);
  }
  const appProfile = profileRaw === "full" ? "full" : "demo";

  // Port 0 (random port) and invalid ports fall back to the default port for the origin.
  const appOrigin =
    vars.APP_ORIGIN ?? `http://localhost:${portValid && port > 0 ? port : DEFAULT_PORT}`;
  let originUrl: URL | undefined;
  try {
    originUrl = new URL(appOrigin);
  } catch {
    // reported below
  }
  if (!originUrl || !/^https?:$/.test(originUrl.protocol) || originUrl.origin !== appOrigin) {
    problems.push(
      `APP_ORIGIN muss ein Ursprung wie "https://notes.example.org" sein, ohne Pfad und ohne Schrägstrich am Ende (ist: "${appOrigin}").`
    );
  }
  vars.APP_ORIGIN = appOrigin;
  vars.APP_PROFILE = appProfile;

  if (vars.SESSION_SALT_SECRET === undefined) {
    problems.push(
      "SESSION_SALT_SECRET fehlt. Ohne dieses Secret ist keine Anmeldung möglich. Erzeugen z. B. mit: openssl rand -hex 32"
    );
  }
  checkSecretLength("SESSION_SALT_SECRET", vars.SESSION_SALT_SECRET, problems);

  if (!hasKek(vars)) {
    problems.push(
      "KEK_V1 (oder BYOK_MASTER_KEY) fehlt. Damit werden gespeicherte API-Schlüssel verschlüsselt. Erzeugen z. B. mit: openssl rand -hex 32"
    );
  }
  for (const name of [
    "BYOK_MASTER_KEY",
    ...Array.from({ length: 10 }, (_, i) => `KEK_V${i + 1}`)
  ]) {
    checkSecretLength(name, vars[name], problems);
  }

  const turnstile = vars.TURNSTILE_SECRET_KEY;
  if (turnstile === undefined) {
    warnings.push(
      "TURNSTILE_SECRET_KEY fehlt: Gastzugang und Magic-Link bleiben gesperrt (503 TURNSTILE_NOT_CONFIGURED), bis das Secret gesetzt ist."
    );
  } else if (
    turnstile === TURNSTILE_TEST_SECRET_ALWAYS_PASSES &&
    appOrigin.startsWith("https://")
  ) {
    warnings.push(
      "TURNSTILE_SECRET_KEY ist der offizielle Turnstile-Testschlüssel (besteht immer). Nur für Entwicklung und Tests verwenden."
    );
  }

  const smtp = readSmtpSettings(source);
  if (smtp) {
    if (!Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65_535) {
      problems.push(
        `SMTP_PORT muss eine ganze Zahl zwischen 1 und 65535 sein (ist: "${source.SMTP_PORT}").`
      );
    }
    if (smtp.from === "") {
      problems.push("MAIL_FROM fehlt: Für den Versand per SMTP ist eine Absenderadresse nötig.");
    }
    if (smtp.user !== undefined && smtp.pass === undefined) {
      problems.push("SMTP_PASS fehlt: SMTP_USER ist gesetzt, das Passwort nicht.");
    }
    if (vars.RESEND_API_KEY !== undefined) {
      warnings.push(
        "SMTP_HOST und RESEND_API_KEY sind gesetzt: Mails gehen per SMTP, Resend bleibt ungenutzt."
      );
    }
  } else if (vars.RESEND_API_KEY === undefined || vars.MAIL_FROM === undefined) {
    warnings.push(
      "Kein Mailversand konfiguriert (SMTP_HOST oder RESEND_API_KEY, jeweils mit MAIL_FROM): Magic-Link-Mails können nicht zugestellt werden."
    );
  }

  const intervalRaw = present(source, "CLEANUP_INTERVAL_MINUTES");
  const cleanupIntervalMinutes =
    intervalRaw === undefined ? DEFAULT_CLEANUP_INTERVAL_MINUTES : Number(intervalRaw);
  if (!Number.isInteger(cleanupIntervalMinutes) || cleanupIntervalMinutes < 0) {
    problems.push(
      `CLEANUP_INTERVAL_MINUTES muss eine ganze Zahl >= 0 sein, 0 schaltet den internen Zeitplan ab (ist: "${intervalRaw}").`
    );
  } else if (cleanupIntervalMinutes === 0) {
    warnings.push(
      'CLEANUP_INTERVAL_MINUTES=0: Der interne Aufräumlauf ist aus. Externen Cron mit "node apps/worker/dist/node-server.js cleanup" einrichten.'
    );
  }

  if (problems.length > 0) {
    throw new NodeConfigError(problems);
  }

  return {
    config: {
      port,
      dataDir: resolve(present(source, "DATA_DIR") ?? ".data"),
      staticDir: resolve(present(source, "STATIC_DIR") ?? "apps/web/dist"),
      appProfile,
      appOrigin,
      trustedProxyHeader: vars.TRUSTED_PROXY_HEADER,
      cleanupIntervalMinutes,
      smtp,
      vars
    },
    warnings
  };
}
