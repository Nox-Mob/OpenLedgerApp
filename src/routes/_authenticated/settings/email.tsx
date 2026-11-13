import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hubUrl, isHosted } from "@shared/supabase/hosted";
import { EmailPreferencesPanel, EmailServerPanel } from "@shared/ui/EmailSettings";
import { NotificationSettings } from "@shared/ui/Notifications";
import { supabase } from "@/integrations/supabase/client";
import { isDesktop } from "@/lib/edition";
import { loadEmailSettings, saveEmailSettings, sendTestEmail } from "@/lib/email.functions";

export const Route = createFileRoute("/_authenticated/settings/email")({
  head: () => ({
    meta: [
      { title: "Email - OpenLedgerApp" },
      { name: "description", content: "Your email choices and the mail server." },
    ],
  }),
  component: EmailSettings,
});

function EmailSettings() {
  return (
    <div className="max-w-2xl space-y-4">
      {isDesktop() ? (
        <section className="rounded-lg border bg-card p-5 text-sm">
          <h2 className="text-base font-semibold">Email</h2>
          <p className="mt-1 text-muted-foreground">
            The desktop edition doesn't send email: everything stays on this computer.
          </p>
        </section>
      ) : isHosted() ? (
        <section className="rounded-lg border bg-card p-5 text-sm">
          <h2 className="text-base font-semibold">Your email</h2>
          <p className="mt-1 text-muted-foreground">
            Choose your reminders and task summary on your OpenAppHub account page; they apply to
            every app.
          </p>
          <a className="mt-3 inline-block underline" href={hubUrl("/account#notifications")}>
            Open your notifications and email choices
          </a>
        </section>
      ) : (
        <>
          <section id="notifications" className="space-y-3 rounded-md border bg-card p-5">
            <h2 className="text-lg font-semibold">Notifications</h2>
            <p className="text-sm text-muted-foreground">
              What you're told about, under the bell at the top and by email.
            </p>
            <NotificationSettings client={supabase as unknown as SupabaseClient} />
          </section>
          <EmailPreferencesPanel client={supabase as unknown as SupabaseClient} />
          <EmailServerPanel
            load={() => loadEmailSettings()}
            save={async (data) => {
              await saveEmailSettings({ data });
            }}
            test={() => sendTestEmail()}
          />
        </>
      )}
    </div>
  );
}
