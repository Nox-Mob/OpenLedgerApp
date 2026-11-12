// The automation engine's settings for one organization (S-25, core 0008): every automation the
// installed apps offer, on or off, with its settings, its defaults and what it last did.
// Owners and admins change them; everyone else sees them. Used on the hub's organization
// settings page and in each app's settings.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { APP_NAMES } from "../apps";
import type { AppId } from "../supabase/hosted";

export type ParamSpec = {
  type: "int" | "int_list" | "bool";
  label?: string;
  help?: string;
  unit?: string;
  min?: number;
  max?: number;
  max_items?: number;
};

export type Automation = {
  kind: string;
  app: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  params: Record<string, unknown>;
  is_default: boolean;
  default_enabled: boolean;
  default_params: Record<string, unknown>;
  params_schema: Record<string, ParamSpec>;
  updated_at: string | null;
  last_run_at: string | null;
  last_summary: string | null;
};

/** "7, 1" → [7, 1]; null when it isn't a list of whole numbers. */
export function parseNumberList(text: string): number[] | null {
  const parts = text
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const nums = parts.map(Number);
  return nums.every((n) => Number.isInteger(n)) ? nums : null;
}

/** Plain words for a setting's value, for the summary line. */
export function describeParam(spec: ParamSpec, value: unknown): string {
  if (spec.type === "bool") return value ? "yes" : "no";
  if (spec.type === "int_list" && Array.isArray(value))
    return `${value.join(", ")}${spec.unit ? ` ${spec.unit}` : ""}`;
  return `${String(value)}${spec.unit ? ` ${spec.unit}` : ""}`;
}

const btn =
  "inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50";
const primary =
  "inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50";
const input =
  "mt-1 h-9 w-40 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60";

type Draft = { enabled: boolean; text: Record<string, string>; bools: Record<string, boolean> };

function draftFor(a: Automation): Draft {
  const text: Record<string, string> = {};
  const bools: Record<string, boolean> = {};
  for (const [key, spec] of Object.entries(a.params_schema)) {
    const v = a.params[key];
    if (spec.type === "bool") bools[key] = Boolean(v);
    else text[key] = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
  }
  return { enabled: a.enabled, text, bools };
}

/** The draft as settings to save, or an error message. */
export function paramsFromDraft(
  schema: Record<string, ParamSpec>,
  d: Pick<Draft, "text" | "bools">,
): { params: Record<string, unknown> } | { error: string } {
  const params: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    const label = spec.label ?? key;
    if (spec.type === "bool") {
      params[key] = Boolean(d.bools[key]);
      continue;
    }
    const raw = (d.text[key] ?? "").trim();
    if (spec.type === "int") {
      const n = Number(raw);
      if (!raw || !Number.isInteger(n)) return { error: `${label}: enter a whole number.` };
      if ((spec.min != null && n < spec.min) || (spec.max != null && n > spec.max))
        return { error: `${label}: choose ${spec.min ?? "any"} to ${spec.max ?? "any"}.` };
      params[key] = n;
    } else {
      const list = parseNumberList(raw);
      if (!list) return { error: `${label}: enter whole numbers separated by commas.` };
      const max = spec.max_items ?? 10;
      if (list.length > max) return { error: `${label}: at most ${max}.` };
      if (
        list.some((n) => (spec.min != null && n < spec.min) || (spec.max != null && n > spec.max))
      )
        return { error: `${label}: each from ${spec.min ?? "any"} to ${spec.max ?? "any"}.` };
      params[key] = list;
    }
  }
  return { params };
}

