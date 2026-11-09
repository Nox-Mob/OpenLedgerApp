// Switch the current organization (SHARED-SPEC §4.1). The choice is the
// `oah_org` cookie (suite-wide when hosted); the app re-checks it against
// memberships. "Create organization" goes to the hub (hosted) or the app's own
// screen (self-hosted), whichever href the app passes.
import { setCurrentOrg } from "../supabase/org";
import { Dropdown, itemClass } from "./Dropdown";
import { CheckIcon, ChevronsIcon, PlusIcon } from "./icons";
import { PlainLink, type LinkLike } from "./link";

export type SwitcherOrg = { id: string; name: string; role?: string };

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export function OrgSwitcher({
  orgs,
  currentOrgId,
  onSelect,
  createHref,
  manageHref,
  LinkComponent = PlainLink,
}: {
  orgs: SwitcherOrg[];
  currentOrgId: string | null;
  /** Called after the cookie is set; reload or re-fetch data for the new org. */
  onSelect?: (orgId: string) => void;
  createHref?: string;
  manageHref?: string;
  LinkComponent?: LinkLike;
}) {
  const current = orgs.find((o) => o.id === currentOrgId) ?? null;
  return (
    <Dropdown
      label={
        current ? `Organization: ${current.name}. Switch organization` : "Choose an organization"
      }
      triggerClassName="inline-flex h-9 max-w-[11rem] items-center gap-2 rounded-md border border-border bg-card px-2.5 text-sm font-medium text-foreground shadow-sm hover:bg-accent sm:max-w-xs"
      trigger={
        <>
          <span className="size-2 shrink-0 rounded-full bg-app-accent" aria-hidden="true" />
          <span className="min-w-0 truncate">{current?.name ?? "No organization"}</span>
          <ChevronsIcon className="text-muted-foreground" />
        </>
      }
    >
      {(close) => (
        <div className="min-w-64">
          {orgs.length > 0 ? (
            <ul aria-label="Your organizations" className="max-h-72 overflow-y-auto">
              {orgs.map((org) => (
                <li key={org.id}>
                  <button
                    type="button"
                    aria-current={org.id === currentOrgId ? "true" : undefined}
                    className={itemClass}
                    onClick={() => {
                      close();
                      if (org.id === currentOrgId) return;
                      setCurrentOrg(org.id);
                      onSelect?.(org.id);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{org.name}</span>
                      {org.role ? (
                        <span className="block text-xs text-muted-foreground">
                          {ROLE_LABEL[org.role] ?? org.role}
                        </span>
                      ) : null}
                    </span>
                    {org.id === currentOrgId ? (
                      <CheckIcon className="text-muted-foreground" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">
              You're not in an organization yet.
            </p>
          )}
          {createHref || manageHref ? <div className="my-1 border-t" /> : null}
          {manageHref && current ? (
            <LinkComponent href={manageHref} className={itemClass} onClick={close}>
              Organization settings
            </LinkComponent>
          ) : null}
          {createHref ? (
            <LinkComponent href={createHref} className={itemClass} onClick={close}>
              <PlusIcon className="text-muted-foreground" />
              Create organization
            </LinkComponent>
          ) : null}
        </div>
      )}
    </Dropdown>
  );
}
