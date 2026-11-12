// The sender (S-16): run the email jobs that are due, then drain the outbox.
//   hosted       the hub's Worker calls runEmailCycle on a schedule, with Resend
//   self-hosted  each app's Worker calls it on a schedule, with SMTP (or Resend)
// Server-only: it needs the service role client. Never import it from UI code.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppId } from "../supabase/hosted";
import { resendTransport } from "./resend";
import { decryptSecret, signUnsubscribe } from "./secret";
import { smtpTransport, type SmtpSecurity } from "./smtp";
import { hasTemplate, renderEmail } from "./templates";
import { EmailSendError, type EmailTransport, type OutboxRow } from "./types";

export type EmailEnv = Record<string, string | undefined>;

export type EmailConfig = {
  transport: EmailTransport;
  /** "Name <address>" */
  from: string;
  replyTo?: string | undefined;
  /** Where the transport's settings came from, for the settings page. */
  source: "resend" | "smtp-env" | "smtp-settings";
};

/** Addresses that never get email (the suite demo accounts, documentation domains). */
const NEVER_SEND = [
  /@(?:[a-z0-9-]+\.)*demo\.openapphub\.org$/i,
  /@example\.(?:org|com|net)$/i,
  /\.invalid$/i,
];

export function isBlockedAddress(address: string): boolean {
  return NEVER_SEND.some((re) => re.test(address));
}

const securityOf = (v: string | undefined): SmtpSecurity =>
  v === "tls" || v === "none" ? v : "starttls";

/**
 * Which transport to use, in order:
 *   1. RESEND_API_KEY (the hosted suite; self-hosters may use Resend too)
 *   2. SMTP_HOST and friends in the Worker's settings (SMTP_PASSWORD as a secret)
 *   3. The SMTP server the instance owner entered in the app (public.instance_email_settings)
 * Null when nothing is set up: email stays queued until it is.
 */
export async function emailConfigFromEnv(
  env: EmailEnv,
  admin: SupabaseClient | null,
): Promise<EmailConfig | null> {
  const from = env["EMAIL_FROM"] || "OpenAppHub <notifications@openapphub.org>";
  const replyTo = env["EMAIL_REPLY_TO"] || undefined;
  if (env["RESEND_API_KEY"]) {
    return {
      transport: resendTransport({ apiKey: env["RESEND_API_KEY"] }),
      from,
      replyTo,
      source: "resend",
    };
  }
  if (env["SMTP_HOST"]) {
    return {
      transport: smtpTransport({
        host: env["SMTP_HOST"],
        port: Number(env["SMTP_PORT"] || (env["SMTP_SECURITY"] === "tls" ? 465 : 587)),
        security: securityOf(env["SMTP_SECURITY"]),
        username: env["SMTP_USERNAME"] || null,
        password: env["SMTP_PASSWORD"] || null,
      }),
      from: env["EMAIL_FROM"] || from,
      replyTo,
      source: "smtp-env",
    };
  }
  if (!admin) return null;
  const { data } = await admin
    .from("instance_email_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  const s = data as {
    smtp_host: string | null;
    smtp_port: number | null;
    smtp_security: SmtpSecurity;
    smtp_username: string | null;
    smtp_password_enc: string | null;
    from_address: string | null;
    from_name: string | null;
    reply_to: string | null;
  } | null;
  if (!s?.smtp_host || !s.from_address) return null;
  const password = s.smtp_password_enc
    ? await decryptSecret(env["SUPABASE_SERVICE_ROLE_KEY"] ?? "", s.smtp_password_enc)
    : null;
  return {
    transport: smtpTransport({
      host: s.smtp_host,
      port: s.smtp_port ?? 587,
      security: s.smtp_security,
      username: s.smtp_username,
      password,
    }),
    from: s.from_name ? `${s.from_name} <${s.from_address}>` : s.from_address,
    replyTo: s.reply_to ?? replyTo,
    source: "smtp-settings",
  };
}

export type CycleOptions = {
  admin: SupabaseClient;
  config: EmailConfig;
  /** Each app's origin, for links in the emails. */
  urls: Partial<Record<AppId, string>>;
  /** The page where people change their email choices. */
  preferencesUrl: string;
  /** The origin serving /email/unsubscribe (the hub when hosted, the app when self-hosted). */
  unsubscribeBase: string;
  /** Signs unsubscribe links (the service role key). */
  secret: string;
  /** Hosted: the hub sends for every app. Self-hosted: an app sends only its own email. */
  apps?: string[];
  limit?: number;
  runJobs?: boolean;
};

export type CycleResult = {
  queuedByJobs: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
};

export async function runEmailCycle(opts: CycleOptions): Promise<CycleResult> {
  const result: CycleResult = { queuedByJobs: 0, sent: 0, retried: 0, failed: 0, suppressed: 0 };
  if (opts.runJobs !== false) {
    const { data, error } = await opts.admin.rpc("run_email_jobs");
    if (error) throw new Error(`Email jobs failed: ${error.message}`);
    result.queuedByJobs = Number(data ?? 0);
  }
  const { data: rows, error } = await opts.admin.rpc("claim_emails", {
    p_limit: opts.limit ?? 50,
    p_apps: opts.apps ?? null,
  });
  if (error) throw new Error(`Could not claim email: ${error.message}`);

  const finish = async (
    id: string,
    outcome: "sent" | "retry" | "failed" | "suppressed",
    providerId?: string | null,
    err?: string,
  ) => {
    await opts.admin.rpc("finish_email", {
      p_id: id,
      p_outcome: outcome,
      p_provider_id: providerId ?? null,
      p_error: err ?? null,
    });
  };

  for (const row of (rows ?? []) as OutboxRow[]) {
    if (!row.to_email || isBlockedAddress(row.to_email)) {
      await finish(
        row.id,
        "suppressed",
        null,
        row.to_email ? "Demo or test address." : "No address.",
      );
      result.suppressed++;
      continue;
    }
    if (!hasTemplate(row.template)) {
      await finish(row.id, "failed", null, `Unknown template "${row.template}".`);
      result.failed++;
      continue;
    }
    try {
      let unsubscribeUrl: string | null = null;
      if (row.category !== "essential" && row.to_user_id) {
        const sig = await signUnsubscribe(opts.secret, row.to_user_id, row.category);
        const q = new URLSearchParams({ u: row.to_user_id, c: row.category, s: sig });
        unsubscribeUrl = `${opts.unsubscribeBase.replace(/\/+$/, "")}/email/unsubscribe?${q}`;
      }
      const rendered = renderEmail(row, {
        urls: opts.urls,
        preferencesUrl: opts.preferencesUrl,
        unsubscribeUrl,
      });
      const headers: Record<string, string> = {};
      if (unsubscribeUrl) {
        headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
      }
      const to = row.to_name ? `${row.to_name} <${row.to_email}>` : row.to_email;
      const sent = await opts.config.transport.send({
        from: opts.config.from,
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo: opts.config.replyTo,
        headers,
        idempotencyKey: row.id,
      });
      await finish(row.id, "sent", sent.id);
      result.sent++;
    } catch (error) {
      const retry = error instanceof EmailSendError ? error.retry : true;
      await finish(row.id, retry ? "retry" : "failed", null, (error as Error).message);
      if (retry) result.retried++;
      else result.failed++;
    }
  }
  return result;
}
