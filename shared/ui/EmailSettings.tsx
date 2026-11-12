// Email settings for a self-hosted app (S-16):
//   EmailPreferencesPanel  each person's reminders and task-summary choices
//   EmailServerPanel       the instance owner's SMTP server, with a test email
// On OpenAppHub (hosted) email goes through the hub; apps show EmailPreferencesPanel only
// and link to the hub's account page. The server panel's actions are the app's own server
// functions (shared/email/selfhost.ts), passed in.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { EmailSettingsInput, EmailSettingsView } from "../email/selfhost";

const input =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60";
const btn =
  "inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50";
const primary =
  "inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50";
const card = "rounded-lg border bg-card p-5 shadow-sm";

type Msg = { ok: boolean; text: string } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-foreground" : "text-destructive"}`}>
      {msg.text}
    </p>
  );
}

type Digest = "off" | "daily" | "weekly";

export function EmailPreferencesPanel({ client }: { client: SupabaseClient | null }) {
  const [prefs, setPrefs] = useState<{ reminders: boolean; digest: Digest } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    if (!client) return;
    let live = true;
    void client
      .schema("public")
      .rpc("get_email_preferences")
      .then(({ data, error }) => {
        if (!live) return;
        const row = (data as Array<{ reminders: boolean; digest: Digest }> | null)?.[0];
        setPrefs(error || !row ? { reminders: true, digest: "weekly" } : row);
      });
    return () => {
      live = false;
    };
  }, [client]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!client || !prefs) return;
    setBusy(true);
    const { error } = await client
      .schema("public")
      .rpc("set_email_preferences", { p_reminders: prefs.reminders, p_digest: prefs.digest });
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Saved." });
    if (!error) setDirty(false);
  }

  return (
    <section className={card} aria-label="Your email">
      <h2 className="text-base font-semibold">Your email</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        What this app emails you. Account and security emails always arrive.
      </p>
      <form className="mt-4 space-y-4" onSubmit={save}>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-primary"
            checked={prefs?.reminders ?? true}
            disabled={!prefs}
            onChange={(e) => {
              if (prefs) setPrefs({ ...prefs, reminders: e.target.checked });
              setDirty(true);
            }}
          />
          <span>
            <span className="font-medium">Reminders</span>
            <span className="block text-muted-foreground">
              Upcoming meetings and work assigned to you that's due.
            </span>
          </span>
        </label>
        <label className="block text-sm">
          <span className="font-medium">Task summary</span>
          <span className="block text-muted-foreground">Your open tasks in one email.</span>
          <select
            className="mt-2 h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={prefs?.digest ?? "weekly"}
            disabled={!prefs}
            onChange={(e) => {
              if (prefs) setPrefs({ ...prefs, digest: e.target.value as Digest });
              setDirty(true);
            }}
          >
            <option value="weekly">Weekly (Monday morning)</option>
            <option value="daily">Daily</option>
            <option value="off">Off</option>
          </select>
        </label>
        <button type="submit" className={primary} disabled={!dirty || busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
      <Status msg={msg} />
    </section>
  );
}

const SOURCE_TEXT: Record<EmailSettingsView["source"], string> = {
  resend: "Email is sent through Resend (RESEND_API_KEY in the server's settings).",
  "smtp-env": "The mail server is set in the server's settings (SMTP_HOST and the others).",
  "smtp-settings": "Email is sent through the mail server below.",
  none: "No mail server yet: emails wait until one is set up.",
};

