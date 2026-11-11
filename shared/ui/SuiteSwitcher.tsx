// Switch between the suite's apps (SHARED-SPEC §9). Shown when VITE_SUITE_URLS
// lists other apps (hosted, or a self-hoster who sets it); hidden otherwise.
import { APP_NAMES, APP_TAGLINES, appOrgUrl } from "../apps";
import { AppLogo } from "./AppLogo";
import { ALL_APPS, suiteUrls, type AppId, type SuiteUrls } from "../supabase/hosted";
import { Dropdown, itemClass } from "./Dropdown";
import { CheckIcon, ChevronDownIcon, GridIcon } from "./icons";

/** Apps to list: those with a URL, in suite order. Empty when only this app is known. */
export function switcherApps(current: AppId, urls: SuiteUrls): { id: AppId; url: string }[] {
  const apps = ALL_APPS.filter((a) => urls[a]).map((a) => ({ id: a, url: urls[a]! }));
  return apps.some((a) => a.id !== current) ? apps : [];
}

export function SuiteSwitcher({
  current,
  urls = suiteUrls(),
  orgId,
}: {
  current: AppId;
  urls?: SuiteUrls;
  /** The current organization: other apps open straight into it. */
  orgId?: string | null | undefined;
}) {
  const apps = switcherApps(current, urls);
  if (apps.length === 0) return null;
  return (
    <Dropdown
      label={`Switch app (current: ${APP_NAMES[current]})`}
      triggerClassName="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background pl-1 pr-2 text-sm font-medium text-foreground shadow-xs hover:bg-accent focus-visible:outline-2"
      trigger={
        <>
          <span className="grid size-7 place-items-center rounded bg-app-accent text-app-accent-foreground">
            <GridIcon className="size-4" />
          </span>
          <span className="hidden sm:inline">Switch app</span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </>
      }
    >
      {(close) => (
        <ul className="min-w-64">
          {apps.map(({ id, url }) => (
            <li key={id} data-app={id}>
              <a
                href={id === current ? url : appOrgUrl(id, url, orgId)}
                onClick={close}
                aria-current={id === current ? "page" : undefined}
                className={itemClass}
              >
                <AppLogo app={id} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{APP_NAMES[id]}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {APP_TAGLINES[id]}
                  </span>
                </span>
                {id === current ? <CheckIcon className="text-muted-foreground" /> : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
  );
}
