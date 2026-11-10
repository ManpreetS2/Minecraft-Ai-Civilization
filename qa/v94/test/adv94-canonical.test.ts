// QA94: independent challenge of PR #94's canonical row binding. Genuinely signed raw lines (node:crypto key), parsed rows edited by the caller.
// Every assertion is ordinary. A passing synthetic signed control proves the verifier's logic, NOT that a real Paper signer exists.
import { describe, expect, it } from "vitest";
import { clone, type Row } from "../lib/journal.js";
import { attest, paramsFor, validateLive } from "../lib/live.js";
import { RICH_FINALS, ROSTER, richLive, validateRich } from "../lib/rich.js";

type Rec = Record<string, unknown>;
const real = (r: { mode: string }) => r.mode === "real_minecraft";
const codes = (r: { violations: Array<{ code: string }> }) => r.violations.map((v) => v.code);
const mismatch = (r: Parameters<typeof codes>[0]) => codes(r).includes("RAW_JOURNAL_ROW_MISMATCH");
const base = () => { const l = richLive(); return { l, honest: validateRich(l) }; };
const withRows = (l: ReturnType<typeof richLive>, f: (rows: Row[]) => void) => { const rows = clone(l.rows) as Row[]; f(rows); return { ...l, rows }; };

/** Every leaf path of a JSON value, as arrays of keys/indices. */
function leaves(v: unknown, path: Array<string | number> = [], out: Array<Array<string | number>> = []): Array<Array<string | number>> {
  if (v !== null && typeof v === "object") { for (const [k, c] of Object.entries(v as Rec)) leaves(c, [...path, Array.isArray(v) ? Number(k) : k], out); if (Array.isArray(v) && v.length === 0) out.push(path); if (!Array.isArray(v) && Object.keys(v as Rec).length === 0) out.push(path); }
  else out.push(path);
  return out;
}
const getAt = (o: unknown, p: Array<string | number>) => p.reduce<unknown>((a, k) => (a as Rec)[k as string], o);
const setAt = (o: unknown, p: Array<string | number>, val: unknown) => { const parent = getAt(o, p.slice(0, -1)) as Rec; parent[p[p.length - 1] as string] = val as never; };
const delAt = (o: unknown, p: Array<string | number>) => { const parent = getAt(o, p.slice(0, -1)) as Rec | unknown[]; if (Array.isArray(parent)) parent.splice(p[p.length - 1] as number, 1); else delete (parent as Rec)[p[p.length - 1] as string]; };

describe("controls", () => {
  it("rich signed run is real_minecraft / VERIFIED with 9 verified actions and no violations (nothing about the canonical binding rejects valid evidence)", () => {
    const { honest } = base(); expect(real(honest)).toBe(true); expect(honest.overallStatus).toBe("VERIFIED"); expect(honest.summary.verifiedActions).toBe(9); expect(honest.violations).toEqual([]);
  });
});

