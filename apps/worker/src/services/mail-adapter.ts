export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string | undefined;
  error?: string | undefined;
}

export interface MailAdapter {
  readonly providerName: string;
  send(opts: SendEmailOptions): Promise<SendEmailResult>;
}

export class ConsoleMailAdapter implements MailAdapter {
  readonly providerName = "console";
  public lastSentEmail?: SendEmailOptions;

  async send(opts: SendEmailOptions): Promise<SendEmailResult> {
    this.lastSentEmail = opts;
    return { success: true, messageId: `console_${Date.now()}` };
  }
}

export interface CloudflareSendEmailBinding {
  send: (message: { to: string; subject: string; html: string; text: string }) => Promise<void>;
}

export class CloudflareMailAdapter implements MailAdapter {
  readonly providerName = "cloudflare";

  constructor(private readonly sendEmailBinding?: CloudflareSendEmailBinding) {}

  async send(opts: SendEmailOptions): Promise<SendEmailResult> {
    if (!this.sendEmailBinding) {
      return { success: false, error: "Cloudflare Email binding missing or unconfigured." };
    }
    try {
      await this.sendEmailBinding.send(opts);
      return { success: true, messageId: `cf_${Date.now()}` };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}

export class HttpMailAdapter implements MailAdapter {
  readonly providerName: string;

  constructor(
    readonly provider: "resend" | "brevo",
    private readonly apiKey: string,
    private readonly fromEmail: string,
    private readonly customFetch: typeof fetch = fetch
  ) {
    this.providerName = provider;
  }

  async send(opts: SendEmailOptions): Promise<SendEmailResult> {
    const fetchFn = this.customFetch;

    if (this.provider === "resend") {
      try {
        const res = await fetchFn("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: this.fromEmail,
            to: [opts.to],
            subject: opts.subject,
            html: opts.html,
            text: opts.text
          })
        });

        if (!res.ok) {
          return { success: false, error: `Resend error: HTTP ${res.status}` };
        }
        const data = (await res.json()) as { id: string };
        return { success: true, messageId: data.id };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    // Brevo (Sendinblue)
    try {
      const res = await fetchFn("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sender: { email: this.fromEmail },
          to: [{ email: opts.to }],
          subject: opts.subject,
          htmlContent: opts.html,
          textContent: opts.text
        })
      });

      if (!res.ok) {
        return { success: false, error: `Brevo error: HTTP ${res.status}` };
      }
      const data = (await res.json()) as { messageId: string };
      return { success: true, messageId: data.messageId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
