// Run / source / experiment / roster identity: introduce contradictions between manifest, caller input, journal start row,
// per-row experimentId, attestation and report attribution. A contradiction must never be silently resolved.
import { describe, expect, it } from "vitest";
import { createTestManifest } from "../../../experiments/evidence-validator/fixtures/helpers.js";
import { validateExperimentEvidence } from "../../../experiments/evidence-validator/src/index.js";
import { artDir, codes, load, runPipeline } from "../lib/pipeline.js";
import { clone, type Row } from "../lib/journal.js";
import { EXP, SHA, attest, liveJournal, paramsFor, validateLive, AUTH, key, attemptObs } from "../lib/live.js";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);

/** "Silent" = no finding (violation or not-proven item) exists that the consistent control did not already have. */
function flagged(r: ReturnType<typeof validateExperimentEvidence>, control: ReturnType<typeof validateExperimentEvidence>) {
  const key = (x: { code: string; description: string }) => `${x.code}|${x.description}`;
  const ctl = new Set([...control.notProven.map(key), ...control.violations.map(key)]);
  return [...r.notProven, ...r.violations].some((x) => !ctl.has(key(x)));
}

describe("shipped offline pipeline (real scenario-2 journal): conflicting identities", () => {
  const L = load(artDir("cand", "scenario-2"));
  const control = runPipeline(L);
  const run = (o: { rows?: Row[]; bundle?: Record<string, unknown> }) => runPipeline(L, o);
  const withStart = (f: (s: Row) => void) => { const rows = clone(L.rows); f(rows[0]!); return rows; };
  const withBundle = (f: (b: Record<string, unknown>) => void) => { const b = clone(L.bundle) as Record<string, unknown>; f(b); return b; };

  it("control is clean and reports the journal's source SHA", () => {
    expect(control.sourceSha).toBe(L.rows[0]!.sourceSha);
    expect(control.violations).toEqual([]);
  });
  it("[QA67-M1] bundle.sourceSha != journal start.sourceSha is flagged", () => {
    const r = run({ bundle: withBundle((b) => { b.sourceSha = A; }) });
    console.log("ID bundleSha!=startSha  report.sourceSha=", r.sourceSha, "flagged=", flagged(r, control));
    expect(flagged(r, control)).toBe(true);
  });
  it("[QA67-M1] journal start.sourceSha != bundle.sourceSha (journal edited, chain re-sealed) is flagged", () => {
    const r = run({ rows: withStart((s) => { s.sourceSha = A; }) });
    console.log("ID startSha!=bundleSha  report.sourceSha=", r.sourceSha, "flagged=", flagged(r, control));
    expect(flagged(r, control)).toBe(true);
  });
  it("[QA67-M1] bundle.runId != journal start.runId is flagged", () => {
    const r = run({ bundle: withBundle((b) => { b.runId = "fixture-9-other"; }) });
    console.log("ID bundleRun!=startRun  report.runId=", r.attribution.runId, "flagged=", flagged(r, control));
    expect(flagged(r, control)).toBe(true);
  });
  it("[QA67-M1] journal start.runId != bundle.runId (re-sealed) is flagged", () => {
    const r = run({ rows: withStart((s) => { s.runId = "fixture-9-other"; }) });
    console.log("ID startRun!=bundleRun  report.runId=", r.attribution.runId, "flagged=", flagged(r, control));
    expect(flagged(r, control)).toBe(true);
  });
  it("[QA67-M1] a journal whose rows carry DIFFERENT experimentIds mid-stream (spliced run, re-sealed) is flagged", () => {
    const rows = clone(L.rows);
    for (let i = 5; i < rows.length; i++) rows[i]!.experimentId = "some-other-run";
    const r = run({ rows });
    console.log("ID mixed row experimentId flagged=", flagged(r, control));
    expect(flagged(r, control)).toBe(true);
  });
  it("[QA67-M1] a second 'start' row carrying another sourceSha/runId (re-sealed injection) is flagged", () => {
    const rows = clone(L.rows);
    const s2 = clone(rows[0]!); s2.sourceSha = B; s2.runId = "evil-run";
    rows.splice(3, 0, s2);
    const r = run({ rows });
    console.log("ID second start row report.sourceSha=", r.sourceSha, "flagged=", flagged(r, control));
    expect(flagged(r, control)).toBe(true);
  });
  it("[QA67-M1] journal start.citizens != bundle citizens (a ghost roster entry) is flagged", () => {
    const r = run({ rows: withStart((s) => { s.citizens = [...(s.citizens as string[]), "ghost"]; }) });
    console.log("ID roster ghost in start  report.citizens=", r.attribution.citizens, "flagged=", flagged(r, control));
    expect(flagged(r, control)).toBe(true);
  });
  it("bundle citizens != journal start.citizens (citizen dropped from the bundle) is flagged (by the bridge, as a missing-evidence item)", () => {
    const r = run({ bundle: withBundle((b) => { b.citizens = b.citizens.slice(0, 1); }) });
    console.log("ID bundle drops citizen  report.citizens=", r.attribution.citizens, "flagged=", flagged(r, control));
    expect(flagged(r, control)).toBe(true);
  });
  it("[QA67-M1] report.attribution.citizens equals the journal's own roster, not a different caller roster", () => {
    const r = run({ bundle: withBundle((b) => { b.citizens = b.citizens.slice().reverse(); }) });
    expect(r.attribution.citizens).toEqual(L.rows[0]!.citizens);
  });
  it("a malformed (non-40-hex / uppercase) bundle sourceSha must not silently fall back to the journal's value", () => {
    const r = run({ bundle: withBundle((b) => { b.sourceSha = A.toUpperCase(); }) });
    console.log("ID malformed bundle sha  report.sourceSha=", r.sourceSha, "flagged=", flagged(r, control), codes(r));
    expect(flagged(r, control) || r.sourceSha !== L.rows[0]!.sourceSha).toBe(true);
  });
});

