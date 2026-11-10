// The migration safety check must catch top-level data loss but allow the same words
// inside function bodies, which only run when called.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/ci/check-migrations.mjs");

function run(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  mkdirSync(join(dir, "db/migrations"), { recursive: true });
  for (const [n, sql] of Object.entries(files)) writeFileSync(join(dir, "db/migrations", n), sql);
  try {
    return { ok: true, out: execFileSync("node", [SCRIPT], { cwd: dir, encoding: "utf8" }) };
  } catch (e: any) {
    return { ok: false, out: String(e.stdout) + String(e.stderr) };
  }
}

const fn = (body: string) =>
  `CREATE FUNCTION ledger.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN ${body} END; $$;`;

describe("check-migrations", () => {
  it("passes a function whose body deletes rows", () => {
    expect(run({ "0001_f.sql": fn("DELETE FROM public.x WHERE id = 1;") }).ok).toBe(true);
  });
  it("passes a named dollar-quoted body", () => {
    const sql =
      "CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN DELETE FROM x; END $fn$ LANGUAGE plpgsql;";
    expect(run({ "0001_f.sql": sql }).ok).toBe(true);
  });
  it("fails a top-level DELETE FROM", () => {
    const r = run({ "0001_d.sql": "DELETE FROM public.accounts;" });
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/data-destroying/);
  });
  it("fails a top-level DELETE after a function body", () => {
    const r = run({ "0001_d.sql": fn("SELECT 1;") + "\nDELETE FROM public.accounts;" });
    expect(r.ok).toBe(false);
  });
  it("fails TRUNCATE and DROP TABLE", () => {
    expect(run({ "0001_t.sql": "TRUNCATE public.accounts;" }).ok).toBe(false);
    expect(run({ "0001_t.sql": "DROP TABLE public.accounts;" }).ok).toBe(false);
  });
  it("ignores destructive words in comments", () => {
    expect(run({ "0001_c.sql": "-- DELETE FROM accounts\nSELECT 1;" }).ok).toBe(true);
  });
  it("fails a table without GRANTs and a bad file name", () => {
    const t = "CREATE TABLE ledger.t (id uuid); ALTER TABLE ledger.t ENABLE ROW LEVEL SECURITY;";
    expect(run({ "0001_t.sql": t }).out).toMatch(/GRANT/);
    expect(run({ "bad.sql": "SELECT 1;" }).out).toMatch(/name must look like/);
  });
  it("fails a table outside schema ledger and a gap in the numbering", () => {
    const t = "CREATE TABLE public.t (id uuid); GRANT SELECT ON public.t TO authenticated;";
    expect(run({ "0001_t.sql": t }).out).toMatch(/schema ledger/);
    expect(run({ "0002_x.sql": "SELECT 1;" }).out).toMatch(/expected number 0001/);
  });
  it("accepts grants listed for several tables and the RLS catalog loop", () => {
    const sql = `CREATE TABLE ledger.a (id uuid); CREATE TABLE ledger.b (id uuid);
      DO $$ DECLARE t text; BEGIN
        for t in select tablename from pg_tables where schemaname = 'ledger' loop
          execute format('alter table ledger.%I enable row level security', t);
        end loop; END $$;
      GRANT SELECT ON ledger.a, ledger.b TO authenticated;`;
    expect(run({ "0001_ab.sql": sql }).ok).toBe(true);
  });
});
