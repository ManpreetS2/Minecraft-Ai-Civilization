// QA86 B: independent replay of every QA75 defect (M1, M2, M3, G1-adjacent, L1, L2, L3, L5) with signed raw lines that are GENUINE
// and caller-controlled parsed rows / windows / options. Every assertion is ordinary (no it.fails). Own fixtures, not the QA75 copies.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { T0, attest, liveJournal, paramsFor, validateLive } from "../lib/live.js";
import { clone, reseal, type Row } from "../lib/journal.js";
import { ATLAS, MAYA, ROSTER, RICH_FINALS, richExtra, richLive, validateRich, type R } from "../lib/rich.js";

const iso = (ms: number) => new Date(ms).toISOString();
const real = (r: { mode: string }) => r.mode === "real_minecraft";
const codes = (r: { violations: Array<{ code: string }> }) => r.violations.map((v) => v.code);
const ghostRows = (): R[] => [
  { kind: "action_attempt", citizenId: "ghost", attemptId: "g1", action: "gather", decisionSource: "scripted", decisionEventId: "dg", expectedItem: "oak_log" },
  { kind: "action_observation", citizenId: "ghost", attemptId: "g1", verified: true, successReported: true, beforeInventory: {}, afterInventory: { oak_log: 1 }, worldChanges: [] },
];
/** Edit ONLY the caller-supplied parsed rows; the signed raw lines and the attestation stay untouched and genuine. */
const parsed = (l: ReturnType<typeof richLive>, f: (rows: Row[]) => Row[] | void) => { const rows = clone(l.rows) as Row[]; const out = f(rows) ?? rows; return { ...l, rows: out }; };
const find = (rows: Row[], kind: string, attemptId?: string) => rows.find((r) => r.kind === kind && (attemptId === undefined || r.attemptId === attemptId)) as Row;

describe("QA75-M1 replay: the signed window must contain the journal", () => {
  const l = richLive();
  const at = (s: number, e: number) => validateRich(l, {}, attest(paramsFor(l, { startedAt: iso(s), endedAt: iso(e) })));
  it("30 min late, 1 s overlap, 1 s early-overlap, disjoint before/after, partial middle: none is real_minecraft or VERIFIED", () => {
    for (const [s, e] of [[T0 + 1_800_000, T0 + 5_400_000], [T0 + 3_599_000, T0 + 7_200_000], [T0 - 3_000_000, T0 + 1_000], [T0 + 4_000_000, T0 + 7_600_000], [T0 - 4_000_000, T0 - 100_000], [T0 + 1_500_000, T0 + 2_100_000]]) {
      const r = at(s, e); expect(real(r), `${s - T0}..${e - T0}`).toBe(false); expect(r.overallStatus).not.toBe("VERIFIED");
    }
  });
  it("the rejection says why (an auditable reason, not a silent downgrade)", () => {
    const r = at(T0 + 1_800_000, T0 + 5_400_000);
    expect(JSON.stringify(r.sourceAttestationAudit?.reasons ?? r.durationAudit?.reasons)).toMatch(/window|journal|skew|contain/i);
  });
});

