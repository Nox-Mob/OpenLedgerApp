// The suite's app frame (SHARED-SPEC §9): left sidebar + top bar with
// SuiteSwitcher, OrgSwitcher, Help and the user menu (theme toggle, sign out),
// BillingBanner underneath. Below 768px the sidebar becomes a drawer.
// Router-agnostic (pass your router's Link as LinkComponent) and SSR-safe.
import { useRef, useState, type ReactNode } from "react";
import { APP_NAMES } from "../apps";
import { AppLogo } from "./AppLogo";
import type { OrgBilling } from "../supabase/billing";
import type { AppId } from "../supabase/hosted";
import { BillingBanner } from "./BillingBanner";
import { Dropdown, itemClass } from "./Dropdown";
import { CloseIcon, CookieIcon, HelpIcon, LogOutIcon, MenuIcon, UserIcon } from "./icons";
import { PlainLink, type LinkLike } from "./link";
import { OrgSwitcher, type SwitcherOrg } from "./OrgSwitcher";
import { SuiteSwitcher } from "./SuiteSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { useFocusTrap } from "./useFocusTrap";
import { openCookieSettings } from "../consent";

export type NavItem = {
  label: string;
  href: string;
  icon?: ReactNode;
  current?: boolean;
};

export type AppShellProps = {
  app: AppId;
  nav: NavItem[];
  /** Extra links at the bottom of the sidebar (e.g. Settings). */
  navFooter?: NavItem[];
  /**
   * Extra sidebar content under the nav, desktop only (e.g. a page's own section menu, as in
   * Charter). On phones pages show their own section picker instead.
   */
  sidebar?: ReactNode;
  user: { name: string | null; email: string | null } | null;
  orgs: SwitcherOrg[];
  currentOrgId: string | null;
  onSelectOrg?: (orgId: string) => void;
  orgCreateHref?: string;
  orgManageHref?: string;
  billing?: OrgBilling | null;
  canManageBilling?: boolean;
  billingHref?: string;
  /** The app's docs tab, e.g. docsUrl("board/"). Shown as Help. */
  helpHref: string;
  accountHref?: string;
  onSignOut: () => void;
  LinkComponent?: LinkLike;
  children: ReactNode;
};

function initials(name: string | null, email: string | null): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts[1]?.[0] ?? "") : "")).toUpperCase();
}

function SideNav({
  app,
  nav,
  navFooter,
  helpHref,
  LinkComponent,
  onNavigate,
  sidebar,
}: Pick<AppShellProps, "app" | "nav" | "helpHref"> & {
  navFooter?: NavItem[] | undefined;
  sidebar?: ReactNode;
  LinkComponent: LinkLike;
  onNavigate?: (() => void) | undefined;
}) {
  const item = (n: NavItem) => (
    <li key={n.href}>
      <LinkComponent
        href={n.href}
        onClick={onNavigate}
        aria-current={n.current ? "page" : undefined}
        className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0 ${
          n.current
            ? "bg-accent text-foreground before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-full before:bg-app-accent [&_svg]:text-app-accent"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        {n.icon}
        {n.label}
      </LinkComponent>
    </li>
  );
  return (
    <div className="flex h-full flex-col gap-5 px-3 py-4">
      <div className="flex items-center gap-2.5 px-2 font-semibold">
        <AppLogo app={app} size={28} />
        {APP_NAMES[app]}
      </div>
      <nav aria-label={APP_NAMES[app]} className="flex-1 overflow-y-auto">
        <ul className="flex flex-col gap-0.5">{nav.map(item)}</ul>
        {sidebar ? <div className="mt-2">{sidebar}</div> : null}
      </nav>
      <ul className="flex flex-col gap-0.5">
        {(navFooter ?? []).map(item)}
        <li>
          <a
            href={helpHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <HelpIcon />
            Help
          </a>
        </li>
      </ul>
    </div>
  );
}

/** Phone drawer: modal, focus trapped, Escape/backdrop/link closes it, focus returns. */
function Drawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, open, onClose);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r bg-sidebar text-sidebar-foreground shadow-lg"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="absolute top-3 right-3 grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <CloseIcon />
        </button>
        {children}
      </div>
    </div>
  );
}

