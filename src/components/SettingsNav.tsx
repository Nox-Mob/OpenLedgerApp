import { Link, useNavigate } from "@tanstack/react-router";
import {
  currentSettingsSection,
  SETTINGS_SECTIONS,
  type SettingsPath,
} from "@/lib/settings-sections";
import { cn } from "@/lib/utils";

/** The suite's sidebar item look (shared AppShell), as in OpenCharterApp's sidebar. */
const itemClass = (active: boolean) =>
  cn(
    "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
    active
      ? "bg-accent text-foreground before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-full before:bg-app-accent [&_svg]:text-app-accent"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  );

/**
 * The settings pages, in the left sidebar right under the Settings item (the last item of the
 * main menu) while a settings page is open, like OpenCharterApp (D-188). Desktop only; phones
 * get SettingsMobileNav on the page.
 */
export function SettingsSidebar({ pathname }: { pathname: string }) {
  const current = currentSettingsSection(pathname);
  if (current === null) return null;
  return (
    <ul className="-mt-1.5 flex flex-col gap-0.5" aria-label="Settings">
      {SETTINGS_SECTIONS.map((s) => (
        <li key={s.to}>
          <Link
            to={s.to}
            aria-current={s.to === current ? "page" : undefined}
            className={cn(itemClass(s.to === current), "py-1.5 pl-10 font-normal")}
          >
            {s.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Phones (the sidebar is a drawer there): the settings pages as a dropdown. */
export function SettingsMobileNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const current = currentSettingsSection(pathname) ?? "/settings";
  return (
    <label className="block md:hidden">
      <span className="sr-only">Settings page</span>
      <select
        value={current}
        onChange={(e) => void navigate({ to: e.target.value as SettingsPath })}
        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
      >
        {SETTINGS_SECTIONS.map((s) => (
          <option key={s.to} value={s.to}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
