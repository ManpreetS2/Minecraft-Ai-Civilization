// QA102 / forward-compatibility specification, part 2: schema validation of signed raw rows on the library path (QA94-L1) and crash-proofing (QA94-L2).
// The hostile matrix is DERIVED FROM THE VALIDATOR'S OWN STRICT SCHEMA (journalRowSchema): every (kind, field, value) the schema rejects is a signed value
// the validator must not treat as valid evidence. Raw rows and caller rows are identical, so row binding passes: only schema validation can catch them.
import { describe, expect, it } from "vitest";
import { artifactRows, clone, errorCodes, journalRowSchema, viaLibrary, type Rec } from "../lib/fc.js";
import type { Row } from "../lib/journal.js";

const HOSTILE: Array<[string, unknown]> = [["null", null], ["string", "x"], ["numeric-string", "5"], ["negative", -3], ["fraction", 1.5], ["huge", 1e308], ["true", true], ["empty-array", []], ["array-of-1", [1]], ["empty-object", {}], ["object", { a: 1 }]];
const SKIP = new Set(["hash", "previousHash", "seq", "kind", "experimentId"]); // hash chain / identity fields are covered by the chain and by the binding tests
const base = artifactRows();

type Case = { idx: number; kind: string; field: string; label: string; value: unknown };
const cases: Case[] = [];
base.forEach((row, idx) => { const seen = new Set<string>(); if (seen.has(`${row.kind}`)) return;
  for (const field of Object.keys(row)) { if (SKIP.has(field)) continue; for (const [label, value] of HOSTILE) { const mutated = { ...row, [field]: clone(value) }; if (!journalRowSchema.safeParse(mutated).success) cases.push({ idx, kind: String(row.kind), field, label, value }); } } });
// one representative row per kind keeps the matrix finite
const firstOfKind = new Map<string, number>(); base.forEach((r, i) => { if (!firstOfKind.has(String(r.kind))) firstOfKind.set(String(r.kind), i); });
const matrix = cases.filter((c) => firstOfKind.get(c.kind) === c.idx);

describe("matrix size", () => { it(`derives ${matrix.length} schema-invalid signed values over ${firstOfKind.size} row kinds`, () => { expect(matrix.length).toBeGreaterThan(40); }); });

describe("[FC-6] (QA94-L1) a signed row that violates the validator's own schema is not evidence", () => {
  it("every schema-invalid signed value yields an ERROR violation and a report that is neither VERIFIED nor real_minecraft (library path, raw == parsed)", () => {
    const accepted: string[] = [];
    for (const c of matrix) {
      const rows = clone(base) as Row[]; (rows[c.idx] as Rec)[c.field] = clone(c.value);
      let r: ReturnType<typeof viaLibrary> | undefined; try { r = viaLibrary(rows); } catch { continue; } // throws are specified in FC-7
      if (errorCodes(r).length === 0 || r.overallStatus === "VERIFIED" || r.mode === "real_minecraft") accepted.push(`${c.kind}.${c.field}=${c.label} -> ${r.mode}/${r.overallStatus}/${errorCodes(r).join(",") || "no ERROR"}`);
    }
    expect(accepted).toEqual([]);
  });
  it("the violation is attributable: it carries a code (RAW_JOURNAL_SCHEMA_VIOLATION) and the offending seq/kind in its description", () => {
    const rows = clone(base) as Row[]; const i = firstOfKind.get("tick")!; (rows[i] as Rec).durationMs = [];
    const r = viaLibrary(rows); const v = r.violations.find((x) => x.code === "RAW_JOURNAL_SCHEMA_VIOLATION"); expect(v, JSON.stringify(r.violations)).toBeDefined();
    expect(v!.description).toMatch(new RegExp(`seq\\s*${(rows[i] as Rec).seq}`)); expect(v!.description).toMatch(/tick/);
  });
  it("a schema-invalid observation is QUARANTINED: it is not counted as a verified action", () => {
    const rows = clone(base) as Row[]; const i = firstOfKind.get("action_observation")!; (rows[i] as Rec).verified = "yes";
    const r = viaLibrary(rows); expect(r.summary.verifiedActions).toBeLessThan(6);
  });
});

describe("[FC-6b] values the schema ACCEPTS stay accepted (no false rejections)", () => {
  it("null serverGameTick/measuredTps, durationMs 0, empty inventories, empty worldChanges, hunger 0 and 20, absent optionals: the real journal stays clean", () => {
    const rows = clone(base) as Row[]; for (const r of rows as Rec[]) { if (r.kind === "tick") { r.durationMs = 0; r.measuredTps = null; r.serverGameTick = null; } if (r.kind === "action_observation") { r.hungerBefore = 0; r.hungerAfter = 20; } }
    const r = viaLibrary(rows); expect(errorCodes(r)).toEqual([]);
  });
});