function AutomationCard({
  a,
  canEdit,
  client,
  orgId,
  onSaved,
}: {
  a: Automation;
  canEdit: boolean;
  client: SupabaseClient;
  orgId: string;
  onSaved: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFor(a));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setD(draftFor(a));
    setDirty(false);
  }, [a]);
  const id = (s: string) => `auto-${a.kind.replace(/\W/g, "-")}-${s}`;
  const change = (patch: Partial<Draft>) => {
    setD((cur) => ({ ...cur, ...patch }));
    setDirty(true);
    setMsg(null);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    const out = paramsFromDraft(a.params_schema, d);
    if ("error" in out) return setMsg({ ok: false, text: out.error });
    setBusy(true);
    const { error } = await client.schema("public").rpc("set_automation", {
      p_org: orgId,
      p_kind: a.kind,
      p_enabled: d.enabled,
      p_params: out.params,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "Saved." });
    setDirty(false);
    onSaved();
  }

  async function reset() {
    setBusy(true);
    const { error } = await client
      .schema("public")
      .rpc("reset_automation", { p_org: orgId, p_kind: a.kind });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "Back to the defaults." });
    onSaved();
  }

  const defaults = Object.entries(a.params_schema)
    .map(([k, s]) => `${s.label ?? k}: ${describeParam(s, a.default_params[k])}`)
    .join("; ");

  return (
    <li className="rounded-lg border bg-card p-4">
      <form onSubmit={save} className="space-y-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">{a.name}</h3>
            <p className="text-muted-foreground">{a.description}</p>
          </div>
          <label className="flex items-center gap-2 font-medium" htmlFor={id("on")}>
            <input
              id={id("on")}
              type="checkbox"
              role="switch"
              className="size-4 accent-primary"
              checked={d.enabled}
              disabled={!canEdit || busy}
              onChange={(e) => change({ enabled: e.target.checked })}
            />
            {d.enabled ? "On" : "Off"}
          </label>
        </div>
        {d.enabled ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(a.params_schema).map(([key, spec]) =>
              spec.type === "bool" ? (
                <label key={key} className="flex items-start gap-2 sm:col-span-2">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-primary"
                    checked={d.bools[key] ?? false}
                    disabled={!canEdit || busy}
                    onChange={(e) => change({ bools: { ...d.bools, [key]: e.target.checked } })}
                  />
                  <span>
                    <span className="font-medium">{spec.label ?? key}</span>
                    {spec.help ? (
                      <span className="block text-muted-foreground">{spec.help}</span>
                    ) : null}
                  </span>
                </label>
              ) : (
                <label key={key} className="block" htmlFor={id(key)}>
                  <span className="font-medium">{spec.label ?? key}</span>
                  {spec.help ? (
                    <span className="block text-muted-foreground">{spec.help}</span>
                  ) : null}
                  <span className="flex items-center gap-2">
                    <input
                      id={id(key)}
                      className={input}
                      inputMode={spec.type === "int" ? "numeric" : "text"}
                      value={d.text[key] ?? ""}
                      disabled={!canEdit || busy}
                      onChange={(e) => change({ text: { ...d.text, [key]: e.target.value } })}
                      aria-describedby={id(`${key}-hint`)}
                    />
                    {spec.unit ? <span className="text-muted-foreground">{spec.unit}</span> : null}
                  </span>
                  <span id={id(`${key}-hint`)} className="block text-xs text-muted-foreground">
                    {spec.type === "int_list"
                      ? `Separate with commas, up to ${spec.max_items ?? 10}, each ${spec.min ?? 0} to ${spec.max ?? "any"}.`
                      : `${spec.min ?? 0} to ${spec.max ?? "any"}.`}
                  </span>
                </label>
              ),
            )}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {a.is_default ? "Using the defaults" : "Changed for this organization"}
          {defaults ? ` (defaults: ${a.default_enabled ? "on" : "off"}; ${defaults})` : ""}.{" "}
          {a.last_run_at
            ? `Last did something ${new Date(a.last_run_at).toLocaleString()}: ${a.last_summary}.`
            : "Hasn't done anything yet."}
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={!dirty || busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            {!a.is_default ? (
              <button type="button" className={btn} disabled={busy} onClick={() => void reset()}>
                Use the defaults
              </button>
            ) : null}
          </div>
        ) : null}
        {msg ? (
          <p role="status" className={msg.ok ? "text-foreground" : "text-destructive"}>
            {msg.text}
          </p>
        ) : null}
      </form>
    </li>
  );
}

export function AutomationsPanel({
  client,
  orgId,
  canEdit,
  apps,
}: {
  client: SupabaseClient | null;
  orgId: string | null;
  canEdit: boolean;
  /** Only these apps' automations (each app shows its own; the hub shows all). */
  apps?: AppId[];
}) {
  const [items, setItems] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!client || !orgId) return;
    const { data, error: err } = await client
      .schema("public")
      .rpc("list_automations", { p_org: orgId });
    if (err) {
      // Missing until core 0008 is on this database.
      setError(/list_automations/.test(err.message) ? null : err.message);
      setItems([]);
      return;
    }
    setError(null);
    setItems(((data ?? []) as Automation[]).filter((a) => !apps || apps.includes(a.app as AppId)));
  }, [client, orgId, apps]);
  useEffect(() => {
    void load();
  }, [load]);

  const byApp = new Map<string, Automation[]>();
  for (const a of items ?? []) byApp.set(a.app, [...(byApp.get(a.app) ?? []), a]);

  return (
    <section aria-label="Automations" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Automations are the things the apps do on their own for this organization, like reminder
        emails. Each starts with sensible defaults; {canEdit ? "you" : "owners and admins"} can
        switch one off or change when it runs. More automations will appear here as the apps add
        them.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {items === null ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {items !== null && items.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">No automations here yet.</p>
      ) : null}
      {[...byApp.entries()].map(([app, list]) => (
        <div key={app}>
          {!apps || apps.length > 1 ? (
            <h3 className="mb-2 text-sm font-semibold">{APP_NAMES[app as AppId] ?? app}</h3>
          ) : null}
          <ul className="space-y-3">
            {list.map((a) => (
              <AutomationCard
                key={a.kind}
                a={a}
                canEdit={canEdit}
                client={client!}
                orgId={orgId!}
                onSaved={() => void load()}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
