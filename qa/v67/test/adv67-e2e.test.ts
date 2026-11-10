// Decision-source preservation, caller-supplied rows vs raw lines, offline-never-becomes-Paper, and the validator CLI.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptRecorderJournal, validateExperimentEvidence } from "../../../experiments/evidence-validator/src/index.js";
import { createTestManifest } from "../../../experiments/evidence-validator/fixtures/helpers.js";
import { artDir, codes, load, runPipeline } from "../lib/pipeline.js";
import { clone, reseal, sixtyMinuteTicks, type Row } from "../lib/journal.js";
import { EXP, SHA, T0, attest, attemptObs, liveJournal, paramsFor, validateLive, key, AUTH, digestOf } from "../lib/live.js";

describe("decision source: every allowed value is preserved verbatim, every other value fails closed", () => {
  const withSource = (src: string) => {
    const e = attemptObs("gpt_atlas"); (e[0] as Record<string, unknown>).decisionSource = src;
    return liveJournal({ extra: e });
  };
  for (const src of ["scripted", "model", "planner", "reflex"]) {
    it(`'${src}' is reported as '${src}' (never translated)`, () => {
      const j = withSource(src);
      const a = adaptRecorderJournal(j.lines);
      const att = a.journalRows.find((r) => r.kind === "action_attempt") as { decisionSource?: string } | undefined;
      expect(att?.decisionSource).toBe(src);
      const r = validateExperimentEvidence({ rawJournalLines: j.lines, journalRows: a.journalRows });
      expect(r.actionVerifications[0]!.decisionSource).toBe(src);
    });
  }
  for (const bad of ["llm", "Model", "SCRIPTED", "scripted ", "", "human", "script", "model|scripted", "__proto__"]) {
    it(`unknown source ${JSON.stringify(bad)} is not accepted as an attempt and the orphaned observation is a violation`, () => {
      const j = withSource(bad);
      const a = adaptRecorderJournal(j.lines);
      expect(a.notProven.map((x) => x.code)).toContain("RECORDER_SCHEMA_MISMATCH_ATTEMPT");
      const r = validateExperimentEvidence({ rawJournalLines: j.lines, journalRows: a.journalRows });
      expect(codes(r)).toContain("UNMATCHED_ACTION_OBSERVATION");
    });
  }
  it("a mixed journal keeps genuine 'model' rows distinct from 'scripted' rows in the same report", () => {
    const e = [...attemptObs("gpt_atlas")];
    const a2 = clone(e[0]!), o2 = clone(e[1]!); a2.attemptId = o2.attemptId = "att-2"; a2.decisionSource = "model"; o2.beforeInventory = { oak_log: 1 }; o2.afterInventory = { oak_log: 2 };
    const j = liveJournal({ extra: [...e, a2, o2] });
    const ad = adaptRecorderJournal(j.lines);
    const r = validateExperimentEvidence({ rawJournalLines: j.lines, journalRows: ad.journalRows });
    expect(r.actionVerifications.map((v) => v.decisionSource)).toEqual(["scripted", "model"]);
  });
  it("extra provenance-looking fields on an attempt (e.g. isGenuineModel/provider) are not honoured: they are dropped or rejected, never promoted", () => {
    const e = attemptObs("gpt_atlas"); (e[0] as Record<string, unknown>).isGenuineModel = true; (e[0] as Record<string, unknown>).provider = "openai";
    const j = liveJournal({ extra: e });
    const a = adaptRecorderJournal(j.lines);
    const r = validateExperimentEvidence({ rawJournalLines: j.lines, journalRows: a.journalRows });
    expect(JSON.stringify(r)).not.toMatch(/isGenuineModel|openai/);
  });
});

describe("caller-supplied rows vs raw lines (library API integrity)", () => {
  it("[QA67-M4] journalRows that do not correspond to rawJournalLines are rejected (forged rows + genuine chain)", () => {
    const L = load(artDir("cand", "scenario-2"));
    const rows = clone(L.rows);
    const o = rows.find((x) => x.kind === "action_observation")!; o.afterInventory = { oak_log: 99 };
    const r = validateExperimentEvidence({ rawJournalLines: L.rawText.split(/\r?\n/).filter(Boolean), journalRows: rows as never });
    console.log("DECOUPLED_ROWS hashChainValid=", r.summary.hashChainValid, "status=", r.overallStatus, "violations=", codes(r));
    expect(codes(r).length).toBeGreaterThan(0);
  });
  it("[QA67-M4] genuine 2-minute /tick-sprint capture (signed) + journalRows whose timestamps are stretched to 60 minutes is not real_minecraft", () => {
    const fast = liveJournal({ ticks: sixtyMinuteTicks(T0, 5000, 1200, 2000, 61) }); // 72,000 ticks in 2 min
    const att = attest(paramsFor(fast, { endedAt: new Date(T0 + 120_000).toISOString() })); // honest signer: it attested 2 minutes
    const stretched = clone(fast.rows);
    const spread = (3600_000) / (stretched.length - 1);
    stretched.forEach((r, i) => { r.at = new Date(T0 + Math.round(i * spread)).toISOString(); });
    const r = validateLive({ ...fast, rows: stretched }, att);
    console.log("TICK_SPRINT_DECOUPLED mode=", r.mode, "status=", r.overallStatus, "hashChainValid=", r.summary.hashChainValid, r.durationAudit.reasons.slice(0, 3));
    expect(r.mode).not.toBe("real_minecraft");
  });
});

