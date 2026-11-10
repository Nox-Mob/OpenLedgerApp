// Which Supabase project server code talks to.
//
// The browser bundle is built for one project (VITE_SUPABASE_URL / _PUBLISHABLE_KEY). A Worker's
// runtime vars and secrets (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY) can
// belong to another: a staging preview built from a branch runs on the production Worker, with
// production's runtime settings. Server code follows the build, and uses the runtime values only
// when they are for the same project (same publishable key), for example a self-hosted server
// that reaches Supabase on an internal address.
export type ServerSupabaseEnv = {
  url: string | undefined;
  publishableKey: string | undefined;
  /** False when the Worker's runtime settings are for a different project than this build. */
  runtimeMatchesBuild: boolean;
};

export function serverSupabaseEnv(
  build: Record<string, string | undefined> = import.meta.env,
  runtime: Record<string, string | undefined> = process.env,
): ServerSupabaseEnv {
  const buildUrl = build["VITE_SUPABASE_URL"] || undefined;
  const buildKey = build["VITE_SUPABASE_PUBLISHABLE_KEY"] || undefined;
  const runtimeUrl = runtime["SUPABASE_URL"] || undefined;
  const runtimeKey = runtime["SUPABASE_PUBLISHABLE_KEY"] || undefined;
  const runtimeMatchesBuild = !buildKey || !runtimeKey || runtimeKey === buildKey;
  if (!runtimeMatchesBuild) return { url: buildUrl, publishableKey: buildKey, runtimeMatchesBuild };
  return {
    url: runtimeUrl ?? buildUrl,
    publishableKey: runtimeKey ?? buildKey,
    runtimeMatchesBuild,
  };
}