describe("exhaustive leaf mutation: every populated value at every depth of every row is bound", () => {
  const { l } = base();
  const edits: Array<{ row: number; path: Array<string | number>; kind: string }> = [];
  l.rows.forEach((row, i) => { for (const p of leaves(row)) { const root = String(p[0]); if (p.length === 1 && (root === "hash" || root === "previousHash")) continue; edits.push({ row: i, path: p, kind: "change" }, { row: i, path: p, kind: "delete" }); } });
  it(`${edits.length} (leaf change/delete) mutations: every one yields RAW_JOURNAL_ROW_MISMATCH (except the documented root-default no-ops) and never a real_minecraft report`, () => {
    const survivors: string[] = []; let n = 0;
    for (const e of edits) {
      const m = withRows(l, (rows) => {
        const row = rows[e.row] as Rec;
        if (e.kind === "delete") delAt(row, e.path);
        else { const cur = getAt(row, e.path); setAt(row, e.path, typeof cur === "number" ? cur + 1 : typeof cur === "boolean" ? !cur : typeof cur === "string" ? cur + "x" : "qa-marker"); }
      });
      const r = validateRich(m); n += 1;
      if (!mismatch(r) || real(r)) survivors.push(`${(l.rows[e.row] as Rec).kind}#${(l.rows[e.row] as Rec).seq}.${e.path.join(".")}[${e.kind}] -> ${r.mode}/${r.overallStatus}/${codes(r).join(",") || "none"}`);
    }
    // Deleting a key whose value is an EMPTY default (before/afterInventory {}, worldChanges []) is intentionally equal to absent: allowed no-ops.
    const real_survivors = survivors.filter((s) => !/\.(beforeInventory|afterInventory|worldChanges|authorizedRecipients)\[delete\]/.test(s));
    console.log("QA94 leaf mutations total=", n, "survivors=", survivors.length, "unexpected=", real_survivors.length);
    expect(real_survivors).toEqual([]);
  });
  it("adding an unexpected key at EVERY object level of every row is rejected", () => {
    const survivors: string[] = [];
    l.rows.forEach((row, i) => {
      const objs: Array<Array<string | number>> = [[]]; const walk = (v: unknown, p: Array<string | number>) => { if (v && typeof v === "object") { if (!Array.isArray(v)) objs.push(p); for (const [k, c] of Object.entries(v as Rec)) walk(c, [...p, Array.isArray(v) ? Number(k) : k]); } };
      walk(row, []);
      for (const p of objs) { const m = withRows(l, (rows) => { const o = (p.length ? getAt(rows[i], p) : rows[i]) as Rec; o.qaExtra = { nested: 1 }; }); const r = validateRich(m); if (!mismatch(r)) survivors.push(`${(row as Rec).kind}#${(row as Rec).seq}@${p.join(".") || "root"}`); }
    });
    expect(survivors).toEqual([]);
  });
  it("array mutations (push, remove, reorder, duplicate) of authorizedRecipients and worldChanges are rejected", () => {
    const j = richLive({ extra: richExtra2() });
    for (const f of [(a: unknown[]) => a.push("zzz"), (a: unknown[]) => a.pop(), (a: unknown[]) => a.reverse(), (a: unknown[]) => a.push(a[0])]) {
      for (const key of ["authorizedRecipients", "worldChanges"]) {
        const m = withRows(j, (rows) => { for (const r of rows as Rec[]) if (r.kind === "action_observation" && Array.isArray(r[key]) && (r[key] as unknown[]).length >= 2) f(r[key] as unknown[]); });
        expect(mismatch(validateRich(m)), key).toBe(true);
      }
    }
  });
});
function richExtra2() {
  const extra = (richLive().rows as Row[]).filter((r) => r.kind === "action_attempt" || r.kind === "action_observation").map((r) => { const { seq: _s, hash: _h, previousHash: _p, at: _a, experimentId: _e, ...rest } = r as Rec; return rest; });
  return extra.map((r) => (r.attemptId === "a7" && r.kind === "action_observation" ? { ...r, authorizedRecipients: ["gpt_maya", "claude_theo"] } : r.attemptId === "a4" && r.kind === "action_observation" ? { ...r, worldChanges: [...(r.worldChanges as unknown[]), { position: { x: 2, y: 64, z: 1 }, before: "air", after: "oak_planks" }] } : r));
}

