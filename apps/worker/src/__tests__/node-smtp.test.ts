import { describe, expect, it, vi } from "vitest";
import {
  type SmtpSettings,
  createSmtpBinding,
  defaultTransport,
  readSmtpSettings
} from "../node/smtp.js";

const SETTINGS: SmtpSettings = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  requireTls: true,
  user: "mailer",
  pass: "pw",
  from: "notes@example.test"
};

describe("readSmtpSettings", () => {
  it("is undefined without SMTP_HOST (SMTP disabled)", () => {
    expect(readSmtpSettings({})).toBeUndefined();
    expect(readSmtpSettings({ SMTP_HOST: "  " })).toBeUndefined();
  });

  it("defaults to port 587 with STARTTLS required and no credentials", () => {
    expect(readSmtpSettings({ SMTP_HOST: " mail.internal " })).toEqual({
      host: "mail.internal",
      port: 587,
      secure: false,
      requireTls: true,
      user: undefined,
      pass: undefined,
      from: ""
    });
  });

  it("uses implicit TLS on port 465 and honours explicit SMTP_SECURE / SMTP_REQUIRE_TLS", () => {
    expect(readSmtpSettings({ SMTP_HOST: "h", SMTP_PORT: "465" })?.secure).toBe(true);
    expect(readSmtpSettings({ SMTP_HOST: "h", SMTP_PORT: "465", SMTP_SECURE: "" })?.secure).toBe(
      true
    );
    expect(
      readSmtpSettings({ SMTP_HOST: "h", SMTP_PORT: "2525", SMTP_SECURE: "TRUE" })?.secure
    ).toBe(true);
    expect(
      readSmtpSettings({ SMTP_HOST: "h", SMTP_PORT: "465", SMTP_SECURE: "false" })?.secure
    ).toBe(false);
    expect(readSmtpSettings({ SMTP_HOST: "h", SMTP_REQUIRE_TLS: "False" })?.requireTls).toBe(false);
  });

  it("reads credentials and sender", () => {
    expect(
      readSmtpSettings({
        SMTP_HOST: "h",
        SMTP_USER: " mailer ",
        SMTP_PASS: " secret with spaces ",
        MAIL_FROM: " notes@example.test "
      })
    ).toMatchObject({ user: "mailer", pass: " secret with spaces ", from: "notes@example.test" });
  });
});

describe("createSmtpBinding", () => {
  it("sends every message with the configured sender", async () => {
    const sendMail = vi.fn(async () => ({}));
    const make = vi.fn(() => ({ sendMail }));
    const binding = createSmtpBinding(SETTINGS, make);
    await binding.send({ to: "a@example.test", subject: "Hallo", html: "<p>x</p>", text: "x" });
    expect(make).toHaveBeenCalledWith(SETTINGS);
    expect(sendMail).toHaveBeenCalledWith({
      from: "notes@example.test",
      to: "a@example.test",
      subject: "Hallo",
      html: "<p>x</p>",
      text: "x"
    });
  });

  it("propagates delivery errors so the mail adapter reports them", async () => {
    const binding = createSmtpBinding(SETTINGS, () => ({
      sendMail: async () => {
        throw new Error("550 rejected");
      }
    }));
    await expect(
      binding.send({ to: "a@example.test", subject: "s", html: "h", text: "t" })
    ).rejects.toThrow("550 rejected");
  });

  it("builds a nodemailer transport by default (no connection until the first mail)", () => {
    expect(createSmtpBinding(SETTINGS)).toEqual({ send: expect.any(Function) });
  });
});

describe("defaultTransport", () => {
  const optionsOf = (settings: SmtpSettings) =>
    (defaultTransport(settings) as unknown as { options: Record<string, unknown> }).options;

  it("requires STARTTLS and passes credentials", () => {
    expect(optionsOf(SETTINGS)).toMatchObject({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "mailer", pass: "pw" }
    });
  });

  it("needs no STARTTLS on implicit TLS and sends no auth without a user", () => {
    const options = optionsOf({ ...SETTINGS, port: 465, secure: true, user: undefined });
    expect(options).toMatchObject({ secure: true, requireTLS: false });
    expect(options.auth).toBeUndefined();
  });

  it("allows plain SMTP only when requireTls is switched off", () => {
    expect(optionsOf({ ...SETTINGS, requireTls: false, pass: undefined })).toMatchObject({
      requireTLS: false,
      auth: { user: "mailer", pass: "" }
    });
  });
});
