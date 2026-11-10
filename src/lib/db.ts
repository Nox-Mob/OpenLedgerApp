// The typed backend client used by server functions and helpers.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Db = SupabaseClient<Database, "ledger">;

/** For code that walks many tables by name (backups, restore); rows are plain records. */
export type UntypedDb = Pick<SupabaseClient, "from">;
export type PlainRow = Record<string, unknown>;
