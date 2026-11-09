// A link to a docs page (SHARED-SPEC §12.3). Use next to non-obvious tasks:
//   <HelpLink path="hub/accounts/invitations/">How invitations work</HelpLink>
import type { ReactNode } from "react";
import { docsUrl } from "../docs";
import { HelpIcon } from "./icons";

export function HelpLink({
  path,
  children = "Help",
  className = "",
}: {
  path: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={docsUrl(path)}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline ${className}`}
    >
      <HelpIcon />
      {children}
      <span className="sr-only"> (opens the docs in a new tab)</span>
    </a>
  );
}
