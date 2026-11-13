// Notifications (core 0013, H-02): things that happened, told to the people they matter to.
//   NotificationBell      the bell in every app's top bar: unread count and the latest list
//   NotificationSettings  each person's choice per kind: in the app, by email, or neither
// Both read the database directly (my_notifications, notification_settings…) and hide
// themselves on a database without core 0013. They don't go through the automation engine.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { APP_NAMES } from "../apps";
import { suiteUrls, type AppId, type SuiteUrls } from "../supabase/hosted";
import { Dropdown } from "./Dropdown";
import { BellIcon } from "./icons";
import { PlainLink, type LinkLike } from "./link";

export type NotificationItem = {
  id: number;
  org_id: string | null;
  org_name: string | null;
  kind: string;
  kind_label: string;
  title: string;
  body: string;
  link: string | null;
  link_app: string | null;
  created_at: string;
  read_at: string | null;
};

export type NotificationSetting = {
  kind: string;
  app: string;
  label: string;
  description: string;
  audience: string;
  email_category: string;
  in_app: boolean;
  email: boolean;
  customized: boolean;
  by_default: boolean;
  default_in_app: boolean;
  default_email: boolean;
  may_turn_on: boolean;
};

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 7) return d === 1 ? "yesterday" : `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Where a notification leads: inside this app, a path for the router; in another app of the
 * suite, a full address; null when that app isn't known here (self-hosted alone).
 */
export function notificationHref(
  n: Pick<NotificationItem, "link" | "link_app">,
  current: AppId,
  urls: SuiteUrls,
): { href: string; external: boolean } | null {
  if (!n.link || !n.link.startsWith("/")) return null;
  const app = (n.link_app || "hub") as AppId;
  if (app === current) return { href: n.link, external: false };
  const base = urls[app];
  return base ? { href: `${base}${n.link}`, external: true } : null;
}

const POLL_MS = 60_000;

export function NotificationBell({
  client,
  app,
  settingsHref,
  LinkComponent = PlainLink,
  urls = suiteUrls(),
}: {
  client: SupabaseClient | null;
  app: AppId;
  /** Where each person chooses what they get (the hub's account page, hosted). */
  settingsHref?: string | undefined;
  LinkComponent?: LinkLike;
  urls?: SuiteUrls;
}) {
  // Shown once the database answers (also keeps the server render and the first client render the same).
  const [available, setAvailable] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  const count = useCallback(async () => {
    if (!client) return;
    const { data, error } = await client.schema("public").rpc("unread_notification_count");
    if (error) {
      // No core 0013 on this database (PGRST202) or not signed in: no bell.
      if (error.code === "PGRST202" || error.code === "42883") setAvailable(false);
      return;
    }
    setAvailable(true);
    setUnread(typeof data === "number" ? data : 0);
  }, [client]);

  useEffect(() => {
    if (!client) return;
    void count();
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void count();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [client, count]);

  const load = async () => {
    if (!client) return;
    const { data } = await client.schema("public").rpc("my_notifications", { p_limit: 20 });
    setItems((data as NotificationItem[] | null) ?? []);
  };

  const markAll = async () => {
    if (!client) return;
    await client.schema("public").rpc("mark_notifications_read", { p_ids: null });
    setUnread(0);
    setItems(
      (xs) => xs?.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })) ?? xs,
    );
  };

  const markOne = async (id: number) => {
    if (!client) return;
    await client.schema("public").rpc("mark_notifications_read", { p_ids: [id] });
    setItems(
      (xs) => xs?.map((x) => (x.id === id ? { ...x, read_at: new Date().toISOString() } : x)) ?? xs,
    );
    setUnread((u) => Math.max(0, u - 1));
  };

  if (!client || !available) return null;
  const label = unread > 0 ? `Notifications (${unread} unread)` : "Notifications";
  return (
    <Dropdown
      label={label}
      align="end"
      onOpenChange={(open) => {
        if (open) void load();
      }}
      triggerClassName="relative grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      trigger={
        <span className="grid place-items-center">
          <BellIcon />
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-destructive-foreground"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </span>
      }
    >
      {(close) => (
        <div className="w-80 max-w-[calc(100vw-2rem)]">
          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void markAll()}
                className="text-xs font-medium text-primary hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto border-t">
            {items === null ? (
              <p className="px-2.5 py-4 text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-2.5 py-4 text-sm text-muted-foreground">
                Nothing yet. When something happens that matters to you, it shows here.
              </p>
            ) : (
              <ul>
                {items.map((n) => {
                  const to = notificationHref(n, app, urls);
                  const body = (
                    <>
                      <span className="flex items-start gap-2">
                        {!n.read_at ? (
                          <span
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                            aria-label="Unread"
                          />
                        ) : (
                          <span className="mt-1.5 size-2 shrink-0" aria-hidden="true" />
                        )}
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{n.title}</span>
                          {n.body ? (
                            <span className="line-clamp-2 block text-xs text-muted-foreground">
                              {n.body}
                            </span>
                          ) : null}
                          <span className="block text-xs text-muted-foreground">
                            {[n.org_name, timeAgo(n.created_at)].filter(Boolean).join(" · ")}
                            {to?.external && n.link_app && n.link_app in APP_NAMES
                              ? ` · in ${APP_NAMES[n.link_app as AppId]}`
                              : ""}
                          </span>
                        </span>
                      </span>
                    </>
                  );
                  const cls = "block w-full px-2.5 py-2 text-left hover:bg-accent";
                  const onOpen = () => {
                    if (!n.read_at) void markOne(n.id);
                    close();
                  };
                  return (
                    <li key={n.id} className="border-b last:border-b-0">
                      {to && !to.external ? (
                        <LinkComponent href={to.href} className={cls} onClick={onOpen}>
                          {body}
                        </LinkComponent>
                      ) : to ? (
                        <a href={to.href} className={cls} onClick={onOpen}>
                          {body}
                        </a>
                      ) : (
                        <button
                          type="button"
                          className={cls}
                          onClick={() => !n.read_at && void markOne(n.id)}
                        >
                          {body}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {settingsHref ? (
            <div className="border-t px-2.5 py-2">
              {/^https?:/.test(settingsHref) ? (
                <a href={settingsHref} className="text-xs font-medium text-primary hover:underline">
                  Choose what you get
                </a>
              ) : (
                <LinkComponent
                  href={settingsHref}
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={close}
                >
                  Choose what you get
                </LinkComponent>
              )}
            </div>
          ) : null}
        </div>
      )}
    </Dropdown>
  );
}

const APP_GROUP: Record<string, string> = {
  hub: "OpenAppHub",
  charter: "OpenCharterApp",
  board: "OpenBoardApp",
  ledger: "OpenLedgerApp",
};

export function NotificationSettings({ client }: { client: SupabaseClient | null }) {
  const [rows, setRows] = useState<NotificationSetting[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const { data, error: e } = await client.schema("public").rpc("notification_settings");
    if (e) {
      if (e.code === "PGRST202" || e.code === "42883") setMissing(true);
      else setError(e.message);
      return;
    }
    setRows((data as NotificationSetting[] | null) ?? []);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (r: NotificationSetting, inApp: boolean, email: boolean) => {
    if (!client) return;
    setError(null);
    setRows(
      (xs) =>
        xs?.map((x) =>
          x.kind === r.kind ? { ...x, in_app: inApp, email, customized: true } : x,
        ) ?? xs,
    );
    const { error: e } = await client.schema("public").rpc("set_notification_preference", {
      p_kind: r.kind,
      p_in_app: inApp,
      p_email: email,
    });
    if (e) {
      setError(e.message);
      void load();
    }
  };

  const reset = async (r: NotificationSetting) => {
    if (!client) return;
    await client.schema("public").rpc("reset_notification_preference", { p_kind: r.kind });
    void load();
  };

  if (missing) return null;
  if (!rows) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">No notifications apply to you yet.</p>;

  const groups = [...new Set(rows.map((r) => r.app))];
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g}>
          {groups.length > 1 ? (
            <h3 className="mb-2 text-sm font-semibold">{APP_GROUP[g] ?? g}</h3>
          ) : null}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Notification</th>
                <th className="w-20 py-1 text-center font-medium">In the app</th>
                <th className="w-20 py-1 text-center font-medium">Email</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.app === g)
                .map((r) => (
                  <tr key={r.kind} className="border-t align-top">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.by_default
                          ? `Sent to: ${r.audience.toLowerCase()}.`
                          : `Sent to ${r.audience.toLowerCase()}. You can turn it on for yourself.`}
                        {r.customized ? (
                          <>
                            {" "}
                            <button
                              type="button"
                              onClick={() => void reset(r)}
                              className="font-medium text-primary hover:underline"
                            >
                              Use the defaults
                            </button>
                          </>
                        ) : null}
                      </p>
                    </td>
                    <td className="py-2 text-center">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={r.in_app}
                        aria-label={`${r.label}: in the app`}
                        onChange={(e) => void save(r, e.target.checked, r.email)}
                      />
                    </td>
                    <td className="py-2 text-center">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={r.email}
                        aria-label={`${r.label}: by email`}
                        onChange={(e) => void save(r, r.in_app, e.target.checked)}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Emails about your account, sign-in and the terms are always sent. Billing emails go to the
        billing contact too, whatever is chosen here.
      </p>
    </div>
  );
}
