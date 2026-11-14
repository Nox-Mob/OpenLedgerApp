import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hubUrl, isHosted } from "@shared/supabase/hosted";
import { supabase as client } from "@/integrations/supabase/client";
import { RecoverScreen } from "@shared/ui/Recover";
import { recoverTwoStep, sendRecoveryLink } from "@/lib/security.functions";

// "Can't use your authenticator app?" (core 0019). Hosted, OpenAppHub's page does this.
export const Route = createFileRoute("/recover")({
  validateSearch: (search: Record<string, unknown>): { token?: string } => {
    const token = typeof search["token"] === "string" ? search["token"] : "";
    return /^[0-9a-f]{64}$/.test(token) ? { token } : {};
  },
  beforeLoad: ({ search }) => {
    if (isHosted())
      throw redirect({
        href: hubUrl(search.token ? `/recover?token=${search.token}` : "/recover"),
      });
  },
  head: () => ({ meta: [{ title: "Get back into your account - OpenLedgerApp" }] }),
  component: RecoverPage,
});

function RecoverPage() {
  const { token } = Route.useSearch();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void (client as unknown as SupabaseClient).auth
      .getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null))
      .catch(() => setEmail(null));
  }, []);
  if (email === undefined) return null;
  return (
    <RecoverScreen
      email={email}
      token={token}
      signInHref={"/auth"}
      setupHref={"/settings/security"}
      recover={(input) => recoverTwoStep({ data: input })}
      sendLink={() => sendRecoveryLink()}
    />
  );
}
