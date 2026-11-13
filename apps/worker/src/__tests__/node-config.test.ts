import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PORT,
  MIN_SECRET_LENGTH,
  NodeConfigError,
  PASSTHROUGH_VARS,
  loadNodeConfig
} from "../node/config.js";
import { TURNSTILE_TEST_SECRET_ALWAYS_PASSES } from "../turnstile.js";

const SALT = "s".repeat(64);
const KEK = "k".repeat(64);
const BASE = { SESSION_SALT_SECRET: SALT, KEK_V1: KEK } as const;

function problemsOf(source: Record<string, string | undefined>): readonly string[] {
  try {
    loadNodeConfig(source);
  } catch (err) {
    expect(err).toBeInstanceOf(NodeConfigError);
    return (err as NodeConfigError).problems;
  }
  throw new Error("expected NodeConfigError");
}

describe("loadNodeConfig", () => {
  it("refuses to start without mandatory secrets and names each missing one", () => {
    const problems = problemsOf({});
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/SESSION_SALT_SECRET fehlt/);
    expect(problems[1]).toMatch(/KEK_V1 \(oder BYOK_MASTER_KEY\) fehlt/);
    try {
      loadNodeConfig({});
    } catch (err) {
      expect((err as Error).message).toMatch(/^Start abgebrochen/);
      expect((err as Error).message).toMatch(/README/);
      expect((err as Error).name).toBe("NodeConfigError");
    }
  });

  it("treats blank values as missing", () => {
    expect(problemsOf({ SESSION_SALT_SECRET: "   ", KEK_V1: KEK })[0]).toMatch(/fehlt/);
  });

  it("rejects too short secrets", () => {
    const short = "x".repeat(MIN_SECRET_LENGTH - 1);
    expect(problemsOf({ SESSION_SALT_SECRET: short, KEK_V1: KEK })).toEqual([
      expect.stringMatching(/SESSION_SALT_SECRET ist zu kurz \(31 Zeichen/)
    ]);
    expect(problemsOf({ SESSION_SALT_SECRET: SALT, BYOK_MASTER_KEY: short })).toEqual([
      expect.stringMatching(/BYOK_MASTER_KEY ist zu kurz/)
    ]);
    expect(problemsOf({ SESSION_SALT_SECRET: SALT, KEK_V3: short })).toEqual([
      expect.stringMatching(/KEK_V3 ist zu kurz/)
    ]);
  });

  it("accepts BYOK_MASTER_KEY or any KEK_Vn as key encryption key", () => {
    expect(() => loadNodeConfig({ SESSION_SALT_SECRET: SALT, BYOK_MASTER_KEY: KEK })).not.toThrow();
    expect(() => loadNodeConfig({ SESSION_SALT_SECRET: SALT, KEK_V10: KEK })).not.toThrow();
  });

  it("validates PORT, APP_PROFILE and APP_ORIGIN", () => {
    expect(problemsOf({ ...BASE, PORT: "abc" })).toEqual([expect.stringMatching(/PORT/)]);
    expect(problemsOf({ ...BASE, PORT: "70000" })).toEqual([expect.stringMatching(/PORT/)]);
    expect(problemsOf({ ...BASE, APP_PROFILE: "prod" })).toEqual([
      expect.stringMatching(/APP_PROFILE muss "demo" oder "full"/)
    ]);
    expect(problemsOf({ ...BASE, APP_ORIGIN: "not a url" })).toEqual([
      expect.stringMatching(/APP_ORIGIN/)
    ]);
    expect(problemsOf({ ...BASE, APP_ORIGIN: "https://x.example/" })).toEqual([
      expect.stringMatching(/APP_ORIGIN/)
    ]);
    expect(problemsOf({ ...BASE, APP_ORIGIN: "ftp://x.example" })).toEqual([
      expect.stringMatching(/APP_ORIGIN/)
    ]);
  });

  it("returns defaults and passes through only known variables", () => {
    const { config } = loadNodeConfig({ ...BASE, UNRELATED: "x", DEMO_GEMINI_KEY: "  " });
    expect(config).toMatchObject({
      port: DEFAULT_PORT,
      appProfile: "demo",
      appOrigin: "http://localhost:8787",
      dataDir: resolve(".data"),
      staticDir: resolve("apps/web/dist"),
      trustedProxyHeader: undefined
    });
    expect(config.vars).toEqual({
      SESSION_SALT_SECRET: SALT,
      KEK_V1: KEK,
      APP_ORIGIN: "http://localhost:8787",
      APP_PROFILE: "demo"
    });
    expect(PASSTHROUGH_VARS).toContain("TURNSTILE_SECRET_KEY");
  });

  it("reads every setting from the environment", () => {
    const { config } = loadNodeConfig({
      ...BASE,
      PORT: "9000",
      APP_PROFILE: "full",
      APP_ORIGIN: "https://notes.example.org",
      DATA_DIR: "/srv/data",
      STATIC_DIR: "/srv/web",
      TRUSTED_PROXY_HEADER: "X-Forwarded-For",
      TURNSTILE_SECRET_KEY: "0x-real-secret",
      RESEND_API_KEY: "re_x",
      MAIL_FROM: "notes@example.org"
    });
    expect(config).toMatchObject({
      port: 9000,
      appProfile: "full",
      appOrigin: "https://notes.example.org",
      dataDir: resolve("/srv/data"),
      staticDir: resolve("/srv/web"),
      trustedProxyHeader: "X-Forwarded-For"
    });
    expect(config.vars.TURNSTILE_SECRET_KEY).toBe("0x-real-secret");
  });

  it("takes TURNSTILE_SECRET_KEY over and stays silent when it and mail are configured", () => {
    const { config, warnings } = loadNodeConfig({
      ...BASE,
      TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
      RESEND_API_KEY: "re_x",
      MAIL_FROM: "a@b.example"
    });
    expect(config.vars.TURNSTILE_SECRET_KEY).toBe(TURNSTILE_TEST_SECRET_ALWAYS_PASSES);
    expect(warnings).toEqual([]);
  });

  it("warns clearly (fail-closed, no start refusal) when TURNSTILE_SECRET_KEY is missing", () => {
    const { config, warnings } = loadNodeConfig(BASE);
    expect(config.vars.TURNSTILE_SECRET_KEY).toBeUndefined();
    expect(warnings[0]).toMatch(/TURNSTILE_SECRET_KEY fehlt/);
    expect(warnings[0]).toMatch(/503 TURNSTILE_NOT_CONFIGURED/);
    expect(warnings[1]).toMatch(/Kein Mailversand konfiguriert/);
  });

  it("warns when the always-passing Turnstile test key is used on an https origin", () => {
    const { warnings } = loadNodeConfig({
      ...BASE,
      APP_ORIGIN: "https://notes.example.org",
      TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
      RESEND_API_KEY: "re_x",
      MAIL_FROM: "a@b.example"
    });
    expect(warnings).toEqual([expect.stringMatching(/Testschlüssel/)]);
  });

  it("derives the default origin from PORT (random port 0 keeps the default port)", () => {
    expect(loadNodeConfig({ ...BASE, PORT: "9001" }).config.appOrigin).toBe(
      "http://localhost:9001"
    );
    expect(loadNodeConfig({ ...BASE, PORT: "0" }).config.appOrigin).toBe("http://localhost:8787");
  });

  it("defaults to the hourly cleanup like the Cloudflare cron and accepts 0 for an external cron", () => {
    expect(loadNodeConfig(BASE).config.cleanupIntervalMinutes).toBe(60);
    expect(
      loadNodeConfig({ ...BASE, CLEANUP_INTERVAL_MINUTES: "15" }).config.cleanupIntervalMinutes
    ).toBe(15);
    const off = loadNodeConfig({ ...BASE, CLEANUP_INTERVAL_MINUTES: "0" });
    expect(off.config.cleanupIntervalMinutes).toBe(0);
    expect(off.warnings).toContainEqual(expect.stringMatching(/node-server\.js cleanup/));
    expect(problemsOf({ ...BASE, CLEANUP_INTERVAL_MINUTES: "-1" })).toEqual([
      expect.stringMatching(/CLEANUP_INTERVAL_MINUTES muss eine ganze Zahl/)
    ]);
    expect(problemsOf({ ...BASE, CLEANUP_INTERVAL_MINUTES: "1.5" })).toHaveLength(1);
  });

  it("reads SMTP settings and prefers SMTP over Resend with a warning", () => {
    const { config, warnings } = loadNodeConfig({
      ...BASE,
      TURNSTILE_SECRET_KEY: "0x-real-secret",
      SMTP_HOST: "smtp.example.org",
      SMTP_USER: "mailer",
      SMTP_PASS: "pw",
      MAIL_FROM: "notes@example.org",
      RESEND_API_KEY: "re_x"
    });
    expect(config.smtp).toEqual({
      host: "smtp.example.org",
      port: 587,
      secure: false,
      requireTls: true,
      user: "mailer",
      pass: "pw",
      from: "notes@example.org"
    });
    expect(warnings).toEqual([expect.stringMatching(/Mails gehen per SMTP/)]);
  });

  it("is silent with SMTP alone and has no SMTP without SMTP_HOST", () => {
    const smtpOnly = loadNodeConfig({
      ...BASE,
      TURNSTILE_SECRET_KEY: "0x-real-secret",
      SMTP_HOST: "mail.internal",
      MAIL_FROM: "notes@example.org"
    });
    expect(smtpOnly.warnings).toEqual([]);
    expect(loadNodeConfig(BASE).config.smtp).toBeUndefined();
  });

  it("refuses incomplete SMTP settings", () => {
    const problems = problemsOf({
      ...BASE,
      SMTP_HOST: "smtp.example.org",
      SMTP_PORT: "70000",
      SMTP_USER: "mailer"
    });
    expect(problems).toEqual([
      expect.stringMatching(/SMTP_PORT muss/),
      expect.stringMatching(/MAIL_FROM fehlt/),
      expect.stringMatching(/SMTP_PASS fehlt/)
    ]);
    expect(
      problemsOf({ ...BASE, SMTP_HOST: "h", SMTP_PORT: "0", MAIL_FROM: "a@b.example" })
    ).toHaveLength(1);
    expect(
      problemsOf({ ...BASE, SMTP_HOST: "h", SMTP_PORT: "x", MAIL_FROM: "a@b.example" })
    ).toHaveLength(1);
  });

  it("reads process.env by default", () => {
    expect(() => loadNodeConfig()).toThrow(NodeConfigError);
  });
});
