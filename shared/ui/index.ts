// Shared UI for every suite app. See shared/design/DESIGN.md.
export { AppShell, type AppShellProps, type NavItem } from "./AppShell";
export { SuiteSwitcher, switcherApps } from "./SuiteSwitcher";
export { OrgSwitcher, type SwitcherOrg } from "./OrgSwitcher";
export { BillingBanner } from "./BillingBanner";
export { HelpLink } from "./HelpLink";
export {
  InvitationPage,
  invitationRoute,
  invitationSummary,
  type AcceptedInvitation,
  type InvitationInfo,
} from "./InvitationPage";
export { ThemeToggle } from "./ThemeToggle";
export { PlainLink, type LinkLike, type LinkLikeProps } from "./link";
export { CookieConsent, CookieTable } from "./CookieConsent";
