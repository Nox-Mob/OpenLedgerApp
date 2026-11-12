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
export { AppLogo } from "./AppLogo";
export { EmailPreferencesPanel, EmailServerPanel } from "./EmailSettings";
export {
  DigestFields,
  describeDigest,
  digestIncomplete,
  hourLabel,
  loadDigest,
  saveDigest,
  type DigestPrefs,
} from "./DigestSettings";
export { AddToBoardPackage } from "./AddToBoardPackage";