export function EmailServerPanel({
  load,
  save,
  test,
}: {
  load: () => Promise<EmailSettingsView>;
  save: (input: EmailSettingsInput) => Promise<void>;
  test: () => Promise<{ ok: boolean; message: string }>;
}) {
  const [view, setView] = useState<EmailSettingsView | null>(null);
  const [form, setForm] = useState<EmailSettingsInput | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  async function refresh() {
    try {
      const v = await load();
      setView(v);
      setForm({
        host: v.host,
        port: v.port,
        security: v.security,
        username: v.username,
        password: "",
        fromAddress: v.fromAddress,
        fromName: v.fromName,
        replyTo: v.replyTo,
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  // Load once (`load` is a server function; a new reference wouldn't mean new data).
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    void refreshRef.current();
  }, []);

  if (!view || !form) {
    return (
      <section className={card} aria-label="Mail server">
        <h2 className="text-base font-semibold">Mail server</h2>
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        <Status msg={msg} />
      </section>
    );
  }

  const fromEnv = view.source === "resend" || view.source === "smtp-env";
  const locked = !view.canEdit || fromEnv;
  const set = (patch: Partial<EmailSettingsInput>) => setForm({ ...form, ...patch });

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy("save");
    setMsg(null);
    try {
      await save({ ...form, password: password || "" });
      setPassword("");
      await refresh();
      setMsg({ ok: true, text: "Saved. Send a test email to check it works." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy("test");
    setMsg(null);
    try {
      const r = await test();
      setMsg({ ok: r.ok, text: r.message });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={card} aria-label="Mail server">
      <h2 className="text-base font-semibold">Mail server</h2>
      <p className="mt-1 text-sm text-muted-foreground">{SOURCE_TEXT[view.source]}</p>
      {!view.serverReady ? (
        <p className="mt-3 text-sm text-destructive">
          Add SUPABASE_SERVICE_ROLE_KEY to the server's secrets first: the server needs it to send
          email.
        </p>
      ) : !view.canEdit ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Only the owner of this server's first organization can change these settings.
        </p>
      ) : null}
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={onSave}>
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">SMTP host</span>
          <input
            className={`${input} mt-1`}
            value={form.host}
            disabled={locked}
            placeholder="smtp.example.org"
            autoComplete="off"
            onChange={(e) => set({ host: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium">Port</span>
          <input
            className={`${input} mt-1`}
            type="number"
            min={1}
            max={65535}
            value={form.port}
            disabled={locked}
            onChange={(e) => set({ port: Number(e.target.value) })}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium">Encryption</span>
          <select
            className={`${input} mt-1`}
            value={form.security}
            disabled={locked}
            onChange={(e) => {
              const security = e.target.value as EmailSettingsInput["security"];
              set({
                security,
                port: security === "tls" ? 465 : form.port === 465 ? 587 : form.port,
              });
            }}
          >
            <option value="starttls">STARTTLS (usually port 587)</option>
            <option value="tls">TLS (usually port 465)</option>
            <option value="none">None (a relay on your own network)</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium">Username</span>
          <input
            className={`${input} mt-1`}
            value={form.username}
            disabled={locked}
            autoComplete="off"
            onChange={(e) => set({ username: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium">Password</span>
          <input
            className={`${input} mt-1`}
            type="password"
            value={password}
            disabled={locked}
            autoComplete="new-password"
            placeholder={view.hasPassword ? "Saved: leave blank to keep it" : ""}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium">From address</span>
          <input
            className={`${input} mt-1`}
            type="email"
            value={form.fromAddress}
            disabled={locked}
            placeholder="board@example.org"
            onChange={(e) => set({ fromAddress: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium">From name</span>
          <input
            className={`${input} mt-1`}
            value={form.fromName}
            disabled={locked}
            placeholder="Lakeview Board"
            onChange={(e) => set({ fromName: e.target.value })}
          />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">Reply-to (optional)</span>
          <input
            className={`${input} mt-1`}
            type="email"
            value={form.replyTo}
            disabled={locked}
            onChange={(e) => set({ replyTo: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          {!fromEnv ? (
            <button type="submit" className={primary} disabled={locked || busy !== null}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          ) : null}
          <button
            type="button"
            className={btn}
            disabled={!view.canEdit || view.source === "none" || busy !== null}
            onClick={() => void onTest()}
          >
            {busy === "test" ? "Sending…" : "Send me a test email"}
          </button>
        </div>
      </form>
      <Status msg={msg} />
    </section>
  );
}
