// S-18: OpenCharterApp payments waiting to be booked, one draft per day and channel. Nothing is
// booked until someone selects Post (owner decision: always review first).
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { isHosted, suiteUrls } from "@shared/supabase/hosted";
import {
  listCharterDrafts,
  postCharterDraft,
  skipCharterDraft,
} from "@/lib/charter-income.functions";
import { draftDescription, type CharterDraft } from "@/lib/services/charter-income";
import { formatCents, parseToCents } from "@/lib/money";
import { showError } from "@/lib/show-error";
import { isDesktop } from "@/lib/edition";

const keyOf = (d: CharterDraft) => `${d.day}:${d.channel}:${d.kind}`;

/** Where the payments are in OpenCharterApp, when it's on another address. */
export function charterPaymentsHref(orgId: string): string | null {
  const base = isHosted() ? suiteUrls().charter : null;
  return base ? `${base.replace(/\/$/, "")}/orgs/${orgId}?tab=payments` : null;
}

export function CharterDrafts({ orgId, canWrite }: { orgId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [fees, setFees] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ["charter-drafts", orgId],
    queryFn: () => listCharterDrafts({ data: { orgId } }),
    enabled: !isDesktop(),
  });
  const items = q.data ?? [];
  if (items.length === 0) return null;
  const charter = charterPaymentsHref(orgId);

  async function act(kind: "post" | "skip", d: CharterDraft) {
    const id = keyOf(d);
    const typed = fees[id];
    let feeCents: number | undefined;
    if (kind === "post" && typed !== undefined && d.channel === "card" && d.kind === "payments") {
      const c = parseToCents(typed);
      if (c === null || c < 0 || c >= d.gross_cents) {
        toast.error("Enter a fee of at least 0 and less than the total.");
        return;
      }
      feeCents = c;
    }
    setBusy(id);
    try {
      const input = {
        orgId,
        day: d.day,
        channel: d.channel,
        kind: d.kind,
        paymentIds: d.payment_ids,
        ...(feeCents === undefined ? {} : { feeCents }),
      };
      if (kind === "post") {
        await postCharterDraft({ data: input });
        toast.success("Posted. The dues are in your books.");
      } else {
        await skipCharterDraft({ data: input });
        toast.success("Skipped. Nothing was recorded; you can bring it back from Settings.");
      }
      await qc.invalidateQueries();
    } catch (e) {
      showError(e, kind === "post" ? "Could not post" : "Could not skip");
      await qc.invalidateQueries({ queryKey: ["charter-drafts", orgId] });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="From OpenCharterApp"
      className="mt-6 overflow-hidden rounded-lg border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-4 py-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-primary" aria-hidden="true" />
          Dues from OpenCharterApp to review ({items.length})
        </h2>
        <span className="flex gap-3 text-xs">
          {charter ? (
            <a className="underline" href={charter}>
              See the payments in OpenCharterApp
            </a>
          ) : null}
          <Link to="/settings/charter" className="underline">
            Settings
          </Link>
        </span>
      </div>
      <ul>
        {items.map((d) => {
          const id = keyOf(d);
          const card = d.channel === "card" && d.kind === "payments";
          const chapters = [
            ...new Set(d.lines.filter((l) => !l.is_national).map((l) => l.unit_name)),
          ];
          return (
            <li
              key={id}
              className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm last:border-0"
            >
              <span className="tnum text-muted-foreground">{d.day}</span>
              <span className="min-w-48 flex-1">
                {draftDescription(d)}
                {chapters.length ? (
                  <span className="block text-xs text-muted-foreground">
                    Including {chapters.join(", ")}
                  </span>
                ) : null}
              </span>
              {card ? (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Fee (estimated)
                  <input
                    aria-label={`Card fee for ${d.day}`}
                    inputMode="decimal"
                    className="tnum h-7 w-20 rounded-md border border-input bg-background px-2 text-right text-sm text-foreground"
                    value={fees[id] ?? (d.fee_cents / 100).toFixed(2)}
                    disabled={!canWrite}
                    onChange={(e) => setFees((f) => ({ ...f, [id]: e.target.value }))}
                  />
                </label>
              ) : null}
              <span className="tnum">
                {d.kind === "refunds" ? "−" : ""}
                {formatCents(d.gross_cents)}
              </span>
              {canWrite && (
                <span className="flex gap-2">
                  <button
                    disabled={busy === id}
                    onClick={() => void act("post", d)}
                    className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Post
                  </button>
                  <button
                    disabled={busy === id}
                    onClick={() => void act("skip", d)}
                    className="rounded-md border border-input px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    Skip
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
