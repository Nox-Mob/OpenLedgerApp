// Actions from email (core 0014, C-08):
//   ActionLinkPage           /act/<token>: what the link will do, then Confirm (signed in as the
//                            person it was sent to; the action is the app's own function, called
//                            as them, so the app's rules still decide)
//   EmailActionSettingsPanel which kinds of action this organization allows from email
// Both hide what they can't show on a database without core 0014.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { APP_NAMES } from "../apps";
import { suiteUrls, type AppId, type SuiteUrls } from "../supabase/hosted";
import { AlertIcon, CheckIcon } from "./icons";

export type ActionLinkInfo = {
  state: "ready" | "used" | "expired" | "not_allowed" | "other_person" | "unknown";
  label?: string;
  what?: string;
  org_id?: string;
  org_name?: string;
  kind?: string;
  kind_label?: string;
  open_link?: string | null;
  open_app?: string | null;
  expires_at?: string;
  used_at?: string | null;
  rpc?: { schema: string; fn: string; args: Record<string, unknown> };
  comment_arg?: string | null;
};

const SCHEMAS = new Set(["public", "charter", "board", "ledger"]);

/** What to say for a link that can't be used, in plain words. */
export function actionLinkProblem(info: ActionLinkInfo): string | null {
  switch (info.state) {
    case "ready":
      return null;
    case "used":
      return "This link was already used, so there's nothing more to do here.";
    case "expired":
      return "This link has expired (links work for 7 days). Open it in the app instead.";
    case "not_allowed":
      return `${info.org_name ?? "This organization"} doesn't allow this from email any more. Open it in the app instead.`;
    case "other_person":
      return "This link was sent to someone else. Sign in as the person it was sent to, or open the app.";
    default:
      return "This link isn't valid. It may have been copied incompletely.";
  }
}

/** Where "open it in the app" goes: this app's path, or another app of the suite. */
export function openHref(info: ActionLinkInfo, current: AppId, urls: SuiteUrls): string | null {
  const link = info.open_link;
  if (!link || !link.startsWith("/")) return null;
  const app = (info.open_app || "hub") as AppId;
  if (app === current) return link;
  const base = urls[app];
  return base ? `${base}${link}` : null;
}

const card = "w-full max-w-md rounded-xl border bg-card p-6 shadow-sm";
const primary =
  "inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50";
const outline =
  "inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent";