describe("what is NOT bound (documented, by design)", () => {
  it("root hash / previousHash edits in the parsed row are ignored because the signed raw hash chain verifies them independently", () => {
    const { l, honest } = base();
    const m = withRows(l, (rows) => { for (const r of rows as Rec[]) { r.hash = "0".repeat(64); r.previousHash = "f".repeat(64); } });
    const r = validateRich(m); expect(codes(r)).not.toContain("RAW_JOURNAL_ROW_MISMATCH"); expect(r.overallStatus).toBe(honest.overallStatus);
  });
  it("...and the same hashes edited in the RAW lines break the chain/attestation, so the run is never real_minecraft", () => {
    const l = richLive(); const lines = l.lines.map((x, i) => (i === 5 ? x.replace(/"hash":"[0-9a-f]{64}"/, `"hash":"${"0".repeat(64)}"`) : x));
    const r = validateLive({ ...l, lines }, attest(paramsFor(l)), { finalInventories: RICH_FINALS, citizens: ROSTER }); expect(real(r)).toBe(false);
  });
  it("NESTED fields that happen to be named hash / previousHash ARE bound (only the root pair is excluded)", () => {
    const j = richLive({ extra: richLive().rows.filter((r) => r.kind === "action_attempt" || r.kind === "action_observation").map((r) => { const { seq: _s, hash: _h, previousHash: _p, at: _a, experimentId: _e, ...rest } = r as Rec; return rest; }).map((r) => (r.attemptId === "a4" && r.kind === "action_observation" ? { ...r, worldChanges: [{ ...(r.worldChanges as Rec[])[0], hash: "abc", previousHash: "def" }] } : r)) });
    const r0 = validateRich(j); void r0;
    const m = withRows(j, (rows) => { for (const r of rows as Rec[]) if (r.kind === "action_observation" && Array.isArray(r.worldChanges)) for (const w of r.worldChanges as Rec[]) { if ("hash" in w) w.hash = "tampered"; } });
    expect(mismatch(validateRich(m))).toBe(true);
  });
});

