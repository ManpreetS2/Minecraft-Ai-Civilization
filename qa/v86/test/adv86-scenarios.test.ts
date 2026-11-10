// Real offline scenarios at the exact candidate SHA, verified from the ORIGINAL source artifacts (operator.jsonl, manifest.json,
// receipts) by recomputation that does not call the validator.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { artDir, load, runPipeline, attempts } from "../lib/pipeline.js";
import { clone, type Row } from "../lib/journal.js";

const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
for (const [name, n] of [["scenario-2", 2], ["scenario-4", 4]] as const) {
  describe(`${name} (${n === 2 ? "1v1" : "2v2"}) from raw artifacts`, () => {
    const L = load(artDir("cand", name));
    const rows = L.rows as Array<Record<string, unknown>>;
    const att = rows.filter((r) => r.kind === "action_attempt"), obs = rows.filter((r) => r.kind === "action_observation") as Array<Record<string, unknown> & { citizenId: string; afterInventory: Record<string, number>; beforeInventory: Record<string, number> }>;
    it(`${3 * n} distinct attempts and ${3 * n} matching observations, one per attempt, same citizen, attempt first`, () => {
      expect(att.length).toBe(3 * n); expect(obs.length).toBe(3 * n);
      expect(new Set(att.map((a) => a.attemptId)).size).toBe(3 * n);
      for (const o of obs) { const a = att.find((x) => x.attemptId === o.attemptId)!; expect(a).toBeDefined(); expect(a.citizenId).toBe(o.citizenId); expect(a.seq).toBeLessThan(o.seq as number); }
    });
    it("per-citizen inventory is exactly 3 oak_log, derived three independent ways (observations, bundle actions, physical finals)", () => {
      const ids = (L.rows[0] as Record<string, unknown>).citizens as string[]; expect(ids.length).toBe(n);
      for (const id of ids) {
        const deltas = obs.filter((o) => o.citizenId === id).map((o) => (o.afterInventory.oak_log ?? 0) - (o.beforeInventory.oak_log ?? 0));
        expect(deltas).toEqual([1, 1, 1]);
        const bundle = (L.bundle.actions as Array<Record<string, unknown>>).filter((a) => a.citizenId === id).reduce((s, a) => s + ((a.inventoryDelta as Record<string, number> | undefined)?.oak_log ?? 0), 0);
        expect(bundle).toBe(3); expect(L.finals[id]!.oak_log).toBe(3);
      }
    });
    it("scripted stays scripted (2 per citizen), one planner per citizen, zero 'model' anywhere in the source artifacts", () => {
      const by = (s: string) => att.filter((a) => a.decisionSource === s).length;
      expect([by("scripted"), by("planner"), by("model"), by("reflex")]).toEqual([2 * n, n, 0, 0]);
      for (const f of readdirSync(L.dir)) if (/\.(json|jsonl|md)$/.test(f)) expect(readFileSync(join(L.dir, f), "utf8"), f).not.toMatch(/"decisionSource":\s*"model"/);
      expect((rows[0] as Record<string, unknown>).decisionTransport).toBe("scripted-in-process");
    });
    it("identity: source SHA is the exact candidate HEAD in journal start, bundle and report", () => {
      expect(rows[0]!.sourceSha).toBe(HEAD); expect(L.bundle.sourceSha).toBe(HEAD); expect((L.report as Record<string, unknown>).sourceSha).toBe(HEAD);
      expect((L.report as Record<string, unknown>).experimentId).toBe(rows[0]!.experimentId);
    });
    it("authentic Paper execution is NOT PROVEN: no attestation, no server ticks, NOT_PROVEN, simulated mode, no violations", () => {
      const r = L.report as Record<string, unknown> & { overallStatus: string; mode: string; violations: unknown[]; sourceAttestationAudit: { sourceType: string }; durationAudit: { serverTickProven: boolean }; notProven: Array<{ code: string }>; inventoryAudit: { discrepancies: unknown[] } };
      expect(r.overallStatus).toBe("NOT_PROVEN"); expect(r.mode).toBe("offline_simulated"); expect(r.violations).toEqual([]);
      expect(r.sourceAttestationAudit.sourceType).toBe("missing"); expect(r.durationAudit.serverTickProven).toBe(false);
      expect(r.notProven.map((x: { code: string }) => x.code)).toContain("UNPROVEN_PAPER_AUTHENTICITY");
      expect(r.inventoryAudit.discrepancies).toEqual([]);
      for (const t of rows.filter((x) => x.kind === "tick")) expect(t.serverGameTick).toBeNull();
    });
  });
}

describe("scenarios recomputed through the SHIPPED integration path and tampering", () => {
  for (const [name, n] of [["scenario-2", 2], ["scenario-4", 4]] as const) {
    const L = load(artDir("cand", name));
    it(`${name}: re-running the shipped report path on the ORIGINAL journal reproduces NOT_PROVEN / offline_simulated / 0 violations and ${3 * n} verified actions`, () => {
      const r = runPipeline(L) as unknown as { overallStatus: string; mode: string; violations: unknown[]; summary: { verifiedActions: number; totalAttemptedActions: number } };
      expect(r.overallStatus).toBe("NOT_PROVEN"); expect(r.mode).toBe("offline_simulated"); expect(r.violations).toEqual([]);
      expect(r.summary.verifiedActions).toBe(3 * n); expect(r.summary.totalAttemptedActions).toBe(3 * n);
    });
    it(`${name}: a re-sealed phantom gather (inventory raised without evidence) is flagged, and the headline never becomes VERIFIED`, () => {
      const rows = clone(L.rows) as Row[]; const o = rows.find((r) => r.kind === "action_observation") as Row; (o.afterInventory as Record<string, number>).oak_log = 9;
      const r = runPipeline(L, { rows }) as unknown as { overallStatus: string; mode: string; violations: unknown[] };
      expect(r.violations.length).toBeGreaterThan(0); expect(r.overallStatus).not.toBe("VERIFIED"); expect(r.mode).toBe("offline_simulated");
    });
    it(`${name}: relabelling one scripted attempt as 'model' in a re-sealed journal never yields a report with a model-attributed VERIFIED headline`, () => {
      const rows = clone(L.rows) as Row[]; (attempts(rows)[0] as Row).decisionSource = "model";
      const r = runPipeline(L, { rows }) as unknown as { overallStatus: string; mode: string };
      expect(r.mode).toBe("offline_simulated"); expect(r.overallStatus).not.toBe("VERIFIED");
    });
    it(`${name}: a bundle-supplied attestation is never honoured by the shipped offline path (no trust root there): still offline_simulated`, () => {
      const bundle = { ...L.bundle, sourceAttestation: { sourceType: "paper_server_attested", signingAuthority: "x", signature: "ed25519:" + "00".repeat(64) } };
      const r = runPipeline(L, { bundle: bundle as never }) as unknown as { mode: string; overallStatus: string };
      expect(r.mode).toBe("offline_simulated"); expect(r.overallStatus).not.toBe("VERIFIED");
    });
  }
});