export function ActionLinkPage({
  client,
  token,
  app,
  signInHref,
  urls = suiteUrls(),
}: {
  client: SupabaseClient | null;
  token: string;
  /** This app. */
  app: AppId;
  /** The sign-in page, returning to `next` afterwards. */
  signInHref: (next: string) => string;
  urls?: SuiteUrls;
}) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [info, setInfo] = useState<ActionLinkInfo | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!client) return;
    let live = true;
    void (async () => {
      const { data } = await client.auth.getUser();
      if (!live) return;
      if (!data.user) return setSignedIn(false);
      setSignedIn(true);
      const { data: d, error: e } = await client
        .schema("public")
        .rpc("action_link", { p_token: token });
      if (!live) return;
      if (e) setError(e.message);
      else setInfo(d as ActionLinkInfo);
    })();
    return () => {
      live = false;
    };
  }, [client, token]);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!client || !info?.rpc) return;
    if (!SCHEMAS.has(info.rpc.schema) || !/^[a-z_][a-z0-9_]*$/.test(info.rpc.fn)) {
      setError("This link can't be used here.");
      return;
    }
    setBusy(true);
    setError(null);
    const args: Record<string, unknown> = { ...info.rpc.args };
    if (info.comment_arg) args[info.comment_arg] = comment.trim();
    const { error: e1 } = await client.schema(info.rpc.schema).rpc(info.rpc.fn, args);
    if (e1) {
      setBusy(false);
      setError(e1.message);
      return;
    }
    await client.schema("public").rpc("consume_action_link", { p_token: token });
    setBusy(false);
    setDone(true);
  }

  if (!client) return <p className="text-sm text-muted-foreground">Not available here.</p>;
  if (signedIn === false) {
    const next = typeof window === "undefined" ? `/act/${token}` : window.location.pathname;
    return (
      <div className={card}>
        <h1 className="text-lg font-semibold">Sign in to continue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          For your safety, this link only works signed in as the person it was sent to. Nothing
          happens until you confirm on the next page.
        </p>
        <a href={signInHref(next)} className={`${primary} mt-5 w-full`}>
          Sign in
        </a>
      </div>
    );
  }
  if (error && !info)
    return (
      <div className={card} role="alert">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  if (!info)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading…
      </p>
    );

  const open = openHref(info, app, urls);
  const openLabel = `Open it in ${APP_NAMES[(info.open_app || "hub") as AppId] ?? "the app"}`;
  const problem = actionLinkProblem(info);
  if (done)
    return (
      <div className={card} role="status">
        <p className="inline-flex items-center gap-2 text-lg font-semibold">
          <CheckIcon className="text-success" /> Done
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {info.label}: {info.what}
        </p>
        {open ? (
          <a href={open} className={`${outline} mt-5`}>
            {openLabel}
          </a>
        ) : null}
      </div>
    );
  if (problem)
    return (
      <div className={card}>
        <p className="inline-flex items-center gap-2 text-lg font-semibold">
          <AlertIcon className="text-warning" /> Nothing to do here
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{problem}</p>
        {info.what ? <p className="mt-3 text-sm">{info.what}</p> : null}
        {open ? (
          <a href={open} className={`${outline} mt-5`}>
            {openLabel}
          </a>
        ) : null}
      </div>
    );
  return (
    <form className={card} onSubmit={confirm}>
      <p className="text-xs font-medium text-muted-foreground">{info.org_name}</p>
      <h1 className="mt-1 text-lg font-semibold">{info.what}</h1>
      <p className="mt-3 text-sm">
        Select <strong>{info.label}</strong> to confirm. Nothing has happened yet.
      </p>
      {info.comment_arg ? (
        <div className="mt-4 space-y-1.5">
          <label htmlFor="act-comment" className="text-sm font-medium">
            Comment (optional)
          </label>
          <textarea
            id="act-comment"
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="submit" className={primary} disabled={busy}>
          {busy ? "Working…" : info.label}
        </button>
        {open ? (
          <a href={open} className={outline}>
            {openLabel}
          </a>
        ) : null}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        This link works once and expires{" "}
        {info.expires_at ? new Date(info.expires_at).toLocaleDateString() : "after 7 days"}.
      </p>
    </form>
  );
}

export type EmailActionSetting = {
  kind: string;
  app: string;
  label: string;
  description: string;
  allowed: boolean;
  can_change: boolean;
};

/** Which actions people may take straight from an email, for one organization. */
export function EmailActionSettingsPanel({
  client,
  orgId,
}: {
  client: SupabaseClient | null;
  orgId: string;
}) {
  const [rows, setRows] = useState<EmailActionSetting[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const { data, error: e } = await client
      .schema("public")
      .rpc("email_action_settings", { p_org: orgId });
    if (e) {
      if (e.code === "PGRST202" || e.code === "42883") setMissing(true);
      else setError(e.message);
      return;
    }
    setRows((data as EmailActionSetting[] | null) ?? []);
  }, [client, orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(r: EmailActionSetting, allowed: boolean) {
    if (!client) return;
    setError(null);
    setRows((xs) => xs?.map((x) => (x.kind === r.kind ? { ...x, allowed } : x)) ?? xs);
    const { error: e } = await client
      .schema("public")
      .rpc("set_email_action_allowed", { p_org: orgId, p_kind: r.kind, p_allowed: allowed });
    if (e) {
      setError(e.message);
      void load();
    }
  }

  if (missing) return null;
  if (!rows) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Emails always say what's waiting (for example "An award submission is pending your
        approval"). When a kind is allowed here, the email also has buttons to do it, such as
        Approve, Decline or Mark it done. Each button works once, for 7 days, only signed in as the
        person it was sent to, and asks them to confirm first. The person's usual permissions still
        apply.
      </p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.kind} className="flex items-start gap-3">
            <input
              id={`ea-${r.kind}`}
              type="checkbox"
              className="mt-1 size-4 accent-primary"
              checked={r.allowed}
              disabled={!r.can_change}
              onChange={(e) => void toggle(r, e.target.checked)}
            />
            <label htmlFor={`ea-${r.kind}`} className="text-sm">
              <span className="font-medium">{r.label}</span>
              {r.app !== "hub" && r.app in APP_NAMES ? (
                <span className="text-muted-foreground"> · {APP_NAMES[r.app as AppId]}</span>
              ) : null}
              <span className="block text-muted-foreground">{r.description}</span>
            </label>
          </li>
        ))}
      </ul>
      {rows.length && !rows[0]!.can_change ? (
        <p className="text-xs text-muted-foreground">Owners and admins change these.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
