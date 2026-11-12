// OpenBoardApp's integration surface for the other apps (S-13): upcoming meetings to choose from,
// and adding a report (PDF) to one of them. Board's contract: board.api_meetings and
// board.add_report_to_meeting (OpenBoardApp docs/INTEGRATION.md).
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissing } from "./detect";

export type BoardMeeting = { id: string; title: string; meeting_date: string };
export type SourceApp = "charter" | "ledger" | "board";

/** Meetings not yet held, soonest first; null when OpenBoardApp isn't on this database. */
export async function upcomingBoardMeetings(
  client: SupabaseClient,
  orgId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<BoardMeeting[] | null> {
  const { data, error } = await client
    .schema("board")
    .from("api_meetings")
    .select("id, title, meeting_date")
    .eq("org_id", orgId)
    .in("status", ["scheduled", "in_progress"])
    .gte("meeting_date", today)
    .order("meeting_date")
    .limit(20);
  if (error) {
    if (isMissing(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? []) as BoardMeeting[];
}

/** Adds the PDF to the meeting's documents (ready for its packet). Returns the Board document id. */
export async function addReportToBoardMeeting(
  client: SupabaseClient,
  p: { meetingId: string; title: string; fileName: string; pdf: Blob; sourceApp: SourceApp },
): Promise<string> {
  const { data, error } = await client.schema("board").rpc("add_report_to_meeting", {
    p_meeting: p.meetingId,
    p_title: p.title,
    p_file_name: p.fileName,
    p_source_app: p.sourceApp,
  });
  if (error) {
    if (/row-level security|permission denied/i.test(error.message))
      throw new Error(
        "Only people who can edit OpenBoardApp's records (owner, admin, chair or secretary) can add reports to a meeting.",
      );
    throw new Error(error.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    document_id: string;
    storage_path: string;
  };
  const up = await client.storage
    .from("board-files")
    .upload(row.storage_path, p.pdf, { contentType: "application/pdf", upsert: false });
  if (up.error) throw new Error(up.error.message);
  return row.document_id;
}
