// Adapter so shared UI (router-agnostic) navigates with TanStack Router.
import { Link } from "@tanstack/react-router";
import type { LinkLikeProps } from "@shared/ui/link";

export function RouterLink({ href, children, ...rest }: LinkLikeProps) {
  // Absolute URLs (the hub, other suite apps, docs) are plain links.
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link to={href as never} {...rest}>
      {children}
    </Link>
  );
}
