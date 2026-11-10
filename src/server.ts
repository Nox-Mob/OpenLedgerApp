import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { isAbort } from "./lib/abort";
import { withSecurityHeaders } from "./lib/security-headers";

const cancelled = () => new Response(null, { status: 499 });

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  if (request.signal?.aborted) return cancelled();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const captured = consumeLastCapturedError();
  if (isAbort(captured)) return cancelled();
  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Security headers on every production response (docs/SHARED-SPEC.md §10.1). Skipped in
// `vite dev`, where the CSP and frame rules would block hot reload and editor previews.
function secure(response: Response): Response {
  if (import.meta.env.DEV) return response;
  const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"];
  return withSecurityHeaders(response, supabaseUrl);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    return secure(await handle(request, env, ctx));
  },
};

async function handle(request: Request, env: unknown, ctx: unknown): Promise<Response> {
  try {
    const handler = await getServerEntry();
    const response = await handler.fetch(request, env, ctx);
    return await normalizeCatastrophicSsrResponse(response, request);
  } catch (error) {
    if (isAbort(error) || request.signal?.aborted) return cancelled();
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
