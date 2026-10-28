import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

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

const SECTIONS = [
  { to: "/settings", label: "Organization profile", exact: true },
  { to: "/settings/accounts", label: "Accounts", exact: false },
  { to: "/settings/members", label: "Users & roles", exact: false },
  { to: "/settings/close", label: "Close the books", exact: false },
  { to: "/settings/exports", label: "Exports and backup", exact: false },
  { to: "/settings/history", label: "History", exact: false },
  { to: "/settings/diagnostics", label: "Diagnostics", exact: false },
  { to: "/settings/preferences", label: "Your preferences", exact: false },
  { to: "/settings/security", label: "Security", exact: false },
] as const;

function SettingsLayout() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-bold">Settings</h1>
      <div className="mt-6 flex flex-col gap-6 md:flex-row">
        <nav className="w-full shrink-0 md:w-52">
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Organization settings
          </p>
          <ul className="mt-2 space-y-1">
            {SECTIONS.map((s) => {
              const active = s.exact ? pathname === s.to : pathname.startsWith(s.to);
              return (
                <li key={s.to}>
                  <Link
                    to={s.to}
                    className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }`}
                  >
                    {s.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </AppShell>
  );
}
