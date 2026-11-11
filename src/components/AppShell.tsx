import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SettingsSidebar } from "@/components/SettingsNav";
import { AppShell as SuiteShell } from "@shared/ui/AppShell";
import { getOrgBilling } from "@shared/supabase/billing";
import { hubUrl, isHosted } from "@shared/supabase/hosted";
import { helpHrefFor } from "@/config/help";
import { RouterLink } from "@/lib/router-link";
import { setStoredOrgId } from "@/lib/current-org";
import {
  LayoutDashboard,
  ArrowLeftRight,
  PlusCircle,
  Landmark,
  Upload,
  ListChecks,
  Repeat,
  FolderKanban,
  Target,
  PiggyBank,
  HandCoins,
  FileBarChart,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRouterState } from "@tanstack/react-router";
import { useAal } from "@/hooks/use-aal";
import { MfaCodeForm } from "@/components/MfaCodeForm";
import { useOrgContext } from "@/hooks/use-org-context";
import { ErrorState, LoadingState } from "@/components/PageStates";
import { errorMessage } from "@/lib/errors";
import { isDesktop } from "@/lib/edition";
import { TutorialPanel } from "@/components/Tutorial";

const NAV = [
  { to: "/ledger", label: "Dashboard", icon: LayoutDashboard },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/transactions/new", label: "New Transaction", icon: PlusCircle, write: true },
  { to: "/templates", label: "Templates", icon: Repeat },
  { to: "/accounts", label: "Accounts", icon: Landmark },
  { to: "/import", label: "Import Bank File", icon: Upload, write: true },
  { to: "/reconcile", label: "Reconcile", icon: ListChecks },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/budgets", label: "Budgets", icon: Target },
  { to: "/funds", label: "Funds", icon: PiggyBank },
  { to: "/pledges", label: "Pledges", icon: HandCoins },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

/** The nav item for this page: the longest matching path (so /transactions/new isn't also /transactions). */
function currentNav(pathname: string, items: readonly { to: string }[]): string | null {
  const hits = items.filter((i) =>
    i.to === "/ledger"
      ? pathname === "/ledger"
      : pathname === i.to || pathname.startsWith(`${i.to}/`),
  );
  return hits.sort((a, b) => b.to.length - a.to.length)[0]?.to ?? null;
}

/**
 * Every signed-in page sits in the suite's AppShell (shared/ui, SHARED-SPEC §9): sidebar, top
 * bar with the suite and organization switchers, Help and the user menu, and the billing banner.
 * Hosted, organizations are created in OpenAppHub; self-hosted (and desktop), in Ledger.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { org, orgs, terms, error, retry } = useOrgContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const aal = useAal();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const mfaBlocked =
    !!org?.requireMfa && aal.data?.current !== "aal2" && pathname !== "/settings/security";
  const desktop = isDesktop();

  const user = useQuery({
    queryKey: ["auth-user"],
    enabled: !desktop,
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const name = (meta["full_name"] ?? meta["display_name"] ?? null) as string | null;
      return { name, email: data.user?.email ?? null };
    },
  });
  // The billing banner (trial, payment problem, read-only); null when billing is off.
  const billing = useQuery({
    queryKey: ["billing", org?.id],
    enabled: !!org && !desktop,
    queryFn: () =>
      getOrgBilling(supabase.schema("public") as unknown as SupabaseClient, org?.id ?? ""),
  });

  async function signOut() {
    await supabase.auth.signOut();
    queryClient.clear();
    if (isHosted()) window.location.assign(hubUrl("/"));
    else navigate({ to: "/auth" });
  }

  const items = NAV.filter((item) => !("write" in item && item.write) || org?.role !== "viewer");
  const active = currentNav(pathname, items);
  // Settings is the menu's last item (NAV); its pages open under it (SettingsSidebar).
  const nav = items.map((item) => ({
    label: item.to === "/reconcile" ? terms.reconcile : item.label,
    href: item.to,
    icon: <item.icon aria-hidden="true" />,
    current: item.to === active,
  }));
  const createHref = isHosted() ? hubUrl("/orgs/new") : "/onboarding";

  return (
    <SuiteShell
      app="ledger"
      nav={nav}
      sidebar={<SettingsSidebar pathname={pathname} />}
      user={desktop ? null : (user.data ?? null)}
      orgs={orgs.map((o) => ({ id: o.id, name: o.name, role: o.role }))}
      currentOrgId={org?.id ?? null}
      onSelectOrg={(id) => {
        setStoredOrgId(id);
        void queryClient.invalidateQueries();
      }}
      orgCreateHref={createHref}
      billing={billing.data ?? null}
      canManageBilling={org?.role === "admin"}
      billingHref={hubUrl("/billing")}
      helpHref={helpHrefFor(pathname)}
      onSignOut={() => void signOut()}
      LinkComponent={RouterLink}
    >
      {error && !org ? (
        <ErrorState
          title="Your organizations didn't load"
          message={errorMessage(error)}
          onRetry={retry}
        />
      ) : aal.data && aal.data.next === "aal2" && aal.data.current !== "aal2" ? (
        <div className="max-w-sm rounded-lg border bg-card p-6">
          <h1 className="mb-3 font-display text-xl font-semibold">Two-step sign-in</h1>
          <MfaCodeForm onDone={() => void queryClient.invalidateQueries()} />
        </div>
      ) : mfaBlocked ? (
        <div role="alert" className="max-w-xl rounded-lg border bg-card p-6">
          <h1 className="font-display text-xl font-semibold">Two-step sign-in required</h1>
          <p className="mt-2 text-sm">
            {org?.name} requires two-step sign-in. Set it up (or sign out and back in with your
            code) to see its books.
          </p>
          <Link
            to="/settings/security"
            className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Go to Security
          </Link>
        </div>
      ) : (
        children
      )}
      <footer className="mt-12 flex flex-wrap gap-x-4 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
        <Link to="/terms" className="hover:text-foreground">
          Terms
        </Link>
        <Link to="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link to="/not-advice" className="hover:text-foreground">
          Not advice
        </Link>
        <Link to="/cookies" className="hover:text-foreground">
          Cookies
        </Link>
      </footer>
      {org && <TutorialPanel orgId={org.id} />}
    </SuiteShell>
  );
}

/** Shown by pages while the current organization is still loading. */
export function OrgPending({ inShell = true }: { inShell?: boolean }) {
  const body = <LoadingState label="Loading your organization" />;
  return inShell ? <AppShell>{body}</AppShell> : body;
}
