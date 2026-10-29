// Names are unique across active and archived items, so typing an archived name
// offers to turn that item back on instead of creating a second one.
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { setCatalogActiveFn } from "@/lib/taxonomy.functions";
import { showError } from "@/lib/show-error";

type Kind = "category" | "tag" | "fund" | "project";
type Archived = { id: string; name: string; kind: Kind };
export type CreateResult = { ok: true } | { ok: false; archived: Archived };

const LABEL: Record<Kind, string> = {
  category: "category",
  tag: "tag",
  fund: "fund",
  project: "project",
};

/**
 * Returns `handle(result)`, true when the item was saved, plus the dialog to render.
 * `onRestored` runs after the archived item is turned back on.
 */
export function useRestoreArchived(orgId: string | undefined, onRestored: () => void) {
  const [pending, setPending] = useState<Archived | null>(null);
  const [busy, setBusy] = useState(false);

  function handle(result: CreateResult): boolean {
    if (result.ok) return true;
    setPending(result.archived);
    return false;
  }

  async function restore() {
    if (!pending || !orgId) return;
    setBusy(true);
    try {
      await setCatalogActiveFn({
        data: { orgId, kind: pending.kind, id: pending.id, active: true },
      });
      toast.success(`${pending.name} is active again`);
      setPending(null);
      onRestored();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Turn {pending?.name} back on?</AlertDialogTitle>
          <AlertDialogDescription>
            There is already an archived {pending ? LABEL[pending.kind] : ""} with this name. Names
            are unique, so you can restore it instead. Its past transactions stay attached.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void restore();
            }}
          >
            Restore
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { handle, dialog };
}

/** Archive or restore one item, with a toast either way. */
export async function toggleArchived(
  orgId: string,
  item: { kind: Kind; id: string; name: string },
  active: boolean,
  onDone: () => void,
) {
  try {
    await setCatalogActiveFn({ data: { orgId, kind: item.kind, id: item.id, active } });
    toast.success(active ? `${item.name} restored` : `${item.name} archived`);
    onDone();
  } catch (err) {
    showError(err);
  }
}