describe("benign differences are not false positives", () => {
  it("key order: reversing the key order of every row and of every nested object in the parsed rows is accepted and changes nothing", () => {
    const { l, honest } = base();
    const rev = (v: unknown): unknown => (Array.isArray(v) ? v.map(rev) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Rec).reverse().map(([k, c]) => [k, rev(c)])) : v);
    const r = validateRich({ ...l, rows: (l.rows as Row[]).map((x) => rev(x) as Row) });
    expect(codes(r)).not.toContain("RAW_JOURNAL_ROW_MISMATCH"); expect(r.overallStatus).toBe(honest.overallStatus); expect(r.summary.verifiedActions).toBe(9);
  });
  it("optional/default fields: absent vs empty for beforeInventory, afterInventory, worldChanges, authorizedRecipients is equal in BOTH directions", () => {
    const { l } = base();
    const dropped = withRows(l, (rows) => { for (const r of rows as Rec[]) if (r.kind === "action_observation") for (const k of ["beforeInventory", "afterInventory", "worldChanges", "authorizedRecipients"]) { const v = r[k]; if (Array.isArray(v) ? v.length === 0 : v && typeof v === "object" && Object.keys(v).length === 0) delete r[k]; } });
    expect(codes(validateRich(dropped))).not.toContain("RAW_JOURNAL_ROW_MISMATCH");
    const added = withRows(l, (rows) => { for (const r of rows as Rec[]) if (r.kind === "action_observation") { r.authorizedRecipients ??= []; r.worldChanges ??= []; } });
    expect(codes(validateRich(added))).not.toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
  it("explicit `undefined` values in the parsed rows are equal to absent keys", () => {
    const { l } = base(); const m = withRows(l, (rows) => { for (const r of rows as Rec[]) { r.qaOptional = undefined; if (r.kind === "action_observation") r.hungerBefore ??= undefined; } });
    expect(codes(validateRich(m))).not.toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
  it("the default equivalence is limited to action_observation collections: an added worldChanges:[] on a TICK row is rejected", () => {
    const { l } = base(); const m = withRows(l, (rows) => { (rows.find((r) => r.kind === "tick") as Rec).worldChanges = []; });
    expect(mismatch(validateRich(m))).toBe(true);
  });
  it("null is NOT equal to absent (stricter than the defaults): characterised so a future recorder change is noticed", () => {
    const { l } = base(); const m = withRows(l, (rows) => { for (const r of rows as Rec[]) if (r.kind === "action_observation") { r.hungerBefore = null; break; } });
    expect(mismatch(validateRich(m))).toBe(true);
  });
  it("number spellings are equal after parsing: 1, 1.0 and 1e0 in raw text bind to the numeric 1 in the parsed row", () => {
    const l = richLive(); const lines = l.lines.map((x) => x.replace('"oak_log":2', '"oak_log":2.0'));
    expect(lines.join("\n")).toContain("2.0"); // text edited => hash chain differs; only the BINDING outcome is of interest here:
    const r = validateLive({ ...l, lines }, attest(paramsFor(l)), { finalInventories: RICH_FINALS, citizens: ROSTER }); expect(real(r)).toBe(false);
  });
});

describe("row-level structure", () => {
  it("row order: swapping any two adjacent parsed rows is rejected; reordering never yields VERIFIED", () => {
    const { l } = base();
    for (let i = 1; i < l.rows.length - 1; i += 7) { const m = withRows(l, (rows) => { [rows[i], rows[i + 1]] = [rows[i + 1]!, rows[i]!]; }); const r = validateRich(m); expect(mismatch(r), `swap ${i}`).toBe(true); expect(real(r)).toBe(false); }
  });
  it("count: removing, duplicating or injecting a row is rejected; replacing a row with a copy of its neighbour (same count) is rejected", () => {
    const { l } = base();
    for (const f of [(rows: Row[]) => rows.splice(10, 1), (rows: Row[]) => rows.splice(10, 0, clone(rows[10]!)), (rows: Row[]) => rows.push({ ...clone(rows[3]!), seq: 999 } as Row), (rows: Row[]) => { rows[10] = clone(rows[11]!); }]) {
      const r = validateRich(withRows(l, f)); expect(mismatch(r)).toBe(true); expect(real(r)).toBe(false);
    }
  });
  it("seq edits are bound: renumbering a parsed row is rejected", () => {
    const { l } = base(); expect(mismatch(validateRich(withRows(l, (rows) => { (rows[20] as Rec).seq = 7; })))).toBe(true);
  });
});

describe("the five PR #90 defects, replayed independently with different values", () => {
  const j = richLive();
  const edit = (id: string, kind: string, patch: Rec) => withRows(j, (rows) => { Object.assign(rows.find((r) => r.attemptId === id && r.kind === kind)!, patch); });
  it("hunger, health, recipients, citizenId and the start roster: each divergence is a RAW_JOURNAL_ROW_MISMATCH and never VERIFIED/real", () => {
    const cases: Array<[string, ReturnType<typeof withRows>]> = [
      ["hungerBefore", edit("a6", "action_observation", { hungerBefore: 1 })], ["hungerAfter", edit("a6", "action_observation", { hungerAfter: 99 })],
      ["healthBefore", edit("a6", "action_observation", { healthBefore: 0 })], ["healthAfter", edit("a6", "action_observation", { healthAfter: 0.5 })],
      ["recipients+", edit("a7", "action_observation", { authorizedRecipients: ["gpt_maya", "x"] })], ["recipients-", edit("a7", "action_observation", { authorizedRecipients: [] })],
      ["citizenId (attempt)", edit("a5", "action_attempt", { citizenId: "gpt_maya" })], ["citizenId (observation)", edit("a5", "action_observation", { citizenId: "gpt_maya" })],
      ["start roster -", withRows(j, (rows) => { (rows[0] as Rec).citizens = [...ROSTER].slice(0, 2); })], ["start roster +", withRows(j, (rows) => { (rows[0] as Rec).citizens = [...ROSTER, "extra"]; })],
      ["start roster deleted", withRows(j, (rows) => { delete (rows[0] as Rec).citizens; })], ["start roster reordered", withRows(j, (rows) => { (rows[0] as Rec).citizens = [...ROSTER].reverse(); })],
    ];
    for (const [name, m] of cases) { const r = validateRich(m); expect(mismatch(r), name).toBe(true); expect(real(r), name).toBe(false); expect(r.overallStatus, name).not.toBe("VERIFIED"); }
  });
  it("the decisions use the SIGNED values: an eat whose signed row has no hunger increase stays UNVERIFIED whatever the caller supplies", () => {
    const l0 = richLive({ extra: richLive().rows.filter((r) => r.kind === "action_attempt" || r.kind === "action_observation").map((r) => { const { seq: _s, hash: _h, previousHash: _p, at: _a, experimentId: _e, ...rest } = r as Rec; return rest; }).map((r) => (r.attemptId === "a6" && r.kind === "action_observation" ? { ...r, hungerBefore: 16, hungerAfter: 16 } : r)) });
    const forged = validateRich(withRows(l0, (rows) => { Object.assign(rows.find((r) => r.attemptId === "a6" && r.kind === "action_observation")!, { hungerBefore: 10, hungerAfter: 16 }); }));
    expect(forged.summary.verifiedActions).toBe(8); expect(mismatch(forged)).toBe(true);
  });
  it("re-attributing a signed action between citizens does not move verified work: per-citizen verified counts equal the honest run's", () => {
    const honest = validateRich(j); const forged = validateRich(edit("a5", "action_attempt", { citizenId: "gpt_maya" }));
    const per = (r: typeof honest, c: string) => r.actionVerifications.filter((a) => a.citizenId === c && a.status === "VERIFIED").length;
    expect(per(forged, "gpt_atlas")).toBe(per(honest, "gpt_atlas")); expect(per(forged, "gpt_maya")).toBe(per(honest, "gpt_maya"));
  });
});

describe("unexpected (non-JSON / exotic) values in the caller's parsed rows", () => {
  const { l } = base();
  class Foo { a = 1; }
  const circular: Rec = { x: 1 }; circular.self = circular;
  const thrower = { get boom(): never { throw new Error("getter exploded"); } };
  const EXOTIC: Array<[string, () => unknown]> = [
    ["NaN", () => Number.NaN], ["Infinity", () => Number.POSITIVE_INFINITY], ["-Infinity", () => Number.NEGATIVE_INFINITY], ["Date", () => new Date(0)], ["Map", () => new Map([["a", 1]])], ["Set", () => new Set([1])],
    ["function", () => () => 1], ["BigInt", () => 10n], ["Symbol", () => Symbol("s")], ["class instance", () => new Foo()], ["circular", () => circular], ["throwing getter", () => thrower],
    ["undefined inside an array", () => [1, undefined]], ["boxed Number", () => new Number(1)], ["typed array", () => new Uint8Array([1])], ["Object.create(null) (plain: should be EQUAL)", () => Object.assign(Object.create(null), { a: 1 })],
  ];
  it("each exotic value, placed in a numeric field, a string field, an inventory leaf and an array element, is rejected as a mismatch without throwing and never reaches real_minecraft", () => {
    const targets: Array<(rows: Row[], v: unknown) => void> = [
      (rows, v) => { (rows.find((r) => r.kind === "tick") as Rec).durationMs = v; }, (rows, v) => { (rows.find((r) => r.kind === "action_attempt") as Rec).decisionEventId = v; },
      (rows, v) => { ((rows.find((r) => r.kind === "action_observation") as Rec).afterInventory as Rec).oak_log = v; }, (rows, v) => { (rows.find((r) => r.attemptId === "a7" && r.kind === "action_observation") as Rec).authorizedRecipients = [v]; },
      (rows, v) => { (rows[0] as Rec).citizens = [...ROSTER, v]; },
    ];
    for (const [name, mk] of EXOTIC) for (const [ti, t] of targets.entries()) {
      const m = withRows(l, (rows) => t(rows, mk())); let r: ReturnType<typeof validateRich> | undefined;
      expect(() => { r = validateRich(m); }, `${name}@${ti} must not throw`).not.toThrow();
      expect(real(r!), `${name}@${ti}`).toBe(false);
    }
  });
  it("a JSON null in the SIGNED row is not equal to a NaN/undefined-ish caller value (no silent normalisation of non-JSON values into null)", () => {
    const j = richLive({ extra: richLive().rows.filter((r) => r.kind === "action_attempt" || r.kind === "action_observation").map((r) => { const { seq: _s, hash: _h, previousHash: _p, at: _a, experimentId: _e, ...rest } = r as Rec; return rest; }).map((r) => (r.attemptId === "a6" && r.kind === "action_observation" ? { ...r, healthBefore: null } : r)) });
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown, () => 1]) {
      const m = withRows(j, (rows) => { (rows.find((r) => r.attemptId === "a6" && r.kind === "action_observation") as Rec).healthBefore = v; });
      if (v === undefined) continue; // absent is a different value from null; asserted in the null-vs-absent test above
      expect(mismatch(validateRich(m)), String(v)).toBe(true);
    }
  });
  it("decisionSource outside the enum in a SIGNED attempt (raw == parsed) is INVALID_ACTION_DECISION_SOURCE and the action is not verified", () => {
    const j = richLive({ extra: richLive().rows.filter((r) => r.kind === "action_attempt" || r.kind === "action_observation").map((r) => { const { seq: _s, hash: _h, previousHash: _p, at: _a, experimentId: _e, ...rest } = r as Rec; return rest; }).map((r) => (r.attemptId === "a1" && r.kind === "action_attempt" ? { ...r, decisionSource: "oracle" } : r)) });
    const r = validateRich(j); expect(codes(r)).toContain("INVALID_ACTION_DECISION_SOURCE"); expect(r.summary.verifiedActions).toBeLessThan(9); expect(real(r)).toBe(false);
  });
  it("__proto__ / constructor / prototype keys are ordinary data: equal when identical, mismatch when only one side has them; no prototype pollution", () => {
    const j = richLive({ extra: richLive().rows.filter((r) => r.kind === "action_attempt" || r.kind === "action_observation").map((r) => { const { seq: _s, hash: _h, previousHash: _p, at: _a, experimentId: _e, ...rest } = r as Rec; return rest; }).map((r) => (r.attemptId === "a3" && r.kind === "action_observation" ? JSON.parse(JSON.stringify({ ...r, meta: { constructor: { prototype: { polluted: 1 } } } }).replace('"meta":', '"__proto__":{"x":1},"meta":')) : r)) });
    const same = validateRich(j); expect(codes(same)).not.toContain("RAW_JOURNAL_ROW_MISMATCH");
    const dropped = withRows(j, (rows) => { delete (rows.find((r) => r.attemptId === "a3" && r.kind === "action_observation") as Rec).meta; });
    expect(mismatch(validateRich(dropped))).toBe(true); expect(({} as Rec).polluted).toBeUndefined(); expect(({} as Rec).x).toBeUndefined();
  });
  it("Object.create(null) rows equal their plain-object twins (not a false positive)", () => {
    const m = withRows(l, (rows) => { for (let i = 0; i < rows.length; i++) rows[i] = Object.assign(Object.create(null), rows[i]) as Row; });
    expect(codes(validateRich(m))).not.toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
  it("deeply nested parsed values (depth 5 000) fail closed without a stack overflow escaping", () => {
    let deep: unknown = 1; for (let i = 0; i < 5000; i++) deep = [deep];
    const m = withRows(l, (rows) => { (rows.find((r) => r.kind === "action_observation") as Rec).worldChanges = deep; });
    let r: ReturnType<typeof validateRich> | undefined; expect(() => { r = validateRich(m); }).not.toThrow(); expect(mismatch(r!)).toBe(true);
  });
});

describe("additional signed metadata (present in BOTH the signed row and the caller row) and its handling", () => {
  const extraSigned = (patch: (r: Rec) => void) => {
    const src = richLive(); const rows = clone(src.rows) as Row[]; rows.forEach((r) => patch(r as Rec));
    const j = { ...src, ...(require_reseal(rows)) } as typeof src; return j;
  };
  it("future signed fields at the top level and nested (recorderVersion, meta.build, tags[]) are accepted and ignored when both copies carry them", () => {
    const j = extraSigned((r) => { r.recorderVersion = "2.1"; r.meta = { build: { n: 7 }, tags: ["a", "b"] }; });
    const r = validateRich(j); expect(codes(r)).not.toContain("RAW_JOURNAL_ROW_MISMATCH"); expect(r.summary.verifiedActions).toBe(9); expect(real(r)).toBe(true);
  });
  it("...but removing ONE nested metadata leaf from the caller copy is rejected", () => {
    const j = extraSigned((r) => { r.meta = { build: { n: 7 }, tags: ["a", "b"] }; });
    const m = withRows(j, (rows) => { (((rows[5] as Rec).meta as Rec).build as Rec).n = 8; });
    expect(mismatch(validateRich(m))).toBe(true);
  });
});
import { reseal } from "../lib/journal.js";
const require_reseal = (rows: Row[]) => reseal(rows);
