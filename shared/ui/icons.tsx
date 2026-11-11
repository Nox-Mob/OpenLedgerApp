// Inline icons for shared UI (no icon-library dependency: the apps use different
// lucide versions). 24×24, stroke = currentColor.
import type { SVGProps } from "react";

function Svg({ d, ...props }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
      className={`size-4 shrink-0 ${props.className ?? ""}`}
    >
      <path d={d} />
    </svg>
  );
}

// Without `d`: each icon sets its own path, so a caller's props can never replace it.
type P = Omit<SVGProps<SVGSVGElement>, "d">;
export const MenuIcon = (p: P) => <Svg d="M4 6h16M4 12h16M4 18h16" {...p} />;
export const CloseIcon = (p: P) => <Svg d="M6 6l12 12M18 6 6 18" {...p} />;
export const GridIcon = (p: P) => (
  <Svg d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" {...p} />
);
export const ChevronsIcon = (p: P) => <Svg d="m7 15 5 5 5-5M7 9l5-5 5 5" {...p} />;
export const CheckIcon = (p: P) => <Svg d="M20 6 9 17l-5-5" {...p} />;
export const ChevronDownIcon = (p: P) => <Svg d="m6 9 6 6 6-6" {...p} />;
export const PlusIcon = (p: P) => <Svg d="M12 5v14M5 12h14" {...p} />;
export const HelpIcon = (p: P) => (
  <Svg
    d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"
    {...p}
  />
);
export const LogOutIcon = (p: P) => (
  <Svg d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" {...p} />
);
export const UserIcon = (p: P) => (
  <Svg d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" {...p} />
);
export const InfoIcon = (p: P) => (
  <Svg d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01" {...p} />
);
export const AlertIcon = (p: P) => (
  <Svg
    d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"
    {...p}
  />
);
export const ExternalIcon = (p: P) => (
  <Svg d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" {...p} />
);
export const MailIcon = (p: P) => (
  <Svg
    d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3 7l9 6 9-6"
    {...p}
  />
);
export const CookieIcon = (p: P) => (
  <Svg
    d="M21 12.5A9 9 0 1 1 11.5 3a3 3 0 0 0 4 4 3 3 0 0 0 5.5 5.5ZM8.5 9.5h.01M14 15h.01M9 15.5h.01"
    {...p}
  />
);
