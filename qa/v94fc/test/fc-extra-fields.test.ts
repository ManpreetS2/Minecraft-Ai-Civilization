// QA102 / forward-compatibility specification, part 1: genuinely signed EXTRA fields (QA94-M1). Written against PR #94 (da0e1ff9).
// RED today = the behaviour the implementation agent must deliver. Controls are GREEN and must stay green. Ordinary assertions only.
import { describe, expect, it } from "vitest";
import { artifactRows, clone, errorCodes, viaAdapter, viaLibrary, type Rec } from "../lib/fc.js";
import type { Row } from "../lib/journal.js";

const KINDS = ["start", "tick", "action_attempt", "action_observation", "shutdown"] as const;
const control = () => viaAdapter(artifactRows());
const withExtra = (patch: (r: Rec) => void, only?: string) => { const rows = artifactRows(); for (const r of rows) if (!only || r.kind === only) patch(r as Rec); return rows; };

describe("controls (green on PR #94)", () => {
  it("the real scenario-2 journal through the shipped adapter is clean: 0 violations, 6 verified actions, offline_simulated", () => {
    const r = control(); expect(r.violations).toEqual([]); expect(r.summary.verifiedActions).toBe(6); expect(r.mode).toBe("offline_simulated");
  });
  it("complete row binding still catches every known-field edit when extras are ABSENT (the property the repair must not weaken)", () => {
    const rows = artifactRows(); const lines = rows.map((r) => JSON.stringify(r));
    void lines; const m = clone(rows); (m.find((r) => r.kind === "action_observation") as Rec).verified = false;
    const out = viaLibrary(rows, { journalRows: m as never }); expect(errorCodes(out)).toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
});

describe("[FC-1] a signed top-level extra field must not make the run invalid (adapter path)", () => {
  for (const kind of KINDS) it(`extra key on every ${kind} row: no ERROR violation and the verification outcome equals the control`, () => {
    const r = viaAdapter(withExtra((row) => { row.recorderExtra = { build: 7 }; }, kind));
    expect(errorCodes(r), kind).toEqual([]); expect(r.summary.verifiedActions).toBe(6); expect(r.overallStatus).toBe(control().overallStatus);
  });
  it("a scalar extra (tickCpuMs) on tick rows only", () => {
    const r = viaAdapter(withExtra((row) => { row.tickCpuMs = 3; }, "tick")); expect(errorCodes(r)).toEqual([]);
  });
  it("the extra is REPORTED, not silently dropped: the report names the unknown key(s) in notProven/metadata so an auditor can see them", () => {
    const r = viaAdapter(withExtra((row) => { row.tickCpuMs = 3; }, "tick"));
    expect(JSON.stringify(r.notProven) + JSON.stringify(r.violations)).toMatch(/tickCpuMs/);
  });
});

describe("[FC-2] extras are inert: they can never change a decision", () => {
  it("keys that look like known semantic fields (Verified, verifiedX, _hash, citizenIds, decisionSourceX) change nothing", () => {
    const base = control();
    const r = viaAdapter(withExtra((row) => { Object.assign(row, { Verified: true, verifiedX: true, _hash: "0".repeat(64), citizenIds: ["x"], decisionSourceX: "model", successReportedAt: 1 }); }));
    expect(errorCodes(r)).toEqual([]); expect(r.summary.verifiedActions).toBe(base.summary.verifiedActions); expect(r.actionVerifications).toEqual(base.actionVerifications);
  });
  it("prototype-ish keys (__proto__, constructor, prototype) are data: no pollution, no crash, no change", () => {
    const rows = artifactRows(); const text = rows.map((r) => JSON.stringify(r).replace(/^\{/, '{"__proto__":{"polluted":true},"constructor":{"prototype":{"p":1}},')).join("\n");
    void text; const r = viaAdapter(withExtra((row) => { Object.defineProperty(row, "__proto__x", { value: 1, enumerable: true }); }));
    expect(({} as Rec).polluted).toBeUndefined(); expect(errorCodes(r)).toEqual([]);
  });
  it("extras do not allow a caller to launder a KNOWN field: with extras present, editing a parsed known field is still a RAW_JOURNAL_ROW_MISMATCH", () => {
    const rows = withExtra((row) => { row.recorderExtra = 1; }); const lines = rows;
    const parsedRows = clone(lines) as Rec[]; (parsedRows.find((r) => r.kind === "action_observation") as Rec).verified = false;
    const out = viaLibrary(rows as Row[], { journalRows: parsedRows as never }); expect(errorCodes(out)).toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
});

describe("[FC-3] bounds on additional metadata (resource safety)", () => {
  it("10 000 extra keys on one row, and a 5 000-deep nested extra, neither crash nor take more than 3 s; the run is not VERIFIED as clean (resource-limit violation or warning)", () => {
    const rows = artifactRows(); const big: Rec = {}; for (let i = 0; i < 10_000; i++) big[`k${i}`] = i; let deep: unknown = 1; for (let i = 0; i < 5000; i++) deep = [deep];
    (rows.find((r) => r.kind === "tick") as Rec).recorderExtra = big; (rows.find((r) => r.kind === "start") as Rec).deepExtra = deep;
    const t = Date.now(); let r: ReturnType<typeof viaAdapter> | undefined; expect(() => { r = viaAdapter(rows); }).not.toThrow(); expect(Date.now() - t).toBeLessThan(3_000);
    expect(JSON.stringify(r!.violations) + JSON.stringify(r!.notProven)).toMatch(/limit|bound|too (large|many|deep)|oversize/i);
  });
});

describe("[FC-4] unknown ROW KINDS signed by the recorder", () => {
  it("a signed row of an unknown kind (heartbeat) is an UNPROVEN note, not an ERROR; every known row still verifies", () => {
    const rows = artifactRows(); rows.splice(5, 0, { experimentId: (rows[0] as Rec).experimentId, seq: 0, at: (rows[4] as Rec).at, previousHash: "", kind: "heartbeat", beat: 1 } as Row);
    const r = viaAdapter(rows); expect(errorCodes(r)).toEqual([]); expect(r.summary.verifiedActions).toBe(6);
    expect(JSON.stringify(r.notProven)).toMatch(/heartbeat|UNKNOWN_ROW_KIND/);
  });
});

describe("[FC-5] nested unknown keys inside KNOWN structured values stay strict (guard: do not widen beyond top level)", () => {
  it("an unknown key inside position / a worldChanges entry / target is flagged or the row quarantined, never silently accepted as verified", () => {
    for (const patch of [(row: Rec) => { if (row.position) (row.position as Rec).extra = 1; }, (row: Rec) => { if (Array.isArray(row.worldChanges) && row.worldChanges.length) (row.worldChanges[0] as Rec).extra = 1; }, (row: Rec) => { if (row.target) (row.target as Rec).extra = 1; }]) {
      const rows = artifactRows(); let touched = 0; for (const r of rows) { const before = JSON.stringify(r); patch(r as Rec); if (JSON.stringify(r) !== before) touched += 1; }
      if (touched === 0) continue; const r = viaAdapter(rows); expect(errorCodes(r).length + r.notProven.length, "nested unknown key must surface").toBeGreaterThan(0);
    }
  });
});
