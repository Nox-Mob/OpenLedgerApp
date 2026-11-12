// Email on a self-hosted app (S-16): the instance owner's SMTP settings, the test email,
// and the app's own scheduled sender. Hosted apps don't send; the hub does (and these
// functions refuse to run when the app is hosted).
// Server-only: uses the service role key. Each app wires these into its server functions
// (settings) and its Worker's scheduled handler (sending).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppId } from "../supabase/hosted";
import { emailConfigFromEnv, runEmailCycle, type CycleResult, type EmailEnv } from "./deliver";
import { encryptSecret } from "./secret";
import type { SmtpSecurity } from "./smtp";

export type EmailSettingsView = {
  /** Only the instance owner may change SMTP settings or send a test. */
  canEdit: boolean;
  /** Where the active settings come from. "env" settings can't be changed here. */
  source: "resend" | "smtp-env" | "smtp-settings" | "none";
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  hasPassword: boolean;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  /** False until SUPABASE_SERVICE_ROLE_KEY is set: nothing can be sent or saved. */
  serverReady: boolean;
};

export type EmailSettingsInput = {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  /** Blank keeps the saved password; null clears it. */
  password: string | null;
  fromAddress: string;
  fromName: string;
  replyTo: string;
};

export type SelfHostContext = {
  /** The signed-in user's client (the app's auth middleware). */
  userClient: SupabaseClient;
  /** process.env (Worker vars and secrets). */
  env: EmailEnv;
  /** The Supabase URL this server talks to. */
  supabaseUrl: string | undefined;
  hosted: boolean;
};

export function adminClient(supabaseUrl: string | undefined, env: EmailEnv): SupabaseClient | null {
  const key = env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !key) return null;
  return createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function requireOwner(ctx: SelfHostContext): Promise<SupabaseClient> {
  if (ctx.hosted) throw new Error("On OpenAppHub, email is sent by the hub.");
  const { data, error } = await ctx.userClient.schema("public").rpc("is_instance_owner");
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error(
      "Only the owner of this server's first organization can change email settings.",
    );
  const admin = adminClient(ctx.supabaseUrl, ctx.env);
  if (!admin) throw new Error("Add SUPABASE_SERVICE_ROLE_KEY to the server's secrets first.");
  return admin;
}

const HOST = /^[A-Za-z0-9.-]{1,253}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateEmailSettings(input: EmailSettingsInput): string | null {
  if (!HOST.test(input.host)) return "Enter the mail server's host name, e.g. smtp.example.org.";
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
    return "Enter a port between 1 and 65535.";
  if (input.port === 25)
    return "Port 25 is blocked for outgoing mail here. Use 587 (STARTTLS) or 465 (TLS).";
  if (!["starttls", "tls", "none"].includes(input.security)) return "Choose how to connect.";
  if (!EMAIL.test(input.fromAddress)) return "Enter the address emails come from.";
  if (input.replyTo && !EMAIL.test(input.replyTo))
    return "Enter a valid reply-to address, or leave it blank.";
  if (input.fromName.length > 120) return "The sender name is too long.";
  return null;
}

export async function getEmailSettings(ctx: SelfHostContext): Promise<EmailSettingsView> {
  const admin = adminClient(ctx.supabaseUrl, ctx.env);
  const { data: owner } = await ctx.userClient.schema("public").rpc("is_instance_owner");
  const view: EmailSettingsView = {
    canEdit: !ctx.hosted && Boolean(owner) && Boolean(admin),
    source: ctx.env["RESEND_API_KEY"] ? "resend" : ctx.env["SMTP_HOST"] ? "smtp-env" : "none",
    host: ctx.env["SMTP_HOST"] ?? "",
    port: Number(ctx.env["SMTP_PORT"] || 587),
    security: (ctx.env["SMTP_SECURITY"] as SmtpSecurity) || "starttls",
    username: ctx.env["SMTP_USERNAME"] ?? "",
    hasPassword: Boolean(ctx.env["SMTP_PASSWORD"]),
    fromAddress: (ctx.env["EMAIL_FROM"] ?? "").replace(/^.*<([^>]+)>.*$/, "$1"),
    fromName: (ctx.env["EMAIL_FROM"] ?? "").replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, ""),
    replyTo: ctx.env["EMAIL_REPLY_TO"] ?? "",
    serverReady: Boolean(admin),
  };
  if (view.source !== "none" || !owner || !admin) return view;
  const { data } = await admin
    .from("instance_email_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  const s = data as Record<string, unknown> | null;
  if (!s?.["smtp_host"]) return view;
  return {
    ...view,
    source: "smtp-settings",
    host: String(s["smtp_host"]),
    port: Number(s["smtp_port"] ?? 587),
    security: (s["smtp_security"] as SmtpSecurity) ?? "starttls",
    username: String(s["smtp_username"] ?? ""),
    hasPassword: Boolean(s["smtp_password_enc"]),
    fromAddress: String(s["from_address"] ?? ""),
    fromName: String(s["from_name"] ?? ""),
    replyTo: String(s["reply_to"] ?? ""),
  };
}

