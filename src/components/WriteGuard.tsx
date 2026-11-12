// Switches a write area off when the person can't write right now (S-05): their role, or the
// organization's plan making Ledger read-only. Everything inside is disabled (a <fieldset
// disabled> that doesn't affect layout); read-only also says why. The database refuses the
// write either way; this only makes it visible before someone fills in a form.
import type { ReactNode } from "react";
import { useAccess } from "@/hooks/use-access";
import type { OrgAction } from "@/lib/permissions";

export function ReadOnlyNote({ className = "" }: { className?: string }) {
  return (
    <p
      role="note"
      className={`rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground ${className}`}
    >
      Ledger is read-only for this organization, so changes are switched off. You can still view and
      export everything.
    </p>
  );
}

export function WriteGuard({
  action = "write",
  children,
}: {
  action?: OrgAction;
  children: ReactNode;
}) {
  const access = useAccess();
  const off = !access.can(action);
  return (
    <>
      {off && access.readOnly ? <ReadOnlyNote className="mb-3" /> : null}
      <fieldset disabled={off} className="contents">
        {children}
      </fieldset>
    </>
  );
}
