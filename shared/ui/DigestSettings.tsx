// The task summary (digest, S-17): each person chooses how often, when, for which
// organizations and what it includes (core 0007: get_digest_preferences, set_digest_preferences).
// DigestFields is controlled, so a page keeps one form and one Save button:
//   const [d, setD] = useState<DigestPrefs | null>(null);
//   useEffect(() => { void loadDigest(client).then(setD) }, [client]);
//   <DigestFields value={d} onChange={setD} />   …   await saveDigest(client, d)
// On a database without core 0007, only the frequency is shown and saved (core 0005).
import type { SupabaseClient } from "@supabase/supabase-js";

export type DigestFrequency = "off" | "daily" | "weekly";
export type DigestPart = "tasks" | "meetings";
export type DigestPrefs = {
  digest: DigestFrequency;
  /** 0 Sunday … 6 Saturday (weekly only). */
  day: number;
  /** 0–23, in timeZone. */
  hour: number;
  timeZone: string;
  /** null = every organization you belong to. */
  orgIds: string[] | null;
  include: DigestPart[];
  /** Your organizations, for the picker. */
  orgs: Array<{ id: string; name: string }>;
  /** False until core 0007 is on this database: only the frequency can be saved. */
  detailed: boolean;
};

export const DIGEST_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function hourLabel(h: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${suffix}`;
}

/** IANA zones for the picker: UTC first, then the browser's list, keeping the current one. */
export function digestTimeZones(current?: string): string[] {
  let zones: string[];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    zones = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  const all = new Set(["UTC", ...[...zones].sort()]);
  if (current) all.add(current);
  return [...all];
}

/** One line saying what the choices mean, for under the fields and in tests. */
export function describeDigest(p: Pick<DigestPrefs, "digest" | "day" | "hour" | "timeZone">) {
  if (p.digest === "off") return "No task summary emails.";
  const at = `${hourLabel(p.hour)} (${p.timeZone.replace(/_/g, " ")})`;
  return p.digest === "daily"
    ? `Every day at about ${at}.`
    : `Every ${DIGEST_DAYS[p.day] ?? "Monday"} at about ${at}.`;
}

type Row = {
  digest: DigestFrequency;
  digest_day: number;
  digest_hour: number;
  digest_time_zone: string;
  digest_org_ids: string[] | null;
  digest_include: DigestPart[];
};

async function myOrgs(client: SupabaseClient): Promise<Array<{ id: string; name: string }>> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return [];
  const { data } = await client
    .schema("public")
    .from("memberships")
    .select("organizations(id, name)")
    .eq("user_id", auth.user.id);
  return ((data ?? []) as unknown as Array<{ organizations: { id: string; name: string } | null }>)
    .map((r) => r.organizations)
    .filter((o): o is { id: string; name: string } => !!o)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadDigest(
  client: SupabaseClient,
  fallbackDigest: DigestFrequency = "weekly",
): Promise<DigestPrefs> {
  const pub = client.schema("public");
  // Only organizations you belong to (a chapter's members can also read its national).
  const [prefs, orgs] = await Promise.all([pub.rpc("get_digest_preferences"), myOrgs(client)]);
  const row = (prefs.data as Row[] | null)?.[0];
  const list = orgs;
  if (prefs.error || !row) {
    return {
      digest: fallbackDigest,
      day: 1,
      hour: 7,
      timeZone: "UTC",
      orgIds: null,
      include: ["tasks", "meetings"],
      orgs: list,
      detailed: false,
    };
  }
  return {
    digest: row.digest,
    day: row.digest_day,
    hour: row.digest_hour,
    timeZone: row.digest_time_zone,
    orgIds: row.digest_org_ids,
    include: row.digest_include,
    orgs: list,
    detailed: true,
  };
}

/** Saves the details (core 0007). Returns an error message, or null. */
export async function saveDigest(client: SupabaseClient, p: DigestPrefs): Promise<string | null> {
  if (!p.detailed) return null; // the frequency went with set_email_preferences
  const { error } = await client.schema("public").rpc("set_digest_preferences", {
    p_digest: p.digest,
    p_day: p.day,
    p_hour: p.hour,
    p_time_zone: p.timeZone,
    p_org_ids: p.orgIds ?? [],
    p_include: p.include,
  });
  return error ? error.message : null;
}

const select =
  "mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60";

export function DigestFields({
  value,
  onChange,
  disabled = false,
  idPrefix = "digest",
}: {
  value: DigestPrefs | null;
  onChange: (next: DigestPrefs) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const v = value;
  const off = !v || v.digest === "off";
  const set = (patch: Partial<DigestPrefs>) => v && onChange({ ...v, ...patch });
  const id = (s: string) => `${idPrefix}-${s}`;
  const toggleInclude = (part: DigestPart, on: boolean) => {
    if (!v) return;
    const next = on ? [...new Set([...v.include, part])] : v.include.filter((x) => x !== part);
    set({ include: next as DigestPart[] });
  };
  const toggleOrg = (orgId: string, on: boolean) => {
    if (!v) return;
    const current = v.orgIds ?? v.orgs.map((o) => o.id);
    const next = on ? [...new Set([...current, orgId])] : current.filter((x) => x !== orgId);
    set({ orgIds: next.length === v.orgs.length ? null : next });
  };
  const noParts = !!v && !off && v.include.length === 0;
  const noOrgs = !!v && !off && v.orgIds !== null && v.orgIds.length === 0;

  return (
    <fieldset className="space-y-3 text-sm" disabled={disabled || !v}>
      <legend className="font-medium">Task summary</legend>
      <p className="text-muted-foreground">
        One email with your open tasks and upcoming meetings from every app you use: action items
        assigned to you in OpenBoardApp, join requests and renewals to handle in OpenCharterApp, and
        recurring transactions due in OpenLedgerApp (for owners, admins and treasurers). If nothing
        is open, no email is sent.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block" htmlFor={id("frequency")}>
          <span className="font-medium">How often</span>
          <select
            id={id("frequency")}
            className={select}
            value={v?.digest ?? "weekly"}
            onChange={(e) => set({ digest: e.target.value as DigestFrequency })}
          >
            <option value="weekly">Weekly</option>
            <option value="daily">Daily</option>
            <option value="off">Off</option>
          </select>
        </label>
        {v?.detailed && v.digest === "weekly" ? (
          <label className="block" htmlFor={id("day")}>
            <span className="font-medium">Day</span>
            <select
              id={id("day")}
              className={select}
              value={v.day}
              onChange={(e) => set({ day: Number(e.target.value) })}
            >
              {DIGEST_DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {v?.detailed && !off ? (
          <>
            <label className="block" htmlFor={id("hour")}>
              <span className="font-medium">Time</span>
              <select
                id={id("hour")}
                className={select}
                value={v.hour}
                onChange={(e) => set({ hour: Number(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block" htmlFor={id("tz")}>
              <span className="font-medium">Time zone</span>
              <select
                id={id("tz")}
                className={select}
                value={v.timeZone}
                onChange={(e) => set({ timeZone: e.target.value })}
              >
                {digestTimeZones(v.timeZone).map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>
      {v?.detailed && !off ? (
        <>
          <div>
            <span className="font-medium">Include</span>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={v.include.includes("tasks")}
                  onChange={(e) => toggleInclude("tasks", e.target.checked)}
                />
                Open tasks
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={v.include.includes("meetings")}
                  onChange={(e) => toggleInclude("meetings", e.target.checked)}
                />
                Upcoming board meetings
              </label>
            </div>
            {noParts ? (
              <p className="mt-1 text-destructive">Choose at least one, or set it to Off.</p>
            ) : null}
          </div>
          {v.orgs.length > 1 ? (
            <div>
              <span className="font-medium">Organizations</span>
              <span className="block text-muted-foreground">
                Every organization you belong to is included unless you clear it here.
              </span>
              <div className="mt-1 space-y-1">
                {v.orgs.map((o) => (
                  <label key={o.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={v.orgIds === null || v.orgIds.includes(o.id)}
                      onChange={(e) => toggleOrg(o.id, e.target.checked)}
                    />
                    {o.name}
                  </label>
                ))}
              </div>
              {noOrgs ? (
                <p className="mt-1 text-destructive">
                  Choose at least one organization, or set it to Off.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      {v ? (
        <p className="text-muted-foreground" aria-live="polite">
          {v.detailed
            ? describeDigest(v)
            : v.digest === "off"
              ? "No task summary emails."
              : `${v.digest === "daily" ? "Every day" : "Every Monday"} in the morning.`}
        </p>
      ) : null}
    </fieldset>
  );
}

/** True when the choices can't be saved yet (nothing included, or no organization chosen). */
export function digestIncomplete(p: DigestPrefs | null): boolean {
  if (!p || !p.detailed || p.digest === "off") return false;
  return p.include.length === 0 || (p.orgIds !== null && p.orgIds.length === 0);
}
