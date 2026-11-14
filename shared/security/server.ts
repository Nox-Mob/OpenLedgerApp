// Account security on the server (core 0019), shared by OpenAppHub and the self-hosted apps.
// Server-only. Each step runs as the signed-in person (their client) so the database checks
// everything first; the service-role client is used only to remove an authenticator after the
// database accepted a backup code or recovery link, and to sign out the account's other
// sessions then (SHARED-SPEC §7.2). `sendNow` sends the email straight away (codes and links
// can't wait for the scheduled sender); it must never throw.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppId } from "../supabase/hosted";

export type SecurityResult = { ok: true } | { error: string };

export type SecurityContext = {
  /** The signed-in person's client. */
  userClient: SupabaseClient;
  /** The service-role client (null when the server has no key). */
  adminClient: SupabaseClient | null;
  /** Sends what's waiting in the outbox now. */
  sendNow: () => Promise<void>;
  /** The app asking: its sender sends the email, and the email's links open it. */
  app: AppId;
  /** The person's access token, to sign out their other sessions (else read from the client). */
  accessToken?: string | null;
};

export const REAUTH_ACTIONS = [
  "delete_organization",
  "transfer_ownership",
  "delete_account",
  "recovery_settings",
] as const;
export type ReauthActionName = (typeof REAUTH_ACTIONS)[number];

const friendly = (message: string | undefined) => message || "That didn't work. Try again.";
const core = (c: SupabaseClient) => c.schema("public");

export async function sendReauthCode(
  ctx: SecurityContext,
  action: ReauthActionName,
): Promise<SecurityResult> {
  const { error } = await core(ctx.userClient).rpc("send_reauth_code", {
    p_action: action,
    p_app: ctx.app,
  });
  if (error) return { error: friendly(error.message) };
  await ctx.sendNow();
  return { ok: true };
}

export async function saveRecoveryEmail(
  ctx: SecurityContext,
  email: string | null,
  token: string,
): Promise<SecurityResult> {
  const { error } = await core(ctx.userClient).rpc("set_recovery_email", {
    p_email: email || null,
    p_reauth: token,
    p_app: ctx.app,
  });
  if (error) return { error: friendly(error.message) };
  await ctx.sendNow();
  return { ok: true };
}

export async function sendRecoveryLink(ctx: SecurityContext): Promise<SecurityResult> {
  const { error } = await core(ctx.userClient).rpc("send_recovery_link", { p_app: ctx.app });
  if (error) return { error: friendly(error.message) };
  await ctx.sendNow();
  return { ok: true };
}

/**
 * Turn off two-step sign-in with a backup code or a recovery link. The database checks the code
 * or link first (as the signed-in person); only then does the service role remove the
 * authenticator. The database then records it and emails the person, and every other session
 * on the account is signed out.
 */
export async function recoverTwoStep(
  ctx: SecurityContext,
  input: { code: string } | { token: string },
): Promise<SecurityResult> {
  if (!ctx.adminClient)
    return {
      error:
        "Recovery isn't set up on this server: it needs the SUPABASE_SERVICE_ROLE_KEY secret. Ask whoever runs it.",
    };
  const { data: auth } = await ctx.userClient.auth.getUser(ctx.accessToken ?? undefined);
  const user = auth.user;
  if (!user) return { error: "Sign in with your password first." };

  const { data: passed, error } =
    "code" in input
      ? await core(ctx.userClient).rpc("use_recovery_code", { p_code: input.code })
      : await core(ctx.userClient).rpc("use_recovery_link", { p_token: input.token });
  if (error) return { error: friendly(error.message) };
  if (passed !== true)
    return {
      error:
        "code" in input
          ? "That backup code didn't work. Check it and try again (each code works once)."
          : "That link has expired or was already used. Ask for a new one.",
    };

  const { data: factors, error: listError } = await ctx.adminClient.auth.admin.mfa.listFactors({
    userId: user.id,
  });
  if (listError) return { error: "Two-step sign-in couldn't be turned off. Try again later." };
  for (const f of factors?.factors ?? []) {
    const { error: delError } = await ctx.adminClient.auth.admin.mfa.deleteFactor({
      id: f.id,
      userId: user.id,
    });
    if (delError) return { error: "Two-step sign-in couldn't be turned off. Try again later." };
  }
  const { error: finishError } = await core(ctx.userClient).rpc("finish_two_step_recovery", {
    p_app: ctx.app,
  });
  if (finishError) return { error: friendly(finishError.message) };
  // End every other session on the account: if someone else was signed in, they're out.
  const token =
    ctx.accessToken ?? (await ctx.userClient.auth.getSession()).data.session?.access_token;
  if (token) await ctx.adminClient.auth.admin.signOut(token, "others").catch(() => undefined);
  await ctx.sendNow();
  return { ok: true };
}