describe("library API (validateExperimentEvidence): precedence of conflicting inputs", () => {
  const j = liveJournal({ sourceSha: A, runId: "run-start", citizens: ["gpt_atlas"], extra: attemptObs("gpt_atlas") });
  const manifestA = createTestManifest({ experimentId: EXP, sourceSha: A, durationMinutes: 60 });
  const base = { manifest: manifestA, rawJournalLines: j.lines, journalRows: j.rows as never };
  const control = validateExperimentEvidence(base as never);

  it("control: consistent manifest/start row/caller", () => {
    const r = validateExperimentEvidence({ ...base, sourceSha: A, runId: "run-start", experimentId: EXP } as never);
    expect(r.sourceSha).toBe(A);
  });
  for (const [name, input, field] of [
    ["caller sourceSha B vs manifest A vs start A", { sourceSha: B }, "sourceSha"],
    ["manifest sourceSha B vs start A (no caller)", { manifest: createTestManifest({ experimentId: EXP, sourceSha: B, durationMinutes: 60 }) }, "sourceSha"],
    ["caller experimentId vs manifest/start experimentId", { experimentId: "something-else" }, "experimentId"],
    ["caller runId vs start runId", { runId: "another-run" }, "runId"],
    ["caller citizens vs start citizens vs manifest roster", { citizens: ["x", "y"] }, "citizens"],
  ] as const) {
    it(`[QA67-M1] ${name} is flagged, not silently resolved`, () => {
      const r = validateExperimentEvidence({ ...base, ...input } as never);
      console.log("LIB", name, "->", JSON.stringify({ sha: r.sourceSha.slice(0, 6), exp: r.experimentId, run: r.attribution.runId, cit: r.attribution.citizens }), "flagged=", flagged(r, control));
      expect(flagged(r, control), field).toBe(true);
    });
  }
  it("[QA67-M1] an invalid caller sourceSha (39 hex / uppercase) is reported, not silently ignored in favour of the manifest", () => {
    for (const bad of [A.slice(1), A.toUpperCase(), "unknown", "0".repeat(40)]) {
      const r = validateExperimentEvidence({ ...base, sourceSha: bad } as never);
      console.log("LIB invalid caller sha", JSON.stringify(bad.slice(0, 8)), "->", r.sourceSha.slice(0, 8), "flagged=", flagged(r, control));
      expect(flagged(r, control), bad).toBe(true);
    }
  });
  it("a valid-looking zero SHA placeholder still appears when NO source identity is available (documented residual)", () => {
    const j2 = liveJournal({ sourceSha: undefined as never });
    const rows = (j2.rows as Row[]).map((r) => { const c = clone(r); delete (c as Record<string, unknown>).sourceSha; return c; });
    const r = validateExperimentEvidence({ rawJournalLines: j2.lines, journalRows: rows as never } as never);
    console.log("LIB no source identity -> report.sourceSha =", r.sourceSha);
    expect(r.sourceSha).toMatch(/^[a-f0-9]{40}$/);
  });
  it("an omitted parsed start row cannot replace signed source identity with caller identity", () => {
    const rows = (j.rows as Row[]).filter((r) => r.kind !== "start");
    const r = validateExperimentEvidence({ rawJournalLines: j.lines, journalRows: rows as never, sourceSha: B, runId: "r" } as never);
    expect(r.sourceSha).toBe(A);
    expect(codes(r)).toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
});

describe("attestation identity vs manifest / start row / caller", () => {
  const l = liveJournal({ sourceSha: SHA, runId: EXP });
  it("control: attestation == manifest == start row => proven", () => {
    expect(validateLive(l, attest(paramsFor(l))).mode).toBe("real_minecraft");
  });
  it("[QA67-R1 REGRESSION vs base] attestation binds sha X, caller input says X, but manifest AND journal start row say Y => must not be real_minecraft", () => {
    const X = C;
    const att = attest(paramsFor(l, { sourceSha: X }));
    const r = validateLive(l, att, { sourceSha: X });
    console.log("ATT_SHA_X caller=X manifest=Y start=Y -> mode=", r.mode, "status=", r.overallStatus, "report.sourceSha=", r.sourceSha.slice(0, 8));
    expect(r.mode).not.toBe("real_minecraft");
  });
  it("[QA67-R1 REGRESSION vs base] attestation binds experiment 'OTHER', caller input says OTHER, manifest/start row say EXP => must not be real_minecraft", () => {
    const att = attest(paramsFor(l, { experimentId: "OTHER" }));
    const r = validateLive(l, att, { experimentId: "OTHER" });
    console.log("ATT_EXP caller=OTHER manifest=EXP start=EXP -> mode=", r.mode, "status=", r.overallStatus, "report.experimentId=", r.experimentId);
    expect(r.mode).not.toBe("real_minecraft");
  });
  it("attestation sha != the effective sha is rejected (no caller trick needed)", () => {
    const r = validateLive(l, attest(paramsFor(l, { sourceSha: C })));
    expect(r.mode).not.toBe("real_minecraft");
  });
  it("trustedKeys absent / empty => untrusted authority, never proven", () => {
    for (const keys of [undefined, {}, new Map()]) {
      const r = validateLive(l, attest(paramsFor(l)), { trustedKeys: keys });
      expect(r.mode).not.toBe("real_minecraft");
    }
    void AUTH; void key;
  });
});
