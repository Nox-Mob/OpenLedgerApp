import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { SettingsMobileNav } from "@/components/SettingsNav";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings - OpenLedgerApp" },
      { name: "description", content: "Organization and personal settings." },
      { property: "og:title", content: "Settings - OpenLedgerApp" },
      { property: "og:description", content: "Organization and personal settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsLayout,
});

function SettingsLayout() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  // The settings pages are listed in the left sidebar (AppShell, SettingsSidebar), like
  // OpenCharterApp; phones get a dropdown here.
  return (
    <AppShell>
      <h1 className="font-display text-2xl font-bold">Settings</h1>
      <div className="mt-4">
        <SettingsMobileNav pathname={pathname} />
      </div>
      <div className="mt-6 min-w-0">
        <Outlet />
      </div>
    </AppShell>
  );
}
