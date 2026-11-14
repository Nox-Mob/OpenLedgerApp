// Account security on a self-hosted OpenLedgerApp (core 0019): codes to confirm it's you, the
// recovery email, and getting back in with a backup code or a recovery link. The steps are
// shared (shared/security/server.ts); this server's mail settings send the emails, and their
// links open this app. Hosted, OpenAppHub does all of this.
import { createServerFn } from "@tanstack/react-start";
import { desktopAware } from "@/lib/desktop/bridge";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { SecurityContext, SecurityResult } from "@shared/security/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const reauthAction = z.enum([
  "delete_organization",
  "transfer_ownership",
  "delete_account",
  "recovery_settings",
]);

async function context(supabase: unknown): Promise<SecurityContext> {
  const [{ adminClient }, { serverSupabaseEnv }] = await Promise.all([
    import("@shared/email/selfhost"),
    import("@/integrations/supabase/server-env"),
  ]);
  const env = process.env as Record<string, string | undefined>;
  const hosted = import.meta.env["VITE_HOSTED"] === "true";
  const auth = getRequest()?.headers.get("authorization") ?? "";
  return {
    userClient: supabase as SupabaseClient,
    // Hosted, this app keeps no service-role key (SHARED-SPEC §7.2): OpenAppHub recovers accounts.
    adminClient: hosted ? null : adminClient(serverSupabaseEnv().url, env),
    app: "ledger",
    accessToken: auth.startsWith("Bearer ") ? auth.slice(7) : null,
    // Codes and links can't wait for the scheduled sender. Never throws.
    sendNow: async () => {
      try {
        const { runLedgerEmail } = await import("@/lib/email.server");
        await runLedgerEmail(env);
      } catch {
        // The scheduled sender picks it up instead.
      }
    },
  };
}

const sendReauthCodeCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ action: reauthAction }).parse(input))
  .handler(async ({ data, context: c }): Promise<SecurityResult> => {
    const s = await import("@shared/security/server");
    return s.sendReauthCode(await context(c.supabase), data.action);
  });

const saveRecoveryEmailCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().trim().max(254).nullable(),
        token: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context: c }): Promise<SecurityResult> => {
    const s = await import("@shared/security/server");
    return s.saveRecoveryEmail(await context(c.supabase), data.email, data.token);
  });

const sendRecoveryLinkCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context: c }): Promise<SecurityResult> => {
    const s = await import("@shared/security/server");
    return s.sendRecoveryLink(await context(c.supabase));
  });

const recoverTwoStepCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .union([
        z.object({ code: z.string().trim().min(8).max(20) }),
        z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }),
      ])
      .parse(input),
  )
  .handler(async ({ data, context: c }): Promise<SecurityResult> => {
    const s = await import("@shared/security/server");
    return s.recoverTwoStep(await context(c.supabase), data);
  });

// The desktop edition has one person and no email: these are cloud-only (desktopAware).
export const sendReauthCode = desktopAware("sendReauthCode", sendReauthCodeCloud);
export const saveRecoveryEmail = desktopAware("saveRecoveryEmail", saveRecoveryEmailCloud);
export const sendRecoveryLink = desktopAware("sendRecoveryLink", sendRecoveryLinkCloud);
export const recoverTwoStep = desktopAware("recoverTwoStep", recoverTwoStepCloud);

/** For the shared screens: each returns an error message, or null when it worked. */
export async function appSendCode(action: z.infer<typeof reauthAction>): Promise<string | null> {
  const res = await sendReauthCode({ data: { action } });
  return "error" in res ? res.error : null;
}

export async function appSaveRecoveryEmail(
  email: string | null,
  token: string,
): Promise<string | null> {
  const res = await saveRecoveryEmail({ data: { email, token } });
  return "error" in res ? res.error : null;
}