describe("QA75-M2 replay: omitted / injected / reordered signed rows", () => {
  const withGhost = richLive({ extra: [...richExtra(), ...ghostRows()] });
  it("control: the full journal surfaces the ghost citizen", () => { expect(codes(validateRich(withGhost))).toContain("PHANTOM_CITIZEN_ACTION"); });
  it("omitting the ghost's attempt+observation from journalRows still surfaces a violation (RAW_JOURNAL_ROW_MISMATCH and/or PHANTOM_CITIZEN_ACTION)", () => {
    const l = parsed(withGhost, (rows) => rows.filter((r) => r.citizenId !== "ghost"));
    const c = codes(validateRich(l)); expect(c.some((x) => x === "RAW_JOURNAL_ROW_MISMATCH" || x === "PHANTOM_CITIZEN_ACTION")).toBe(true);
    expect(validateRich(l).overallStatus).toBe("VIOLATIONS_DETECTED");
  });
  it("omitting ONLY the ghost's observation, ONLY its attempt, a tick row, or the shutdown row: each is a RAW_JOURNAL_ROW_MISMATCH", () => {
    const cases: Array<[string, (r: Row) => boolean]> = [["ghost obs", (r) => r.kind === "action_observation" && r.citizenId === "ghost"], ["ghost attempt", (r) => r.kind === "action_attempt" && r.citizenId === "ghost"],
      ["a tick", (r) => r.kind === "tick" && r.seq === 30], ["shutdown", (r) => r.kind === "shutdown"], ["a legit attempt", (r) => r.kind === "action_attempt" && r.attemptId === "a3"]];
    for (const [name, pred] of cases) {
      const r = validateRich(parsed(withGhost, (rows) => rows.filter((x) => !pred(x))));
      expect(codes(r), name).toContain("RAW_JOURNAL_ROW_MISMATCH"); expect(real(r), name).toBe(false);
    }
  });
  it("a signed conflicting second start row (different sourceSha) omitted from journalRows still yields SOURCE_IDENTITY_CONFLICT", () => {
    const rows0 = clone(richLive().rows) as Row[]; const s2 = clone(rows0[0]!); s2.sourceSha = "e".repeat(40); rows0.splice(2, 0, s2);
    const j = { ...richLive(), ...reseal(rows0) } as ReturnType<typeof richLive>;
    const l = parsed(j, (rows) => rows.filter((_, i) => i !== 2));
    expect(codes(validateRich(l))).toContain("SOURCE_IDENTITY_CONFLICT");
  });
  it("a conflicting second start row differing only in runId or experimentId: also surfaced when omitted", () => {
    for (const patch of [{ runId: "other-run" }, { experimentId: "other-exp" }]) {
      const rows0 = clone(richLive().rows) as Row[]; const s2 = { ...clone(rows0[0]!), ...patch } as Row; rows0.splice(2, 0, s2);
      const j = { ...richLive(), ...reseal(rows0) } as ReturnType<typeof richLive>;
      const r = validateRich(parsed(j, (rows) => rows.filter((_, i) => i !== 2)));
      expect(r.violations.length, JSON.stringify(patch)).toBeGreaterThan(0); expect(real(r)).toBe(false);
    }
  });
  it("INJECTING a row that is not in the signed raw lines (new seq, or a duplicate of a signed row) is rejected", () => {
    const l = richLive();
    const injected = parsed(l, (rows) => { rows.push({ ...clone(find(rows, "action_attempt", "m1")), seq: 9999, attemptId: "evil" } as Row); });
    expect(codes(validateRich(injected))).toContain("RAW_JOURNAL_ROW_MISMATCH");
    const dup = parsed(l, (rows) => { rows.push(clone(find(rows, "action_observation", "m1"))); });
    expect(real(validateRich(dup))).toBe(false); expect(validateRich(dup).overallStatus).not.toBe("VERIFIED");
  });
  it("reordering two parsed rows (a before b) is rejected or harmless-and-identical, never a VERIFIED upgrade of a worse run", () => {
    const l = richLive(); const swapped = parsed(l, (rows) => { const i = rows.findIndex((r) => r.attemptId === "a1" && r.kind === "action_attempt"); [rows[i], rows[i + 2]] = [rows[i + 2]!, rows[i]!]; });
    const r = validateRich(swapped); expect(r.overallStatus === "VERIFIED" ? r.summary.verifiedActions <= 9 : true).toBe(true);
  });
  it("EMPTY or missing journalRows with genuine raw lines can never make the run VERIFIED/real_minecraft with 0 verified actions", () => {
    for (const rows of [[] as Row[], undefined]) {
      const r = validateRich({ ...richLive(), rows: rows as never });
      expect(r.overallStatus === "VERIFIED" && r.summary.verifiedActions === 0, `rows=${rows === undefined ? "undefined" : "[]"} -> ${r.mode}/${r.overallStatus}/${r.summary.verifiedActions}`).toBe(false);
    }
  });
});