export async function saveEmailSettings(
  ctx: SelfHostContext,
  input: EmailSettingsInput,
): Promise<void> {
  const admin = await requireOwner(ctx);
  if (ctx.env["RESEND_API_KEY"] || ctx.env["SMTP_HOST"]) {
    throw new Error(
      "Email is set in this server's environment (RESEND_API_KEY or SMTP_HOST). Change it there.",
    );
  }
  const problem = validateEmailSettings(input);
  if (problem) throw new Error(problem);
  const { data: me } = await ctx.userClient.auth.getUser();
  const row: Record<string, unknown> = {
    id: true,
    smtp_host: input.host.trim(),
    smtp_port: input.port,
    smtp_security: input.security,
    smtp_username: input.username.trim() || null,
    from_address: input.fromAddress.trim().toLowerCase(),
    from_name: input.fromName.trim() || null,
    reply_to: input.replyTo.trim().toLowerCase() || null,
    updated_by: me.user?.id ?? null,
    updated_at: new Date().toISOString(),
  };
  if (input.password === null) row["smtp_password_enc"] = null;
  else if (input.password) {
    row["smtp_password_enc"] = await encryptSecret(
      ctx.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
      input.password,
    );
  }
  const { error } = await admin.from("instance_email_settings").upsert(row);
  if (error) throw new Error(error.message);
}

/** Queue a test email to the signed-in owner and send it right away. */
export async function sendTestEmail(
  ctx: SelfHostContext,
  opts: { app: AppId; appUrl: string; preferencesPath: string },
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireOwner(ctx);
  const config = await emailConfigFromEnv(ctx.env, admin);
  if (!config) return { ok: false, message: "Save the mail server's settings first." };
  const { data: me } = await ctx.userClient.auth.getUser();
  if (!me.user) throw new Error("Sign in again.");
  const { data: id, error } = await admin.rpc("enqueue_email", {
    p_app: opts.app,
    p_template: "test",
    p_to_user: me.user.id,
    p_dedupe_key: `test:${me.user.id}:${Date.now()}`,
  });
  if (error) throw new Error(error.message);
  await runSelfHostedEmail({ ...opts, env: ctx.env, supabaseUrl: ctx.supabaseUrl, runJobs: false });
  const { data: row } = await admin
    .from("email_outbox")
    .select("status,last_error,to_email")
    .eq("id", id)
    .maybeSingle();
  const r = row as { status: string; last_error: string | null } | null;
  if (r?.status === "sent")
    return { ok: true, message: `Sent to ${me.user.email}. Check your inbox.` };
  return { ok: false, message: r?.last_error || "The email wasn't sent." };
}

/** The app's scheduled sender (self-hosted only). */
export async function runSelfHostedEmail(opts: {
  env: EmailEnv;
  supabaseUrl: string | undefined;
  app: AppId;
  appUrl: string;
  /** The app's page with the email choices, e.g. "/settings/email". */
  preferencesPath: string;
  runJobs?: boolean;
}): Promise<CycleResult | null> {
  const admin = adminClient(opts.supabaseUrl, opts.env);
  if (!admin) return null;
  const config = await emailConfigFromEnv(opts.env, admin);
  if (!config) return null;
  const base = opts.appUrl.replace(/\/+$/, "");
  return runEmailCycle({
    admin,
    config,
    urls: { [opts.app]: base },
    preferencesUrl: `${base}${opts.preferencesPath}`,
    unsubscribeBase: base,
    secret: opts.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
    apps: [opts.app],
    ...(opts.runJobs === false ? { runJobs: false } : {}),
  });
}
