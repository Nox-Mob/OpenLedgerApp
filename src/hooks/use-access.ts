// What the signed-in person can do in the current organization right now (S-05): their role
// (src/lib/permissions.ts) and, hosted, whether the organization's plan makes Ledger read-only.
// While read-only the database refuses every write, so write controls are off; reading and
// exporting stay on. The billing query is the shell's (same key), so it costs no extra request.
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgBilling, isReadOnly } from "@shared/supabase/billing";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/use-org-context";
import { isDesktop } from "@/lib/edition";
import { canNow, type OrgAction } from "@/lib/permissions";

/** The hub's billing for the banner and read-only; null when billing is off (self-hosted, desktop). */
export function useBilling(orgId: string | null | undefined) {
  const desktop = isDesktop();
  return useQuery({
    queryKey: ["billing", orgId],
    enabled: !!orgId && !desktop,
    queryFn: () =>
      getOrgBilling(supabase.schema("public") as unknown as SupabaseClient, orgId ?? ""),
  });
}

export function useAccess() {
  const { org } = useOrgContext();
  const billing = useBilling(org?.id);
  const readOnly = isReadOnly(billing.data, "ledger");
  return {
    readOnly,
    can: (action: OrgAction) => canNow(org?.role, action, readOnly),
  };
}
