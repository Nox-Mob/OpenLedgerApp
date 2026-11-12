// "Add to a board package" (S-13): puts a report from any app into an upcoming OpenBoardApp
// meeting, where it's listed in the meeting's Packet tab. Hidden when OpenBoardApp isn't on this
// database. `makePdf` builds the report only when the person confirms.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { formatDate } from "../format";
import {
  addReportToBoardMeeting,
  upcomingBoardMeetings,
  type BoardMeeting,
  type SourceApp,
} from "../integrations/board";

export function AddToBoardPackage({
  client,
  orgId,
  sourceApp,
  makePdf,
  boardUrl,
  className = "",
}: {
  client: SupabaseClient | null;
  orgId: string;
  sourceApp: SourceApp;
  makePdf: () => Promise<{ pdf: Blob; fileName: string; title: string }>;
  /** OpenBoardApp's address, for the link to the meeting; omitted, no link. */
  boardUrl?: string | undefined;
  className?: string;
}) {
  const [meetings, setMeetings] = useState<BoardMeeting[] | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [meetingId, setMeetingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; href?: string } | null>(null);

  useEffect(() => {
    if (!client) return setMeetings(null);
    let live = true;
    upcomingBoardMeetings(client, orgId)
      .then((m) => live && setMeetings(m))
      .catch(() => live && setMeetings(null));
    return () => {
      live = false;
    };
  }, [client, orgId]);

  if (!client || !meetings) return null; // loading, error, or no OpenBoardApp here

  async function add() {
    if (!client || !meetingId) return;
    setBusy(true);
    setMessage(null);
    try {
      const report = await makePdf();
      await addReportToBoardMeeting(client, { meetingId, sourceApp, ...report });
      const m = meetings?.find((x) => x.id === meetingId);
      setMessage({
        ok: true,
        text: `Added to ${m?.title ?? "the meeting"}. Include it in the packet from the meeting's Packet tab.`,
        ...(boardUrl
          ? { href: `${boardUrl.replace(/\/+$/, "")}/board/meetings/${meetingId}?org=${orgId}` }
          : {}),
      });
      setOpen(false);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50";
  return (
    <div className={`text-sm ${className}`}>
      {!open ? (
        <button type="button" className={btn} onClick={() => setOpen(true)}>
          Add to a board package
        </button>
      ) : meetings.length === 0 ? (
        <p className="text-muted-foreground">
          No upcoming meetings in OpenBoardApp. Schedule one there first.{" "}
          <button type="button" className="underline" onClick={() => setOpen(false)}>
            Close
          </button>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="board-package-meeting">
            Meeting
          </label>
          <select
            id="board-package-meeting"
            className="h-9 rounded-md border border-input bg-background px-2"
            value={meetingId}
            onChange={(e) => setMeetingId(e.target.value)}
          >
            <option value="">Choose a meeting…</option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}, {formatDate(m.meeting_date)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btn}
            disabled={!meetingId || busy}
            onClick={() => void add()}
          >
            {busy ? "Adding…" : "Add"}
          </button>
          <button type="button" className="underline" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}
      {message ? (
        <p role="status" className={`mt-2 ${message.ok ? "text-foreground" : "text-destructive"}`}>
          {message.text}{" "}
          {message.href ? (
            <a href={message.href} className="underline">
              Open the meeting
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
