import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hubUrl, isHosted } from "@shared/supabase/hosted";
import { supabase as client } from "@/integrations/supabase/client";
import { VerifyRecoveryEmailScreen } from "@shared/ui/Recover";

// Confirms a recovery email (core 0019): opening the link changes nothing until Confirm.
export const Route = createFileRoute("/verify-recovery-email")({
  validateSearch: (search: Record<string, unknown>): { token?: string } => {
    const token = typeof search["token"] === "string" ? search["token"] : "";
    return /^[0-9a-f]{64}$/.test(token) ? { token } : {};
  },
  beforeLoad: ({ search }) => {
    if (isHosted())
      throw redirect({
        href: hubUrl(
          search.token ? `/verify-recovery-email?token=${search.token}` : "/verify-recovery-email",
        ),
      });
  },
  head: () => ({ meta: [{ title: "Confirm your recovery email - OpenLedgerApp" }] }),
  component: VerifyPage,
});

function VerifyPage() {
  const { token } = Route.useSearch();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const supabase = client as unknown as SupabaseClient;
  useEffect(() => {
    void supabase.auth
      .getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null))
      .catch(() => setEmail(null));
  }, [supabase]);
  if (email === undefined) return null;
  return (
    <VerifyRecoveryEmailScreen
      client={supabase}
      email={email}
      token={token}
      signInHref={"/auth"}
      accountHref={"/settings/security"}
    />
  );
}
