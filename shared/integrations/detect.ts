// Cross-app data (SHARED-SPEC §3.6, S-12): apps read each other only through read-only `api_*`
// views and change each other only through `security invoker` RPCs, both documented in the owning
// app's docs/INTEGRATION.md. A consumer always feature-detects: on a database without the other app
// (self-hosted alone, or before its migration), the view, RPC or schema is missing, and the
// integration is simply hidden.

export type DbError = { code?: string; message?: string } | null | undefined;

/** True when the error means "that app (or that view/RPC) isn't on this database". */
export function isMissing(error: DbError): boolean {
  if (!error) return false;
  return (
    ["42P01", "42883", "PGRST202", "PGRST205", "PGRST106"].includes(error.code ?? "") ||
    /does not exist|could not find the function|schema must be one of/i.test(error.message ?? "")
  );
}
