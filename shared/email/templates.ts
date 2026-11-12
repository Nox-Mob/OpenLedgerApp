// The suite's email templates (S-16). Every email the apps queue is rendered here, so
// they share one look: the app's name, a heading, a few lines, one button, and a footer
// that says who sent it and how to switch it off. Plain text goes with every HTML email.
import { APP_NAMES } from "../apps";
import { formatDate } from "../format";
import type { AppId } from "../supabase/hosted";
import type { OutboxRow, RenderContext } from "./types";

export type EmailItem = { text: string; note?: string; href?: string; urgent?: boolean };

export type EmailContent = {
  subject: string;
  heading: string;
  lines: string[];
  /** Label and value rows, e.g. When / Where. */
  details?: Array<[string, string]>;
  /** A short list (the digest's tasks). */
  items?: EmailItem[];
  /** Titled lists, one after the other (the digest: one per organization). */
  sections?: Array<{ heading: string; items: EmailItem[] }>;
  action?: { label: string; href: string };
};

export type RenderedEmail = { subject: string; html: string; text: string };

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

function appUrl(ctx: RenderContext, app: string, path: string): string {
  const base = (ctx.urls[app as AppId] ?? ctx.urls.hub ?? "").replace(/\/+$/, "");
  if (/^https?:\/\//.test(path)) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function when(row: OutboxRow, value: unknown, time = true): string {
  const s = str(value);
  if (!s) return "";
  try {
    return formatDate(s, { time, ...(row.org_time_zone ? { timeZone: row.org_time_zone } : {}) });
  } catch {
    return s;
  }
}

type Template = (row: OutboxRow, ctx: RenderContext) => EmailContent;

const TEMPLATES: Record<string, Template> = {
  // Sent from the email settings to check they work.
  test: (row) => ({
    subject: "Your email settings work",
    heading: "Your email settings work",
    lines: [
      `This test email was sent by ${APP_NAMES[row.app as AppId] ?? "OpenAppHub"}. Reminders and other emails will arrive the same way.`,
    ],
  }),

  // OpenBoardApp (B-09)
  "board.meeting_reminder": (row, ctx) => {
    const d = row.data;
    const days = Number(d["days"] ?? 0);
    const soon = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    return {
      subject: `Board meeting ${soon}: ${str(d["title"])}`,
      heading: `${str(d["title"])} is ${soon}`,
      lines: [`${row.org_name ?? "Your organization"} has a board meeting coming up.`],
      details: [
        [
          "When",
          d["meeting_date"]
            ? [when(row, d["meeting_date"], false), str(d["start_time"])].filter(Boolean).join(", ")
            : when(row, d["starts_at"]),
        ],
        ...(str(d["location"]) ? ([["Where", str(d["location"])]] as Array<[string, string]>) : []),
      ],
      action: {
        label: "Open the meeting",
        href: appUrl(ctx, "board", str(d["link"]) || "/board/meetings"),
      },
    };
  },
  "board.action_item_due": (row, ctx) => {
    const d = row.data;
    const overdue = Boolean(d["overdue"]);
    return {
      subject: overdue
        ? `Overdue: ${str(d["title"])}`
        : `Due ${when(row, d["due_date"], false)}: ${str(d["title"])}`,
      heading: overdue ? "An action item is overdue" : "An action item is due soon",
      lines: [`"${str(d["title"])}" is assigned to you.`],
      details: [
        ["Due", when(row, d["due_date"], false)],
        ...(str(d["meeting_title"])
          ? ([["From", str(d["meeting_title"])]] as Array<[string, string]>)
          : []),
      ],
      action: {
        label: "Open action items",
        href: appUrl(ctx, "board", str(d["link"]) || "/board/tasks"),
      },
    };
  },

  // OpenAppHub task digest (S-17): data.orgs = [{ org_name, tasks: [...], meetings: [...] }]
  // (public.digest_for). Older rows put tasks and meetings at the top level, for row.org_name.
  digest: (row, ctx) => {
    const d = row.data;
    const period = str(d["period"]) === "daily" ? "today" : "this week";
    const list = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
    const orgs = Array.isArray(d["orgs"])
      ? list(d["orgs"])
      : [{ org_name: row.org_name ?? "", tasks: d["tasks"], meetings: d["meetings"] }];
    let taskCount = 0;
    const sections = orgs
      .map((o) => {
        const tasks = list(o["tasks"]);
        taskCount += tasks.length;
        const items: EmailItem[] = [
          ...tasks.map((t) => ({
            text: str(t["title"]),
            note: [
              APP_NAMES[str(t["app"]) as AppId] ?? "",
              t["due_on"] ? `due ${when(row, t["due_on"], false)}` : "",
            ]
              .filter(Boolean)
              .join(" · "),
            href: appUrl(ctx, str(t["app"]) || "hub", str(t["link"]) || "/"),
            urgent: Boolean(t["overdue"]),
          })),
          ...list(o["meetings"]).map((m) => ({
            text: `Meeting: ${str(m["title"])}`,
            note: m["meeting_date"]
              ? [when(row, m["meeting_date"], false), str(m["start_time"])]
                  .filter(Boolean)
                  .join(", ")
              : when(row, m["starts_at"]),
            href: appUrl(ctx, "board", str(m["link"]) || "/board/meetings"),
          })),
        ];
        return { heading: str(o["org_name"]) || "Your organization", items };
      })
      .filter((sec) => sec.items.length > 0);
    const where = sections.length === 1 ? sections[0]!.heading : `${sections.length} organizations`;
    return {
      subject:
        taskCount > 0
          ? `${taskCount} open ${taskCount === 1 ? "task" : "tasks"} ${period}: ${where}`
          : `Coming up ${period}: ${where}`,
      heading: `Your tasks ${period}`,
      lines: sections.length
        ? ["What's open for you, from every app you use. Select an item to open it."]
        : ["Nothing is open for you right now."],
      ...(sections.length === 1 ? { items: sections[0]!.items } : { sections }),
      action: { label: "Open your dashboard", href: appUrl(ctx, "hub", "/") },
    };
  },

  // OpenCharterApp: a chapter asks to use OpenBoardApp
  "charter.chapter_board_request": (row, ctx) => {
    const d = row.data;
    return {
      subject: `${str(d["chapter"])} asks to use OpenBoardApp`,
      heading: `${str(d["chapter"])} asks to use OpenBoardApp`,
      lines: [
        `${str(d["requested_by"]) || "A chapter admin"} asked for ${str(d["chapter"])} to run its board in OpenBoardApp. You can approve or decline it in OpenCharterApp.`,
      ],
      action: { label: "Review the request", href: appUrl(ctx, "charter", str(d["link"]) || "/") },
    };
  },
  "charter.chapter_board_decided": (row, ctx) => {
    const d = row.data;
    const approved = Boolean(d["approved"]);
    return {
      subject: approved
        ? `${str(d["chapter"])} can now use OpenBoardApp`
        : `${str(d["chapter"])}'s request to use OpenBoardApp was declined`,
      heading: approved ? "OpenBoardApp is ready for your chapter" : "Request declined",
      lines: approved
        ? [
            `${row.org_name ?? "Your national"} approved OpenBoardApp for ${str(d["chapter"])}. Your chapter's officers are already on its board.`,
          ]
        : [
            `${row.org_name ?? "Your national"} declined OpenBoardApp for ${str(d["chapter"])}.${str(d["note"]) ? ` Their note: ${str(d["note"])}` : ""}`,
          ],
      ...(approved
        ? {
            action: {
              label: "Open OpenBoardApp",
              href: appUrl(ctx, "board", str(d["link"]) || "/"),
            },
          }
        : {}),
    };
  },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

export function hasTemplate(name: string): boolean {
  return name in TEMPLATES;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ACCENT: Record<string, string> = {
  hub: "#4f46e5",
  charter: "#0f766e",
  board: "#1d4ed8",
  ledger: "#15803d",
};

const REASON: Record<string, string> = {
  essential: "You get this email because of your account.",
  reminders: "You get reminders because you're on this organization's board or have work assigned.",
  digest: "You get this summary because it's switched on in your email choices.",
  billing: "You get billing emails as an owner or billing contact.",
  org_activity: "You get these because you're an owner or admin of this organization.",
};

function itemsHtml(items: EmailItem[]): string {
  const li = items.map((it) => {
    const text = it.href
      ? `<a href="${esc(it.href)}" style="color:#18181b">${esc(it.text)}</a>`
      : esc(it.text);
    const note = it.note
      ? ` <span style="color:${it.urgent ? "#b91c1c" : "#71717a"}">· ${esc(it.note)}${it.urgent ? " (overdue)" : ""}</span>`
      : "";
    return `<li style="margin:0 0 6px">${text}${note}</li>`;
  });
  return `<ul style="margin:4px 0 12px;padding-left:20px;font-size:15px;line-height:1.5">${li.join("")}</ul>`;
}

function itemText(it: EmailItem): string {
  return `- ${it.text}${it.note ? ` (${it.note}${it.urgent ? ", overdue" : ""})` : ""}${it.href ? `\n  ${it.href}` : ""}`;
}

/** Renders an outbox row. Throws for an unknown template (the sender marks it failed). */
export function renderEmail(row: OutboxRow, ctx: RenderContext): RenderedEmail {
  const template = TEMPLATES[row.template];
  if (!template) throw new Error(`Unknown email template "${row.template}"`);
  const c = template(row, ctx);
  const appName = APP_NAMES[row.app as AppId] ?? "OpenAppHub";
  const accent = ACCENT[row.app] ?? "#4f46e5";
  const sentFor = row.org_name ? `Sent by ${appName} for ${row.org_name}.` : `Sent by ${appName}.`;
  const reason = REASON[row.category] ?? "You get this email because of your account.";

  const html: string[] = [];
  html.push(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(c.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7">`,
    `<tr><td style="padding:20px 28px;border-bottom:3px solid ${accent};font-weight:600;font-size:15px;color:${accent}">${esc(appName)}</td></tr>`,
    `<tr><td style="padding:24px 28px 8px"><h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${esc(c.heading)}</h1>`,
  );
  for (const line of c.lines)
    html.push(`<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(line)}</p>`);
  const details = (c.details ?? []).filter(([, v]) => v);
  if (details.length) {
    html.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 12px;font-size:15px">`,
    );
    for (const [k, v] of details)
      html.push(
        `<tr><td style="padding:2px 16px 2px 0;color:#71717a">${esc(k)}</td><td style="padding:2px 0">${esc(v)}</td></tr>`,
      );
    html.push(`</table>`);
  }
  if (c.items?.length) html.push(itemsHtml(c.items));
  for (const sec of c.sections ?? []) {
    html.push(`<h2 style="margin:16px 0 6px;font-size:16px">${esc(sec.heading)}</h2>`);
    html.push(itemsHtml(sec.items));
  }
  if (c.action) {
    html.push(
      `<p style="margin:20px 0 12px"><a href="${esc(c.action.href)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${esc(c.action.label)}</a></p>`,
    );
  }
  html.push(`</td></tr>`);
  const footer = [esc(sentFor), esc(reason)];
  const links = [`<a href="${esc(ctx.preferencesUrl)}" style="color:#71717a">Email choices</a>`];
  if (ctx.unsubscribeUrl)
    links.push(`<a href="${esc(ctx.unsubscribeUrl)}" style="color:#71717a">Unsubscribe</a>`);
  html.push(
    `<tr><td style="padding:16px 28px 22px;border-top:1px solid #e4e4e7;font-size:12px;line-height:1.5;color:#71717a">${footer.join(" ")}<br>${links.join(" · ")}</td></tr>`,
    `</table></td></tr></table></body></html>`,
  );

  const text: string[] = [c.heading, "", ...c.lines];
  if (details.length) text.push("", ...details.map(([k, v]) => `${k}: ${v}`));
  if (c.items?.length) text.push("", ...c.items.map(itemText));
  for (const sec of c.sections ?? []) text.push("", sec.heading, ...sec.items.map(itemText));
  if (c.action) text.push("", `${c.action.label}: ${c.action.href}`);
  text.push("", "--", sentFor, reason, `Email choices: ${ctx.preferencesUrl}`);
  if (ctx.unsubscribeUrl) text.push(`Unsubscribe: ${ctx.unsubscribeUrl}`);

  return { subject: c.subject, html: html.join(""), text: text.join("\n") };
}