function UserMenu({
  user,
  accountHref,
  helpHref,
  onSignOut,
  LinkComponent,
}: Pick<AppShellProps, "user" | "accountHref" | "helpHref" | "onSignOut"> & {
  LinkComponent: LinkLike;
}) {
  return (
    <Dropdown
      label="Account menu"
      align="end"
      triggerClassName="grid size-9 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground hover:ring-2 hover:ring-border"
      trigger={<span aria-hidden="true">{initials(user?.name ?? null, user?.email ?? null)}</span>}
    >
      {(close) => (
        <div className="min-w-64">
          {user ? (
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-semibold">{user.name || user.email}</p>
              {user.name && user.email ? (
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3 px-2.5 py-2">
            <span className="text-sm text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
          <div className="my-1 border-t" />
          {accountHref ? (
            <LinkComponent href={accountHref} className={itemClass} onClick={close}>
              <UserIcon className="text-muted-foreground" />
              Account
            </LinkComponent>
          ) : null}
          <a
            href={helpHref}
            target="_blank"
            rel="noopener noreferrer"
            className={itemClass}
            onClick={close}
          >
            <HelpIcon className="text-muted-foreground" />
            Help
          </a>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              close();
              openCookieSettings();
            }}
          >
            <CookieIcon className="text-muted-foreground" />
            Cookie settings
          </button>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              close();
              onSignOut();
            }}
          >
            <LogOutIcon className="text-muted-foreground" />
            Sign out
          </button>
        </div>
      )}
    </Dropdown>
  );
}

export function AppShell(props: AppShellProps) {
  const {
    app,
    nav,
    navFooter,
    sidebar,
    user,
    orgs,
    currentOrgId,
    onSelectOrg,
    orgCreateHref,
    orgManageHref,
    billing,
    canManageBilling = false,
    billingHref,
    helpHref,
    accountHref,
    onSignOut,
    LinkComponent = PlainLink,
    children,
  } = props;
  const [drawer, setDrawer] = useState(false);
  const closeDrawer = () => setDrawer(false);

  return (
    <div data-app={app} className="flex min-h-screen bg-background text-foreground">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground md:block">
        <SideNav
          app={app}
          nav={nav}
          navFooter={navFooter}
          helpHref={helpHref}
          LinkComponent={LinkComponent}
          sidebar={sidebar}
        />
      </aside>
      <Drawer open={drawer} onClose={closeDrawer} label={`${APP_NAMES[app]} menu`}>
        <SideNav
          app={app}
          nav={nav}
          navFooter={navFooter}
          helpHref={helpHref}
          LinkComponent={LinkComponent}
          onNavigate={closeDrawer}
        />
      </Drawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-1.5 border-b bg-background/90 px-2 backdrop-blur sm:gap-2 sm:px-4">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            aria-expanded={drawer}
            className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          >
            <MenuIcon />
          </button>
          <SuiteSwitcher current={app} orgId={currentOrgId} />
          <OrgSwitcher
            orgs={orgs}
            currentOrgId={currentOrgId}
            {...(onSelectOrg ? { onSelect: onSelectOrg } : {})}
            {...(orgCreateHref ? { createHref: orgCreateHref } : {})}
            {...(orgManageHref ? { manageHref: orgManageHref } : {})}
            LinkComponent={LinkComponent}
          />
          <span className="flex-1" />
          <a
            href={helpHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Help (opens the docs in a new tab)"
            className="hidden size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground sm:grid"
          >
            <HelpIcon />
          </a>
          <UserMenu
            user={user}
            {...(accountHref ? { accountHref } : {})}
            helpHref={helpHref}
            onSignOut={onSignOut}
            LinkComponent={LinkComponent}
          />
        </header>
        {billingHref ? (
          <BillingBanner
            billing={billing}
            app={app}
            canManage={canManageBilling}
            billingHref={billingHref}
          />
        ) : null}
        <main id="main" className="mx-auto w-full max-w-[76rem] flex-1 px-4 py-6 sm:px-8 sm:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}
