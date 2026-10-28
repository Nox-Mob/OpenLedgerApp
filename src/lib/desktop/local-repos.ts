import type { Repositories } from "@/lib/ports";

let pending: Promise<Repositories> | null = null;

/** Opens the local SQLite file once per app run (desktop only). */
export function localRepos(): Promise<Repositories> {
  pending ??= (async () => {
    const [{ default: Database }, sqlite] = await Promise.all([
      import("@tauri-apps/plugin-sql"),
      import("@/lib/adapters/sqlite"),
    ]);
    const url = "sqlite:openledgerapp.db";
    await Database.load(url);
    // Swap the plugin's multi-connection pool for one connection, so BEGIN/COMMIT wrap
    // every statement in between (see src-tauri/src/lib.rs). Without it a "transaction"
    // is not atomic and COMMIT/ROLLBACK fail with "no transaction is active".
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("use_single_connection", { db: url });
    const raw = await Database.load(url).catch(() => null);
    const driver = {
      execute: (sql: string, p?: unknown[]) => raw.execute(sql, p),
      select: <T>(sql: string, p?: unknown[]) => raw.select<T[]>(sql, p),
    };
    await sqlite.migrateSqlite(driver as never);
    return sqlite.createSqliteRepositories(driver as never);
  })();
  return pending;
}
