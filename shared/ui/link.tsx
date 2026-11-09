// Shared UI renders links through a component the app passes in (its router's
// Link), falling back to a plain <a>. Keeps shared UI router-agnostic.
import type { ComponentType, MouseEventHandler, ReactNode } from "react";

export type LinkLikeProps = {
  href: string;
  className?: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  "aria-current"?: "page" | undefined;
  "aria-label"?: string;
};

export type LinkLike = ComponentType<LinkLikeProps>;

export function PlainLink({ href, children, ...rest }: LinkLikeProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
