// Server-only restore: a verified backup -> the organization you're in, while its books are
// empty (0017). The server checks the file and gives every row a new id; the database writes
// everything in one step (ledger.restore_into), as the signed-in owner or admin, so if anything
// fails nothing is kept. No service-role key (SHARED-SPEC §7.2).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UntypedDb } from "./db";
import { newId } from "./domain/ledger";
import { checkRestorable, remapTables, type VerifiedBackup } from "./domain/backup";

export async function restoreIntoOrg(
  db: UntypedDb,
  orgId: string,
  verified: VerifiedBackup,
): Promise<{ orgId: string; name: string }> {
  const { backup, sameInstall, installFingerprint } = verified;
  const { tables } = remapTables(backup.tables, newId);
  checkRestorable(tables); // bookkeeping rules before anything is sent
  const { data: org, error: orgError } = await (db as unknown as SupabaseClient)
    .schema("public")
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  if (orgError || !org) throw new Error("This organization wasn't found.");
  const { error } = await (db as unknown as SupabaseClient).rpc("restore_into", {
    p_org: orgId,
    p_tables: { ...tables, organization: backup.organization },
    p_meta: {
      source: sameInstall ? "this install" : "another install",
      install_fingerprint: installFingerprint,
      original_org_id: backup.manifest.orgId,
      original_name: backup.manifest.orgName,
      exported_at: backup.manifest.exportedAt,
      counts: verified.counts,
      members_not_restored: (backup.tables["user_roles"] ?? backup.tables["member_roles"] ?? [])
        .length,
    },
  });
  if (error) throw new Error(error.message);
  return { orgId, name: String((org as { name: string }).name) };
}
