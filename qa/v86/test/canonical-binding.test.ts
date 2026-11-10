import { expect, it } from "vitest";
import { clone, type Row } from "../lib/journal.js";
import { richExtra, richLive, validateRich, type R } from "../lib/rich.js";
const codes = (r: ReturnType<typeof validateRich>) => r.violations.map(v => v.code);
function reordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reordered(v)]));
  return value;
}
it("object key order does not change canonical signed-row equality", () => {
  const l = richLive();
  const report = validateRich({ ...l, rows: reordered(l.rows) as Row[] });
  expect(report.overallStatus).toBe("VERIFIED");
  expect(codes(report)).not.toContain("RAW_JOURNAL_ROW_MISMATCH");
});
it("every populated parsed row field except derived root hashes is bound, without changing authenticated action results", () => {
  const l = richLive(); const honest = validateRich(l); let mutations = 0;
  for (let i = 0; i < l.rows.length; i++) {
    for (const [key, value] of Object.entries(l.rows[i]!)) {
      if (key === "hash" || key === "previousHash") continue;
      const rows = clone(l.rows) as Row[];
      (rows[i] as R)[key] = typeof value === "number" ? value + 1 : typeof value === "string" ? `${value}-changed` : typeof value === "boolean" ? !value : value === null ? "changed" : Array.isArray(value) ? [...value, "changed"] : { ...(value as R), changed: true };
      const report = validateRich({ ...l, rows });
      expect(codes(report), `${i}.${key}`).toContain("RAW_JOURNAL_ROW_MISMATCH");
      expect(report.actionVerifications, `${i}.${key}`).toEqual(honest.actionVerifications);
      mutations++;
    }
  }
  console.log({ boundFieldMutations: mutations });
});
it("only root hash fields are derived from the original raw chain", () => {
  const l = richLive(); const rows = clone(l.rows) as Row[];
  for (const row of rows) { row.hash = "caller hash"; row.previousHash = "caller previous hash"; }
  expect(validateRich({ ...l, rows }).overallStatus).toBe("VERIFIED");
});
it("empty collection defaults and absent optional undefined values remain compatible", () => {
  const l = richLive(); const rows = clone(l.rows) as Row[];
  for (const row of rows) {
    row.optionalCallerField = undefined;
    if (row.kind !== "action_observation") continue;
    for (const key of ["beforeInventory", "afterInventory", "worldChanges", "authorizedRecipients"]) {
      const v = row[key];
      if (v && typeof v === "object" && Object.keys(v).length === 0) delete row[key];
    }
  }
  expect(validateRich({ ...l, rows }).overallStatus).toBe("VERIFIED");
});
it("future signed fields and nested hash-named fields cannot be edited or omitted", () => {
  const l = richLive({ extra: richExtra().map(r => ({ ...r, futureMetadata: { hash: "signed", value: 5 } })) });
  expect(validateRich(l).overallStatus).toBe("VERIFIED");
  for (const edit of ["nested", "delete"]) {
    const rows = clone(l.rows) as Row[]; const row = rows.find(r => r.futureMetadata)!;
    if (edit === "delete") delete row.futureMetadata;
    else (row.futureMetadata as R).hash = "changed";
    expect(codes(validateRich({ ...l, rows }))).toContain("RAW_JOURNAL_ROW_MISMATCH");
  }
});
it("caller row reordering is rejected and authenticated order drives verification", () => {
  const l = richLive(); const honest = validateRich(l);
  const report = validateRich({ ...l, rows: [...l.rows].reverse() });
  expect(codes(report)).toContain("RAW_JOURNAL_ROW_MISMATCH");
  expect(report.actionVerifications).toEqual(honest.actionVerifications);
});
it("non-JSON caller values do not canonicalize into signed values", () => {
  const l = richLive();
  for (const value of [NaN, Infinity, new Date(), () => 1]) {
    const rows = clone(l.rows) as Row[]; rows[0]!.futureValue = value;
    expect(codes(validateRich({ ...l, rows }))).toContain("RAW_JOURNAL_ROW_MISMATCH");
  }
});