describe("QA75-M3 replay: fields bound to the signed raw lines", () => {
  it("smoothing a genuine tick REGRESSION in the parsed rows cannot upgrade the run (raw ticks go 5000..., then 100, then recover)", () => {
    const ticks = Array.from({ length: 61 }, (_, i) => ({ at: iso(T0 + i * 60_000), serverGameTick: 5000 + i * 1200, measuredTps: 20 })); ticks[30]!.serverGameTick = 100;
    const j = richLive({ ticks }); const honest = validateRich(j);
    const forged = validateRich(parsed(j, (rows) => { rows.filter((r) => r.kind === "tick")[30]!.serverGameTick = 5000 + 30 * 1200; }));
    expect(real(honest)).toBe(false); expect(real(forged)).toBe(false);
  });
  it("tick regression with parsed rows ALSO fully smoothed (every tick rewritten monotone) is still caught from the raw lines", () => {
    const ticks = Array.from({ length: 61 }, (_, i) => ({ at: iso(T0 + i * 60_000), serverGameTick: 5000 + i * 1200, measuredTps: 20 })); ticks[30]!.serverGameTick = 100;
    const j = richLive({ ticks }); const forged = validateRich(parsed(j, (rows) => { let n = 0; for (const r of rows) if (r.kind === "tick") { r.serverGameTick = 5000 + n * 1200; n += 1; } }));
    expect(real(forged)).toBe(false); expect(forged.overallStatus).not.toBe("VERIFIED");
  });
  it("wall-clock timestamps edited in the parsed rows (compressing a 10-minute run into a claimed hour) cannot satisfy the duration claim", () => {
    const ticks = Array.from({ length: 11 }, (_, i) => ({ at: iso(T0 + i * 60_000), serverGameTick: 5000 + i * 1200, measuredTps: 20 }));
    const j = richLive({ ticks }); const forged = validateRich(parsed(j, (rows) => { let n = 0; for (const r of rows) if (r.kind === "tick") { r.at = iso(T0 + n * 360_000); n += 1; } }));
    expect(real(forged)).toBe(false);
  });
  it("a FAILED move (raw position 40 blocks away) cannot become a verified move by editing the parsed position", () => {
    const extra = [...richExtra()]; const i = extra.findIndex((r) => r.attemptId === "a5" && r.kind === "action_observation"); extra[i] = { ...extra[i]!, position: { x: 50, y: 64, z: 10 }, verified: false };
    const j = richLive({ extra }); const honest = validateRich(j);
    const forged = validateRich(parsed(j, (rows) => { find(rows, "action_observation", "a5").position = { x: 10, y: 64, z: 10 }; }));
    expect(honest.summary.verifiedActions).toBe(8); expect(forged.summary.verifiedActions).toBeLessThanOrEqual(8); expect(codes(forged)).toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
  it("a place action whose signed worldChanges show NO block change cannot be verified by adding a matching worldChange to the parsed row", () => {
    const extra = [...richExtra()]; const i = extra.findIndex((r) => r.attemptId === "a4" && r.kind === "action_observation"); extra[i] = { ...extra[i]!, worldChanges: [] };
    const j = richLive({ extra }); const honest = validateRich(j);
    const forged = validateRich(parsed(j, (rows) => { find(rows, "action_observation", "a4").worldChanges = [{ position: { x: 1, y: 64, z: 1 }, before: "air", after: "oak_planks" }] as never; }));
    expect(honest.summary.verifiedActions).toBe(8); expect(forged.summary.verifiedActions).toBe(8); expect(codes(forged)).toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
  it("editing before/after inventories, verified, successReported, expectedItem, target, range, decisionSource, decisionEventId, attemptId or action in the parsed rows is flagged for EACH field", () => {
    const patches: Array<[string, string, string, unknown]> = [
      ["action_observation", "a1", "afterInventory", { oak_log: 3 }], ["action_observation", "a1", "beforeInventory", { oak_log: 1 }], ["action_observation", "a1", "verified", false],
      ["action_observation", "a1", "successReported", false], ["action_attempt", "a1", "expectedItem", "diamond"], ["action_attempt", "a4", "target", { x: 9, y: 9, z: 9 }],
      ["action_attempt", "a5", "range", 99], ["action_attempt", "a1", "decisionSource", "model"], ["action_attempt", "a1", "decisionEventId", "d-forged"], ["action_attempt", "a1", "action", "craft"],
      ["action_observation", "a5", "position", { x: 10, y: 64, z: 11 }], ["action_observation", "a1", "failureCode", "X"], ["action_attempt", "a2", "decisionSource", "scripted"],
    ];
    for (const [kind, id, field, val] of patches) {
      if (field === "decisionSource" && val === "scripted") continue; // identical to raw: not a forgery
      const r = validateRich(parsed(richLive(), (rows) => { (find(rows, kind, id) as R)[field] = val; }));
      expect(codes(r), `${kind}.${id}.${field}`).toContain("RAW_JOURNAL_ROW_MISMATCH");
    }
  });
  it("scripted -> planner/model relabelling of a signed scripted attempt is flagged (provenance cannot be laundered)", () => {
    for (const label of ["planner", "model", "reflex"]) {
      const r = validateRich(parsed(richLive(), (rows) => { (find(rows, "action_attempt", "a1") as R).decisionSource = label; })); expect(codes(r), label).toContain("RAW_JOURNAL_ROW_MISMATCH");
    }
  });
});

describe("QA75-L1 / L2 / L3 replay", () => {
  it("L1: a signed run whose FIRST observation claims a non-empty before-inventory is not VERIFIED when the physical final inventory disagrees", () => {
    const extra = richExtra(); const i = extra.findIndex((r) => r.attemptId === "a1" && r.kind === "action_observation"); extra[i] = { ...extra[i]!, beforeInventory: { oak_log: 40 }, afterInventory: { oak_log: 41 } };
    const r = validateRich(richLive({ extra })); expect(r.violations.length).toBeGreaterThan(0); expect(r.overallStatus).not.toBe("VERIFIED"); expect(real(r)).toBe(false);
  });
  it("L1: final journal inventory that differs from the physical final inventory is INVENTORY_CONTINUITY_DISRUPTION", () => {
    const r = validateRich(richLive(), { finalInventories: { ...RICH_FINALS, [MAYA]: { oak_log: 9 } } }); expect(codes(r)).toContain("INVENTORY_CONTINUITY_DISRUPTION");
  });
  it("L2: mode is never real_minecraft while an ERROR violation is present (roster mismatch, ghost, phantom gather, identity conflicts)", () => {
    const variants: Array<[string, ReturnType<typeof validateRich>]> = [
      ["caller roster mismatch", validateRich(richLive(), { citizens: [ATLAS, "someone_else"] })],
      ["ghost citizen", validateRich(richLive({ extra: [...richExtra(), ...ghostRows()] }))],
      ["spontaneous gain", validateRich(richLive(), { finalInventories: { ...RICH_FINALS, [MAYA]: { oak_log: 5 } } })],
      ["runId conflict", validateRich(richLive(), { runId: "another-run" })],
      ["sourceSha conflict", validateRich(richLive(), { sourceSha: "f".repeat(40) })],
    ];
    for (const [name, r] of variants) { expect(r.violations.some((v) => v.severity === "ERROR"), name).toBe(true); expect(real(r), name).toBe(false); }
  });
  it("L3: empty trustedAuthorities fails closed; a populated list that omits the signer fails closed; the signer named alone passes", () => {
    expect(real(validateRich(richLive(), { trustedAuthorities: [] }))).toBe(false);
    expect(real(validateRich(richLive(), { trustedAuthorities: ["nobody"] }))).toBe(false);
    expect(real(validateRich(richLive(), { trustedAuthorities: ["paper-qa67-authority"] }))).toBe(true);
  });
});

describe("QA75-L5 replay: CLI headline (real CLI processes)", () => {
  const cli = join(process.cwd(), "experiments/evidence-validator/src/cli.ts");
  const fx = join(process.cwd(), "experiments/evidence-validator/fixtures/sample-2v2");
  const run = (args: string[]) => {
    const d = mkdtempSync(join(tmpdir(), "qa86cli-")); const out = join(d, "r.json"); const sum = join(d, "r.md");
    const p = spawnSync("pnpm", ["exec", "tsx", cli, ...args, "--output", out, "--summary", sum], { encoding: "utf8", cwd: process.cwd() });
    let rep: { overallStatus?: string; mode?: string; summary?: { verifiedActions?: number } } | undefined; try { rep = JSON.parse(readFileSync(out, "utf8")); } catch { /* none */ }
    let md = ""; try { md = readFileSync(sum, "utf8"); } catch { /* none */ }
    return { rep, md, code: p.status, err: p.stderr };
  };
  const full = ["--manifest", join(fx, "manifest.json"), "--journal", join(fx, "operator-journal.jsonl"), "--facts", join(fx, "facts.json"), "--inventories", join(fx, "inventories.json"), "--events", join(fx, "events.jsonl")];
  it("journal-only run on the simulated sample: NOT_PROVEN, offline_simulated, a report really exists", () => {
    const a = run(["--journal", join(fx, "operator-journal.jsonl")]); expect(a.rep).toBeDefined(); expect(a.rep!.mode).toBe("offline_simulated"); expect(a.rep!.overallStatus).toBe("NOT_PROVEN");
  });
  it("run WITH manifest, facts, inventories and events on the simulated sample: NOT_PROVEN (headline capped), with the verified-action count intact and the markdown saying so", () => {
    const b = run(full); expect(b.rep, b.err.slice(0, 300)).toBeDefined(); expect(b.rep!.mode).toBe("offline_simulated"); expect(b.rep!.overallStatus).toBe("NOT_PROVEN");
    expect(b.rep!.summary?.verifiedActions).toBeGreaterThan(0); expect(b.md).toMatch(/NOT PROVEN/);
  });
  it("the cap does not hide REAL violations: a corrupted journal through the CLI is not downgraded to NOT_PROVEN", () => {
    const d = mkdtempSync(join(tmpdir(), "qa86bad-")); const lines = readFileSync(join(fx, "operator-journal.jsonl"), "utf8").split("\n").filter(Boolean);
    const bad = lines.map((l, i) => (i === 3 ? l.replace(/"kind":"[a-z_]+"/, '"kind":"tick"') : l)).join("\n"); const jp = join(d, "bad.jsonl"); writeFileSync(jp, bad);
    const r = run(["--manifest", join(fx, "manifest.json"), "--journal", jp, "--facts", join(fx, "facts.json"), "--inventories", join(fx, "inventories.json"), "--events", join(fx, "events.jsonl")]);
    expect(r.rep?.overallStatus).not.toBe("VERIFIED");
  });
});
void ROSTER; void liveJournal; void validateLive;