describe("simulated offline results stay NOT PROVEN for genuine Paper execution", () => {
  const L = load(artDir("cand", "scenario-4"));
  it("a VALID signature over the offline scripted journal still cannot reach real_minecraft (no server ticks)", () => {
    const lines = L.rawText.split(/\r?\n/).filter(Boolean);
    const att = attest({ experimentId: "off4", captureSessionId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", serverBuild: 142, serverVersion: "1.21.6", sourceSha: L.rows[0]!.sourceSha as string,
      evidenceDigest: digestOf(lines), startedAt: "2026-11-05T12:00:00.000Z", endedAt: "2026-11-05T13:00:00.000Z", firstServerTick: 0, lastServerTick: 0, totalServerTicks: 0 });
    const ad = adaptRecorderJournal(lines);
    const r = validateExperimentEvidence({ manifest: createTestManifest({ experimentId: "off4", sourceSha: L.rows[0]!.sourceSha as string, durationMinutes: 60 }), rawJournalLines: lines,
      journalRows: ad.journalRows, sourceAttestation: att as never, trustedKeys: { [AUTH]: key.publicPem }, sourceSha: L.rows[0]!.sourceSha as string, experimentId: "off4" });
    expect(r.mode).not.toBe("real_minecraft");
    expect(r.durationAudit.serverTickProven).toBe(false);
  });
  it("an 'offline_simulated' / 'unverified_client' attestation type cannot be promoted, even with a perfect tick series", () => {
    const l = liveJournal();
    for (const sourceType of ["offline_simulated", "unverified_client", "paper_server_attested_v2", ""]) {
      const r = validateLive(l, { ...attest(paramsFor(l)), sourceType });
      expect(r.mode, sourceType).not.toBe("real_minecraft");
    }
  });
  it("the shipped offline report always carries UNPROVEN_PAPER_AUTHENTICITY and a 'missing' attestation, and is never VERIFIED", () => {
    for (const s of ["scenario-2", "scenario-4"] as const) {
      const r = runPipeline(load(artDir("cand", s)));
      expect(r.overallStatus).toBe("NOT_PROVEN");
      expect(r.notProven.some((x) => x.code === "UNPROVEN_PAPER_AUTHENTICITY")).toBe(true);
      expect(r.mode).toBe("offline_simulated");
    }
  });
  it("a bundle that pretends to be live ('live' in runRoot / mode live in start row) still cannot become real_minecraft without attestation", () => {
    const rows = clone(L.rows); rows[0]!.mode = "live";
    const r = runPipeline(L, { rows });
    expect(r.mode).toBe("offline_simulated");
    expect(r.overallStatus).not.toBe("VERIFIED");
  });
});

describe("validator CLI on genuine and tampered journals", () => {
  const L = load(artDir("cand", "scenario-2"));
  const cli = join(process.cwd(), "experiments/evidence-validator/src/cli.ts");
  const run = (lines: string[], extra: string[] = []) => {
    const d = mkdtempSync(join(tmpdir(), "qa67cli-"));
    const j = join(d, "j.jsonl"), out = join(d, "r.json");
    writeFileSync(j, lines.join("\n") + "\n");
    const p = spawnSync("pnpm", ["exec", "tsx", cli, "--journal", j, "--output", out, ...extra], { encoding: "utf8", cwd: process.cwd() });
    let rep: Record<string, unknown> | null = null; try { rep = JSON.parse(readFileSync(out, "utf8")); } catch { /* no report */ }
    return { code: p.status, rep: rep as { mode?: string; sourceAttestationAudit?: { sourceType?: string }; durationAudit?: { serverTickProven?: boolean }; summary?: { hashChainValid?: boolean }; violations?: Array<{ code: string }>; actionVerifications?: Array<{ decisionSource?: string }>; overallStatus?: string } | null, err: p.stderr };
  };
  it("genuine scripted journal: simulated mode, no attestation, no proven ticks, hash chain valid, scripted preserved", () => {
    const lines = L.rawText.split(/\r?\n/).filter(Boolean);
    const a = run(lines);
    expect(a.rep).not.toBeNull();
    expect(a.rep?.mode).toBe("offline_simulated");
    expect(a.rep?.sourceAttestationAudit?.sourceType).toBe("missing");
    expect(a.rep?.durationAudit?.serverTickProven).toBe(false);
    expect(a.rep?.summary?.hashChainValid).toBe(true);
    expect(a.rep?.violations).toEqual([]);
    expect(a.rep?.actionVerifications?.map((v) => v.decisionSource).filter((x) => x === "scripted").length).toBe(4);
  });
  it("[QA67-L5] the CLI headline status for a simulated, unattested journal is not VERIFIED (it must stay NOT PROVEN for Paper execution)", () => {
    const lines = L.rawText.split(/\r?\n/).filter(Boolean);
    const a = run(lines), s = run(lines, ["--strict"]);
    console.log("CLI_GENUINE_OFFLINE status=", a.rep?.overallStatus, "mode=", a.rep?.mode, "strictExit=", s.code);
    expect(a.rep?.overallStatus).not.toBe("VERIFIED");
  });
  it("tampered journal: hash-chain violation reported", () => {
    const lines = L.rawText.split(/\r?\n/).filter(Boolean);
    lines[4] = lines[4]!.replace('"oak_log":1', '"oak_log":5');
    const a = run(lines);
    expect(a.rep?.overallStatus).toBe("VIOLATIONS_DETECTED");
    expect(a.rep?.violations?.map((v) => v.code)).toContain("CORRUPTED_HASH_CHAIN");
  });
});
void reseal; void EXP; void SHA; void ({} as Row);
