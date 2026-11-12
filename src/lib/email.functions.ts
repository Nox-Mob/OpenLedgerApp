// Server functions for Ledger's email settings page (S-16).
import { createServerFn } from "@tanstack/react-start";
import { desktopAware } from "@/lib/desktop/bridge";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSettingsInput } from "@shared/email/selfhost";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const client = (c: { supabase: unknown }) => c.supabase as SupabaseClient;

const loadEmailSettingsCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getEmailSettings } = await import("@shared/email/selfhost");
    const { selfHostContext } = await import("./email.server");
    return getEmailSettings(selfHostContext(client(context)));
  });

const saveEmailSettingsCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => input as EmailSettingsInput)
  .handler(async ({ data, context }) => {
    const { saveEmailSettings: save } = await import("@shared/email/selfhost");
    const { selfHostContext } = await import("./email.server");
    await save(selfHostContext(client(context)), data);
    return { ok: true };
  });

const sendTestEmailCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendTestEmail: send } = await import("@shared/email/selfhost");
    const { selfHostContext, appOrigin, EMAIL_SETTINGS_PATH } = await import("./email.server");
    const ctx = selfHostContext(client(context));
    return send(ctx, {
      app: "ledger",
      appUrl: appOrigin(ctx.env, getRequest()),
      preferencesPath: EMAIL_SETTINGS_PATH,
    });
  });

// The desktop edition doesn't send email (the email page says so).
export const loadEmailSettings = desktopAware("loadEmailSettings", loadEmailSettingsCloud);
export const saveEmailSettings = desktopAware("saveEmailSettings", saveEmailSettingsCloud);
export const sendTestEmail = desktopAware("sendTestEmail", sendTestEmailCloud);
