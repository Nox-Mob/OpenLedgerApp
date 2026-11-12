// Email on a self-hosted OpenLedgerApp (S-16). Hosted, the hub sends Ledger's email and this
// app sends nothing. Server-only.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailEnv } from "@shared/email/deliver";
import { adminClient, runSelfHostedEmail, type SelfHostContext } from "@shared/email/selfhost";
import { handleUnsubscribe } from "@shared/email/unsubscribe";
import { serverSupabaseEnv } from "@/integrations/supabase/server-env";

/** Ledger's page with the email choices and the mail server. */
export const EMAIL_SETTINGS_PATH = "/settings/email";

const hosted = () => import.meta.env["VITE_HOSTED"] === "true";

/** This server's public address, for links in emails. */
export function appOrigin(env: EmailEnv, request?: Request): string {
  return (
    env["APP_URL"] ||
    (request ? new URL(request.url).origin : "") ||
    "http://localhost:8080"
  ).replace(/\/+$/, "");
}

export function selfHostContext(userClient: SupabaseClient): SelfHostContext {
  return {
    userClient,
    env: process.env as EmailEnv,
    supabaseUrl: serverSupabaseEnv().url,
    hosted: hosted(),
  };
}

export async function ledgerUnsubscribe(request: Request): Promise<Response> {
  const env = process.env as EmailEnv;
  return handleUnsubscribe(request, {
    admin: adminClient(serverSupabaseEnv().url, env),
    secret: env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
    preferencesUrl: `${appOrigin(env, request)}${EMAIL_SETTINGS_PATH}`,
  });
}

/** The scheduled sender (server/email-cron.ts). Does nothing when hosted. */
export async function runLedgerEmail(env: EmailEnv) {
  if (hosted()) return null;
  return runSelfHostedEmail({
    env,
    supabaseUrl: env["SUPABASE_URL"] || serverSupabaseEnv().url,
    app: "ledger",
    appUrl: appOrigin(env),
    preferencesPath: EMAIL_SETTINGS_PATH,
  });
}
