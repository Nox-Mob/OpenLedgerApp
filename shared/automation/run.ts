// The automation engine's app actions (S-25): queued in public.automation_jobs by a workflow, and
// carried out by the app that owns them. Hosted, the hub's scheduler asks each app to run its
// jobs (POST /automation/run, signed); self-hosted, the app's own cron runs them.
// The signature uses a key derived from the service role key both Workers already hold, so no
// new secret is needed. Server-only.
import type { SupabaseClient } from "@supabase/supabase-js";

export const AUTOMATION_RUN_PATH = "/automation/run";
const enc = new TextEncoder();

async function key(serviceKey: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(serviceKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign(
    "HMAC",
    base,
    enc.encode("openapphub:automation-run:v1"),
  );
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Headers for a request asking `app` to run its jobs. */
export async function signRun(
  serviceKey: string,
  app: string,
  now = Date.now(),
): Promise<Record<string, string>> {
  const ts = String(Math.floor(now / 1000));
  const sig = hex(
    await crypto.subtle.sign("HMAC", await key(serviceKey), enc.encode(`${ts}.${app}`)),
  );
  return { "x-oah-app": app, "x-oah-ts": ts, "x-oah-sig": sig };
}

/** True when the request was signed for `app` within the last five minutes. */
export async function verifyRun(
  serviceKey: string,
  app: string,
  headers: Headers,
  now = Date.now(),
): Promise<boolean> {
  const ts = headers.get("x-oah-ts") ?? "";
  const sig = headers.get("x-oah-sig") ?? "";
  if (
    !serviceKey ||
    headers.get("x-oah-app") !== app ||
    !/^\d+$/.test(ts) ||
    !/^[0-9a-f]{64}$/.test(sig)
  )
    return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const bytes = new Uint8Array(sig.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", await key(serviceKey), bytes, enc.encode(`${ts}.${app}`));
}

export type AutomationJob = {
  id: number;
  org_id: string;
  run_id: number | null;
  app: string;
  kind: string;
  payload: Record<string, unknown> & { ctx?: Record<string, unknown> };
  attempts: number;
};

export type JobHandler = (
  job: AutomationJob,
) => Promise<{ summary: string } & Record<string, unknown>>;

/** Claims this app's queued jobs and runs each with its handler; records how each went. */
export async function runAutomationJobs(
  admin: SupabaseClient,
  app: string,
  handlers: Record<string, JobHandler>,
  limit = 5,
): Promise<{ done: number; failed: number }> {
  const pub = admin.schema("public");
  const { data, error } = await pub.rpc("claim_automation_jobs", { p_app: app, p_limit: limit });
  if (error) {
    // Missing until core 0009 is applied.
    if (/claim_automation_jobs/.test(error.message)) return { done: 0, failed: 0 };
    throw new Error(error.message);
  }
  let done = 0;
  let failed = 0;
  for (const job of (data ?? []) as AutomationJob[]) {
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`This app can't do "${job.kind}".`);
      const result = await handler(job);
      await pub.rpc("finish_automation_job", {
        p_id: job.id,
        p_ok: true,
        p_result: result,
        p_error: null,
      });
      done++;
    } catch (e) {
      await pub.rpc("finish_automation_job", {
        p_id: job.id,
        p_ok: false,
        p_result: null,
        p_error: e instanceof Error ? e.message : String(e),
      });
      failed++;
    }
  }
  return { done, failed };
}

/** Hosted: asks every app with queued jobs to run them (the hub's scheduler). */
export async function pokeApps(
  admin: SupabaseClient,
  urls: Partial<Record<string, string>>,
  serviceKey: string,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const { data, error } = await admin
    .schema("public")
    .from("automation_jobs")
    .select("app")
    .in("status", ["queued", "running"])
    .limit(200);
  if (error) return [];
  const apps = [...new Set(((data ?? []) as { app: string }[]).map((r) => r.app))].filter(
    (a) => a !== "hub" && urls[a],
  );
  for (const app of apps) {
    const base = urls[app]!.replace(/\/+$/, "");
    await fetcher(`${base}${AUTOMATION_RUN_PATH}`, {
      method: "POST",
      headers: await signRun(serviceKey, app),
    }).catch(() => undefined);
  }
  return apps;
}
