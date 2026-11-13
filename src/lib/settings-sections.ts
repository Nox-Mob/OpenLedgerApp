// Settings pages, listed in the left sidebar under Settings (like OpenCharterApp) and, on
// phones, in a dropdown on the settings page.
export const SETTINGS_SECTIONS = [
  { to: "/settings", label: "Organization profile", exact: true },
  { to: "/settings/accounts", label: "Accounts", exact: false },
  { to: "/settings/members", label: "Users & roles", exact: false },
  { to: "/settings/close", label: "Close the books", exact: false },
  { to: "/settings/charter", label: "OpenCharterApp payments", exact: false },
  { to: "/settings/exports", label: "Exports and backup", exact: false },
  { to: "/settings/history", label: "History", exact: false },
  { to: "/settings/diagnostics", label: "Diagnostics", exact: false },
  { to: "/settings/preferences", label: "Your preferences", exact: false },
  { to: "/settings/email", label: "Email", exact: false },
  { to: "/settings/security", label: "Security", exact: false },
] as const;

export type SettingsPath = (typeof SETTINGS_SECTIONS)[number]["to"];

export function inSettings(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/** The settings page open at `pathname`, or null outside settings. */
export function currentSettingsSection(pathname: string): SettingsPath | null {
  if (!inSettings(pathname)) return null;
  const hit = SETTINGS_SECTIONS.filter((s) =>
    s.exact ? pathname === s.to : pathname === s.to || pathname.startsWith(`${s.to}/`),
  ).sort((a, b) => b.to.length - a.to.length)[0];
  return hit?.to ?? "/settings";
}