describe("[FC-7] (QA94-L2) the validator never throws on signed input", () => {
  const SHAPES: Array<[string, (rows: Row[]) => void]> = [
    ["start.citizens = string", (rows) => { (rows[0] as Rec).citizens = "gpt_atlas"; }], ["start.citizens = [1,{}]", (rows) => { (rows[0] as Rec).citizens = [1, {}]; }],
    ["observation.worldChanges = string", (rows) => { (rows.find((r) => r.kind === "action_observation") as Rec).worldChanges = "x"; }], ["observation.worldChanges = [null]", (rows) => { (rows.find((r) => r.kind === "action_observation") as Rec).worldChanges = [null]; }],
    ["observation.beforeInventory = null", (rows) => { (rows.find((r) => r.kind === "action_observation") as Rec).beforeInventory = null; }], ["observation.afterInventory = [1]", (rows) => { (rows.find((r) => r.kind === "action_observation") as Rec).afterInventory = [1]; }],
    ["observation.authorizedRecipients = 5", (rows) => { (rows.find((r) => r.kind === "action_observation") as Rec).authorizedRecipients = 5; }], ["attempt.target = 'x'", (rows) => { (rows.find((r) => r.kind === "action_attempt") as Rec).target = "x"; }],
    ["attempt.citizenId = {}", (rows) => { (rows.find((r) => r.kind === "action_attempt") as Rec).citizenId = {}; }], ["tick.at = {}", (rows) => { (rows.find((r) => r.kind === "tick") as Rec).at = {}; }],
    ["start.at = 5", (rows) => { (rows[0] as Rec).at = 5; }], ["shutdown.completedDuration = 'yes'", (rows) => { (rows.find((r) => r.kind === "shutdown") as Rec).completedDuration = "yes"; }],
  ];
  for (const [name, f] of SHAPES) it(`${name}: returns a report (fail-closed), does not throw`, () => {
    const rows = clone(base) as Row[]; f(rows); let r: ReturnType<typeof viaLibrary> | undefined; expect(() => { r = viaLibrary(rows); }).not.toThrow();
    expect(r!.overallStatus).not.toBe("VERIFIED"); expect(r!.mode).toBe("offline_simulated");
  });
  it("the whole schema-invalid matrix (FC-6) never throws", () => {
    const thrown: string[] = [];
    for (const c of matrix) { const rows = clone(base) as Row[]; (rows[c.idx] as Rec)[c.field] = clone(c.value); try { viaLibrary(rows); } catch (e) { thrown.push(`${c.kind}.${c.field}=${c.label}: ${(e as Error).message.slice(0, 60)}`); } }
    expect(thrown).toEqual([]);
  });
});

import { resign, richLive, validateSigned } from "../lib/hostile.js";
describe("[FC-7b] (QA94-L2) the same crash shapes on the RICH journal (place/eat/speech/deposit actions, a caller roster): the validator reaches the code paths that assume types", () => {
  const rich = richLive();
  const R: Array<[string, (rows: Row[]) => void]> = [
    ["start.citizens = string (roster comparison)", (rows) => { (rows[0] as Rec).citizens = "gpt_atlas"; }],
    ["place observation.worldChanges = string", (rows) => { (rows.find((r) => r.kind === "action_observation" && r.attemptId === "a4") as Rec).worldChanges = "x"; }],
    ["place observation.worldChanges = [null]", (rows) => { (rows.find((r) => r.kind === "action_observation" && r.attemptId === "a4") as Rec).worldChanges = [null]; }],
    ["place attempt.target = 'x'", (rows) => { (rows.find((r) => r.kind === "action_attempt" && r.attemptId === "a4") as Rec).target = "x"; }],
    ["move observation.position = 'x'", (rows) => { (rows.find((r) => r.kind === "action_observation" && r.attemptId === "a5") as Rec).position = "x"; }],
    ["speech observation.authorizedRecipients = 5", (rows) => { (rows.find((r) => r.kind === "action_observation" && r.attemptId === "a7") as Rec).authorizedRecipients = 5; }],
    ["eat observation.hungerAfter = 'x'", (rows) => { (rows.find((r) => r.kind === "action_observation" && r.attemptId === "a6") as Rec).hungerAfter = "x"; }],
    ["observation.beforeInventory = null", (rows) => { (rows.find((r) => r.kind === "action_observation" && r.attemptId === "a1") as Rec).beforeInventory = null; }],
  ];
  for (const [name, f] of R) it(`${name}: a report (fail-closed), never a throw, never VERIFIED`, () => {
    const l = resign(rich, f); let r: ReturnType<typeof validateSigned> | undefined; expect(() => { r = validateSigned(l); }).not.toThrow();
    expect(r!.overallStatus).not.toBe("VERIFIED"); expect(r!.mode).toBe("offline_simulated");
  });
});
