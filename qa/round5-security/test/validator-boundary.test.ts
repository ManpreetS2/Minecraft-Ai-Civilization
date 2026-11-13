 
// Round 5 / Mission 1: PR #131 head e0d6540 "enforce exact serialized metadata byte boundary".
// Differential test: the validator's resource limit must agree with a reference built from JSON.stringify of the unknown-key object (limit 4096 bytes, 32 keys, depth 8).
// Metadata rides on an action_attempt row signed into a real hash-chained, attested journal (synthetic key). QA-only; candidate source untouched.
import { describe, expect, it } from "vitest";
import { attest, liveJournal, paramsFor, validateLive } from "../../v94/lib/live.js";
import { ROSTER } from "../../v94/lib/rich.js";

const ATLAS = "gpt_atlas";
type R = Record<string, unknown>;
const base = (extra: R): R[] => [
  { kind: "action_attempt", citizenId: ATLAS, attemptId: "a", action: "gather", decisionSource: "scripted", decisionEventId: "d-a", expectedItem: "oak_log", ...extra },
  { kind: "action_observation", citizenId: ATLAS, attemptId: "a", verified: true, successReported: true, beforeInventory: {}, afterInventory: { oak_log: 1 }, worldChanges: [] },
];
const run = (extra: R) => { const l = liveJournal({ citizens: ROSTER, extra: base(extra) }); return validateLive(l, attest(paramsFor(l)), { finalInventories: { [ATLAS]: { oak_log: 1 } }, citizens: ROSTER }); };
const limited = (extra: R) => run(extra).violations.some((v) => v.code === "RAW_JOURNAL_RESOURCE_LIMIT");
const refBytes = (extra: R) => Buffer.byteLength(JSON.stringify(extra));

describe("PR #131 metadata resource limit: exact 4096-byte boundary", () => {
  it("single string key: limited iff the serialized metadata object exceeds 4096 bytes (n = 4085 .. 4092)", () => {
    const rows: Array<[number, number, boolean]> = [];
    for (let n = 4085; n <= 4092; n++) { const e = { x: "a".repeat(n) }; rows.push([n, refBytes(e), limited(e)]); }
    for (const [, ref, got] of rows) expect(got, `ref=${ref}`).toBe(ref > 4096);
    // the exact edge is exercised: at least one case on each side
    expect(rows.some(([, r]) => r <= 4096)).toBe(true); expect(rows.some(([, r]) => r > 4096)).toBe(true);
  });
  it("multi-byte and escaped content is measured as serialized bytes (Ã©, ðŸ˜€, quotes, backslashes, control chars)", () => {
    const fillers = ["Ã©", "ðŸ˜€", '"', "\\", "\n", "\u0001", "æ—¥"];
    for (const f of fillers) {
      for (const target of [4094, 4095, 4096, 4097, 4098]) {
        let n = 0; let e: R = { x: "" };
        while (refBytes(e) < target && n < 5000) { n++; e = { x: f.repeat(n) }; }
        if (refBytes(e) !== target) continue; // some fillers skip a size; only test reachable sizes
        expect(limited(e), `filler=${JSON.stringify(f)} ref=${refBytes(e)}`).toBe(target > 4096);
      }
    }
  });
  it("seeded differential: 300 random shapes (keys, nested arrays/objects, depth <= 8) agree with the reference", () => {
    let s = 0x5eed1234; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const val = (depth: number): unknown => {
      const r = rnd();
      if (depth >= 7 || r < 0.35) return [rnd() < 0.5 ? Math.floor(rnd() * 1e6) : "s".repeat(Math.floor(rnd() * 120)), null, true][Math.floor(rnd() * 3)];
      if (r < 0.65) return Array.from({ length: Math.floor(rnd() * 6) }, () => val(depth + 1));
      const o: R = {}; for (let i = 0, k = Math.floor(rnd() * 5); i < k; i++) o[`k${Math.floor(rnd() * 99)}Ã©`] = val(depth + 1); return o;
    };
    const bad: string[] = [];
    for (let i = 0; i < 300; i++) {
      const e: R = {}; const keys = 1 + Math.floor(rnd() * 6);
      for (let k = 0; k < keys; k++) e[`m${k}_${Math.floor(rnd() * 99)}`] = val(1);
      // grow some cases toward the boundary
      if (i % 3 === 0) e.pad = "p".repeat(Math.max(0, 4096 - refBytes(e) + Math.floor(rnd() * 9) - 4));
      const ref = refBytes(e); if (ref > 4300 || ref < 1) continue;
      if (limited(e) !== ref > 4096) bad.push(`#${i} ref=${ref} got=${limited(e)}`);
    }
    expect(bad).toEqual([]);
  });
  it("key-count and depth limits: 32 keys accepted, 33 limited; depth 8 accepted, depth 9 limited", () => {
    const keys = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 1]));
    expect(limited(keys(32))).toBe(false); expect(limited(keys(33))).toBe(true);
    const nest = (d: number): unknown => (d === 0 ? 1 : [nest(d - 1)]);
    expect(limited({ d: nest(7) })).toBe(false); expect(limited({ d: nest(8) })).toBe(true);
  });
  it("positive control: a plain unknown signed field below every limit is inert metadata (reported, not a violation, run still VERIFIED)", () => {
    const r = run({ recorderVersion: "1.2.3" });
    expect(r.violations.map((v) => v.code)).toEqual([]);
    expect(JSON.stringify(r.notProven)).toMatch(/UNKNOWN_SIGNED_FIELD/);
  });
  it("an over-limit signed row is never VERIFIED", () => { expect(run({ x: "a".repeat(5000) }).overallStatus).not.toBe("VERIFIED"); });
});
