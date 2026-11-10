// Shape and error mapping for the audited_write client helper.
// The RPC itself is checked end-to-end against the live database in
// db/tests/20_audited_write.sql.
import { describe, expect, it } from "vitest";
import { auditedWrite, toAuditJson, toOpJson } from "./audited-write";
import { DuplicateKeyError } from "./ports";

describe("audited-write helpers", () => {
  it("builds op JSON with only the fields the caller set", () => {
    const op = toOpJson({ table: "funds", op: "insert", values: { id: "x" } });
    expect(op).toEqual({ table: "funds", op: "insert", values: { id: "x" } });
    expect(
      toOpJson({ table: "funds", op: "update", values: { a: 1 }, match: { id: "x" } }),
    ).toHaveProperty("match", { id: "x" });
    expect(
      toOpJson({
        table: "entries",
        op: "update",
        values: { reconciliation_id: null },
        in: { id: ["a", "b"] },
        minRows: 1,
        minRowsMessage: "nope",
      }),
    ).toMatchObject({ in: { id: ["a", "b"] }, min_rows: 1, min_rows_message: "nope" });
  });

  it("adds a generated id and defaults the history kind to change", () => {
    const a = toAuditJson({ action: "x", entity: "fund" });
    expect(a).toMatchObject({ action: "x", entity: "fund", kind: "change" });
    expect(typeof a.id).toBe("string");
    expect(a.id.length).toBeGreaterThan(10);
    expect(toAuditJson({ action: "x", entity: "fund", kind: "ledger" }).kind).toBe("ledger");
  });

  it("passes p_user only when caller supplies it", async () => {
    let seen: unknown = null;
    const db = {
      rpc: async (_fn: string, args: unknown) => {
        seen = args;
        return { data: [], error: null };
      },
    };
    await auditedWrite(db, "org-1", [{ table: "funds", op: "insert", values: {} }], {
      action: "x",
      entity: "fund",
    });
    expect(seen).not.toHaveProperty("p_user");
    await auditedWrite(
      db,
      "org-1",
      [{ table: "funds", op: "insert", values: {} }],
      {
        action: "x",
        entity: "fund",
      },
      "user-9",
    );
    expect(seen).toMatchObject({ p_user: "user-9" });
  });

  it("maps a duplicate-key database error to DuplicateKeyError", async () => {
    const db = { rpc: async () => ({ data: null, error: { message: "duplicate key value" } }) };
    await expect(
      auditedWrite(db, "o", [{ table: "funds", op: "insert", values: {} }], {
        action: "x",
        entity: "fund",
      }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  it("rethrows other database errors as plain Error", async () => {
    const db = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    await expect(
      auditedWrite(db, "o", [{ table: "funds", op: "insert", values: {} }], {
        action: "x",
        entity: "fund",
      }),
    ).rejects.toThrow(/boom/);
  });
});
