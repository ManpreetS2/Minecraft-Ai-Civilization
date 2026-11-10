// Scripted-decision provenance, attempt/observation mapping, inventory reconciliation and journal tampering,
// driven through the SHIPPED offline integration path on genuine scenario output (2 and 4 citizens).
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { artDir, attempts, codes, load, observations, runPipeline } from "../lib/pipeline.js";
import { clone, reseal, type Row } from "../lib/journal.js";

const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

for (const scenario of ["scenario-2", "scenario-4"] as const) {
  const n = scenario === "scenario-2" ? 2 : 4;
  describe(`genuine offline ${n}-citizen journal (${scenario})`, () => {
    const L = load(artDir("cand", scenario));
    const at = attempts(L.rows), ob = observations(L.rows);

    it("baseline: NOT_PROVEN, no violations, hash chain valid, never real_minecraft, no Paper attestation", () => {
      const r = runPipeline(L);
      expect(r.overallStatus).toBe("NOT_PROVEN");
      expect(r.violations).toEqual([]);
      expect(r.summary.hashChainValid).toBe(true);
      expect(r.mode).toBe("offline_simulated");
      expect(r.sourceAttestationAudit?.sourceType).toBe("missing");
      expect(r.sourceAttestationAudit?.proven).toBe(false);
      expect(r.durationAudit.serverTickProven).toBe(false);
      expect(r.notProven.map((x) => x.code)).toContain("UNPROVEN_PAPER_AUTHENTICITY");
      expect(r.notProven.map((x) => x.code)).toContain("RECORDER_GAP_SERVER_GAME_TICK");
      expect(r.summary.verifiedActions).toBe(3 * n);
      expect(r.summary.notProvenChecksCount).toBe(r.notProven.length);
    });

    it("scripted stays scripted; planner stays planner; nothing is relabelled 'model' anywhere in rows, report or bundle", () => {
      const r = runPipeline(L);
      const bySource = (rows: Row[]) => Object.fromEntries(rows.map((x) => [x.attemptId as string, x.decisionSource as string]));
      const rep = Object.fromEntries(r.actionVerifications.map((v) => [v.attemptId, v.decisionSource]));
      expect(rep).toEqual(bySource(at));
      const counts = at.reduce<Record<string, number>>((m, x) => ((m[x.decisionSource as string] = (m[x.decisionSource as string] ?? 0) + 1), m), {});
      expect(counts).toEqual({ planner: n, scripted: 2 * n });
      expect(JSON.stringify(r)).not.toMatch(/"decisionSource":"model"/);
      expect(L.rawText).not.toMatch(/"decisionSource":"model"/);
      expect(JSON.stringify(L.bundle)).not.toMatch(/"decisionSource":"model"/);
      expect(L.rows[0]!.decisionTransport).toBe("scripted-in-process");
    });

    it("every observation maps to exactly one EARLIER attempt of the SAME citizen (independent recomputation from the raw journal)", () => {
      const seen = new Map<string, Row>();
      for (const row of L.rows) {
        if (row.kind === "action_attempt") { expect(seen.has(row.attemptId as string)).toBe(false); seen.set(row.attemptId as string, row); }
        if (row.kind === "action_observation") {
          const a = seen.get(row.attemptId as string);
          expect(a, String(row.attemptId)).toBeDefined();
          expect(a!.citizenId).toBe(row.citizenId);
          expect(a!.seq as number).toBeLessThan(row.seq);
          seen.delete(row.attemptId as string);
        }
      }
      expect(seen.size).toBe(0);
      expect(at.length).toBe(ob.length);
      const r = runPipeline(L);
      expect(r.actionVerifications.map((v) => v.attemptId).sort()).toEqual(ob.map((x) => x.attemptId as string).sort());
    });

    it("journal attempt ids == bundle action attempt ids (second source) and every action has a source receipt", () => {
      expect(new Set((L.bundle.actions as Array<{ attemptId: string }>).map((a) => a.attemptId))).toEqual(new Set(at.map((x) => x.attemptId)));
      for (const a of (L.bundle.actions as Array<{ receiptId: string }>)) expect(a.receiptId).toBeTruthy();
    });

    it("inventory: sum of per-observation deltas == independent final inventory == validator ledger; deltas are per-operation +1", () => {
      const sum: Record<string, number> = {};
      const last: Record<string, number> = {};
      for (const o of ob) {
        const b = (o.beforeInventory as Record<string, number>).oak_log ?? 0, a = (o.afterInventory as Record<string, number>).oak_log ?? 0;
        expect(a - b).toBe(1);
        expect(b).toBe(last[o.citizenId as string] ?? 0); // continuity on the genuine journal
        last[o.citizenId as string] = a;
        sum[o.citizenId as string] = (sum[o.citizenId as string] ?? 0) + (a - b);
      }
      for (const [c, v] of Object.entries(sum)) expect(L.finals[c]!.oak_log).toBe(v);
      const r = runPipeline(L);
      expect(r.inventoryAudit.totalItemsAcquired.oak_log).toBe(3 * n);
      expect(r.inventoryAudit.discrepancies).toEqual([]);
    });

    it("report identity: source SHA == HEAD == journal start == bundle; runId/citizens consistent", () => {
      const r = runPipeline(L);
      expect(r.sourceAttestationAudit?.sourceType).toBe("missing");
      expect(r.sourceSha).toBe(HEAD);
      expect(L.rows[0]!.sourceSha).toBe(HEAD);
      expect(L.bundle.sourceSha).toBe(HEAD);
      expect(r.attribution.runId).toBe(L.rows[0]!.runId);
      expect(r.attribution.citizens).toEqual(L.rows[0]!.citizens);
    });

    it("[QA67-L4] the report's experimentId is the journal's experimentId (every journal row says one thing; the report must not say another)", () => {
      const r = runPipeline(L);
      console.log("REPORT_EXPERIMENT_ID", r.experimentId, "JOURNAL_EXPERIMENT_ID", L.rows[0]!.experimentId, "RUN_ID", L.rows[0]!.runId);
      expect(r.experimentId).toBe(L.rows[0]!.experimentId);
    });

    // ---------------- missing / forged / reordered / duplicated / tampered ----------------
    const mutate = (f: (rows: Row[]) => Row[] | void) => { const rows = clone(L.rows); const out = f(rows) ?? rows; return runPipeline(L, { rows: out }); };
    const idx = (rows: Row[], kind: string, source: string, nth = 0) => rows.map((r, i) => [r, i] as const).filter(([r]) => r.kind === kind && r.decisionSource === source)[nth]![1];

    it("closure is not by hiding: deleting a scripted ATTEMPT (observation kept) is a violation", () => {
      const r = mutate((rows) => { rows.splice(idx(rows, "action_attempt", "scripted"), 1); });
      expect(r.overallStatus).toBe("VIOLATIONS_DETECTED");
      expect(codes(r)).toContain("UNMATCHED_ACTION_OBSERVATION");
    });
    it("deleting a scripted OBSERVATION (attempt kept) cannot yield a clean NOT_PROVEN: the missing gain must surface", () => {
      const r = mutate((rows) => { const i = idx(rows, "action_attempt", "scripted"); const a = rows[i]!; const j = rows.findIndex((x) => x.kind === "action_observation" && x.attemptId === a.attemptId); rows.splice(j, 1); });
      expect(r.notProven.map((x) => x.code)).toContain("INCOMPLETE_ACTION_ATTEMPT");
      expect(codes(r)).toContain("SPONTANEOUS_GAIN");
    });
    it("a forged attempt with no observation is surfaced as unproven", () => {
      const r = mutate((rows) => { const a = clone(rows[idx(rows, "action_attempt", "scripted")]!); a.attemptId = "forged-1"; rows.splice(rows.length - 1, 0, a); });
      expect(r.notProven.some((x) => x.code === "INCOMPLETE_ACTION_ATTEMPT" && x.description.includes("forged-1"))).toBe(true);
    });
    it("[QA67-M7] a forged attempt+observation for a citizen NOT in the roster is flagged", () => {
      const r = mutate((rows) => {
        const a = clone(rows[idx(rows, "action_attempt", "scripted")]!); a.attemptId = "ghost-1"; a.citizenId = "ghost";
        const o = clone(rows[rows.findIndex((x) => x.kind === "action_observation")]!); o.attemptId = "ghost-1"; o.citizenId = "ghost";
        rows.splice(rows.length - 1, 0, a, o);
      });
      const flagged = codes(r).includes("PHANTOM_CITIZEN_ACTION") || codes(r).includes("SPONTANEOUS_GAIN");
      console.log("GHOST_CITIZEN codes=", codes(r), "status=", r.overallStatus);
      expect(flagged).toBe(true);
    });
    it("[QA67-M7] a forged self-consistent extra gather (+1 log) that the citizen's physical final inventory does not contain is flagged (ledger 4 vs inventory 3)", () => {
      const r = mutate((rows) => {
        const c = rows.find((x) => x.kind === "action_attempt")!.citizenId as string;
        const a = clone(rows[idx(rows, "action_attempt", "scripted")]!); a.attemptId = "forged-gain"; a.citizenId = c;
        const o = clone(rows.find((x) => x.kind === "action_observation" && x.citizenId === c)!); o.attemptId = "forged-gain"; o.beforeInventory = { oak_log: 3 }; o.afterInventory = { oak_log: 4 };
        rows.splice(rows.length - 1, 0, a, o);
      });
      console.log("FORGED_EXTRA_GATHER status=", r.overallStatus, "codes=", codes(r));
      expect(codes(r).length).toBeGreaterThan(0);
    });
    it("[QA67-M7] an observation whose before-inventory does not continue the citizen's previous after-inventory is flagged (no teleporting inventories)", () => {
      const r = mutate((rows) => { const o = rows.filter((x) => x.kind === "action_observation")[0]!; o.beforeInventory = { oak_log: 40 }; o.afterInventory = { oak_log: 41 }; });
      console.log("INVENTORY_DISCONTINUITY status=", r.overallStatus, "codes=", codes(r));
      expect(codes(r).length).toBeGreaterThan(0);
    });
    it("[QA67-M6] relabelling a scripted attempt 'model' while the start row says decisionTransport=scripted-in-process is a contradiction and must be flagged", () => {
      const r = mutate((rows) => { rows[idx(rows, "action_attempt", "scripted")]!.decisionSource = "model"; });
      console.log("RELABEL_MODEL status=", r.overallStatus, "codes=", codes(r), "sources=", [...new Set(r.actionVerifications.map((v) => v.decisionSource))]);
      expect(codes(r).length).toBeGreaterThan(0);
    });
    it("reordering: an observation moved BEFORE its attempt is a violation", () => {
      const r = mutate((rows) => { const i = idx(rows, "action_attempt", "scripted"); const j = rows.findIndex((x) => x.kind === "action_observation" && x.attemptId === rows[i]!.attemptId); const [o] = rows.splice(j, 1); rows.splice(i, 0, o!); });
      expect(codes(r)).toContain("UNMATCHED_ACTION_OBSERVATION");
    });
    it("duplicate attempt row => DUPLICATE_ATTEMPT_ID; duplicate observation row => UNMATCHED_ACTION_OBSERVATION", () => {
      const r1 = mutate((rows) => { const i = idx(rows, "action_attempt", "scripted"); rows.splice(i + 1, 0, clone(rows[i]!)); });
      expect(codes(r1)).toContain("DUPLICATE_ATTEMPT_ID");
      const r2 = mutate((rows) => { const j = rows.findIndex((x) => x.kind === "action_observation"); rows.splice(j + 1, 0, clone(rows[j]!)); });
      expect(codes(r2)).toContain("UNMATCHED_ACTION_OBSERVATION");
    });
    it("cross-actor: an observation attributed to a different citizen than its attempt is CORRUPTED", () => {
      const r = mutate((rows) => { const o = rows.find((x) => x.kind === "action_observation")!; o.citizenId = rows.find((x) => x.kind === "action_attempt" && x.citizenId !== o.citizenId)!.citizenId; });
      expect(codes(r)).toContain("CORRUPTED_ACTION_EVIDENCE");
    });
    it("[QA67-L1] an observation timestamped BEFORE its attempt is a violation (anachronism)", () => {
      const r = mutate((rows) => { const o = rows.find((x) => x.kind === "action_observation")!; o.at = "2000-01-01T00:00:00.000Z"; });
      console.log("ANACHRONISM status=", r.overallStatus, "codes=", codes(r), "verified=", r.summary.verifiedActions, "reasons=", r.actionVerifications.flatMap((v) => v.reasons).slice(0, 1));
      expect(codes(r).length).toBeGreaterThan(0);
    });
    it("tampering WITHOUT re-sealing (edit field / delete row / swap rows / truncate-and-append / drop seq) => CORRUPTED_HASH_CHAIN", () => {
      const edits: Array<[string, (rows: Row[]) => Row[]]> = [
        ["edit afterInventory", (rows) => { (rows.find((x) => x.kind === "action_observation")!.afterInventory as Record<string, number>).oak_log = 9; return rows; }],
        ["edit decisionSource", (rows) => { rows.find((x) => x.kind === "action_attempt" && x.decisionSource === "scripted")!.decisionSource = "model"; return rows; }],
        ["delete row", (rows) => { rows.splice(4, 1); return rows; }],
        ["swap rows", (rows) => { [rows[3], rows[4]] = [rows[4]!, rows[3]!]; return rows; }],
        ["append unsealed row", (rows) => { rows.push({ ...clone(rows[rows.length - 1]!), seq: rows.length + 1 }); return rows; }],
        ["rewrite start sha", (rows) => { rows[0]!.sourceSha = "f".repeat(40); return rows; }],
      ];
      for (const [name, f] of edits) {
        const r = runPipeline(L, { rows: f(clone(L.rows)), seal: false });
        expect(codes(r), name).toContain("CORRUPTED_HASH_CHAIN");
        expect(r.overallStatus, name).toBe("VIOLATIONS_DETECTED");
      }
    });
    it("tail truncation keeps a valid chain prefix but must not look complete: dropping the last observation surfaces an incomplete attempt and a gain mismatch", () => {
      const rows = clone(L.rows);
      const lastObs = [...rows].map((r, i) => [r, i] as const).filter(([r]) => r.kind === "action_observation").pop()![1];
      const r = runPipeline(L, { rows: rows.slice(0, lastObs), seal: false });
      expect(r.summary.hashChainValid).toBe(true);
      expect(r.notProven.map((x) => x.code)).toContain("INCOMPLETE_ACTION_ATTEMPT");
      expect(codes(r)).toContain("SPONTANEOUS_GAIN");
    });
    it("a recomputed (re-sealed) chain is accepted as VALID by design: hash chain alone is not authentication (offline result stays NOT_PROVEN, never VERIFIED)", () => {
      const r = mutate((rows) => { rows[0]!.recordingAudience = "operator_only"; });
      expect(r.summary.hashChainValid).toBe(true);
      expect(r.overallStatus).not.toBe("VERIFIED");
      expect(r.mode).toBe("offline_simulated");
    });
  });
}
void reseal;
