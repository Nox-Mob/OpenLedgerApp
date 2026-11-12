// /email/unsubscribe: the link at the bottom of every email that can be switched off, and
// the one-click unsubscribe mail apps do with List-Unsubscribe-Post (RFC 8058).
// The link is signed (secret.ts), so it only works for the person it was sent to.
// Server-only: it uses the service role client.
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyUnsubscribe } from "./secret";

const NAMES: Record<string, string> = {
  reminders: "reminders",
  digest: "the task summary",
  billing: "billing emails",
  org_activity: "organization activity emails",
};

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#18181b;line-height:1.5"><h1 style="font-size:22px">${title}</h1>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleUnsubscribe(
  request: Request,
  opts: { admin: SupabaseClient | null; secret: string; preferencesUrl: string },
): Promise<Response> {
  const url = new URL(request.url);
  const user = url.searchParams.get("u") ?? "";
  const category = url.searchParams.get("c") ?? "";
  const sig = url.searchParams.get("s") ?? "";
  const label = NAMES[category];
  const prefs = `<p><a href="${opts.preferencesUrl}">Change your email choices</a></p>`;
  if (
    !label ||
    !/^[0-9a-f-]{36}$/i.test(user) ||
    !(await verifyUnsubscribe(opts.secret, user, category, sig))
  ) {
    return page(
      "This link doesn't work",
      `<p>It may be incomplete or out of date.</p>${prefs}`,
      400,
    );
  }
  // A GET only shows the button: link scanners in mail systems must not unsubscribe people.
  if (request.method !== "POST") {
    return page(
      `Unsubscribe from ${label}?`,
      `<form method="post"><button type="submit" style="font-size:16px;padding:10px 18px;border-radius:8px;border:0;background:#18181b;color:#fff;cursor:pointer">Unsubscribe</button></form>${prefs}`,
    );
  }
  if (!opts.admin) return page("Something went wrong", "<p>Please try again later.</p>", 503);
  const { error } = await opts.admin.rpc("email_unsubscribe", {
    p_user: user,
    p_category: category,
  });
  if (error) return page("Something went wrong", `<p>Please try again later.</p>${prefs}`, 500);
  return page(
    "You're unsubscribed",
    `<p>You won't get ${label} any more. Account and security emails still arrive.</p>${prefs}`,
  );
}
