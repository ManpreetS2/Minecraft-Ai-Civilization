// QA provenance controls (Mission 3). What the CURRENT offline validator (integration candidate 1d9967f, validator from PR #94) can and cannot prove about a
// genuinely signed journal. SYNTHETIC test keys only: no signer exists in this repository, no Paper, no network. Nothing here is a claim of security.
//
// Three kinds of test, named in the title so a future failure is never confused with a regression:
//   [ENFORCED]       a defense that exists today. Red means a REGRESSION.
//   [UNIMPLEMENTED]  a defense named in PR #119's specification (G1..G8) that does NOT exist. The test asserts today's behaviour (accepted) so it is green;
//                    the SAME scenario is asserted rejected in ../defects (red now, turns green when the defense lands). Red here means the defense arrived
//                    (update the test) or behaviour changed.
//   [FIRST-SMOKE]    the unauthenticated scripted Paper observation: it can never become real_minecraft/VERIFIED, with or without a signature-shaped artifact.
import { describe, expect, it } from "vitest";
import { clone, reseal, sixtyMinuteTicks, type Row } from "../../v94/lib/journal.js";
import { attest, EXP, liveJournal, paramsFor, T0, validateLive, type Live } from "../../v94/lib/live.js";
import { RICH_FINALS, ROSTER, richExtra, richLive, validateRich } from "../../v94/lib/rich.js";
import { SCENARIOS } from "./scenarios.js";

const codes = (r: { violations: Array<{ code: string }> }) => [...new Set(r.violations.map((v) => v.code))];
const authentic = (r: { mode: string; overallStatus: string }) => r.mode === "real_minecraft" && r.overallStatus === "VERIFIED";

describe("[ENFORCED] replay, relabel and signature binding", () => {
  it("control: the synthetic signed rich run is real_minecraft/VERIFIED (so the rejections below are meaningful)", () => {
    expect(authentic(validateRich(richLive()))).toBe(true);
  });
  it("a genuine attestation bound to ANOTHER experiment id is never authentic for this journal", () => {
    const l = richLive();
    expect(authentic(validateRich(l, {}, attest(paramsFor(l, { experimentId: "exp-some-other-run" }))))).toBe(false);
  });
  it("a journal relabelled to another experiment id (rows rewritten and re-sealed) no longer matches the signed digest", () => {
    const l = richLive(); const att = attest(paramsFor(l));
    const rows = clone(l.rows) as Row[]; for (const r of rows) r.experimentId = "exp-relabelled"; const s = reseal(rows);
    expect(authentic(validateRich({ ...l, rows: s.rows, lines: s.lines } as Live, {}, att))).toBe(false);
  });
  it("one row changed after signing (digest mismatch) is never authentic", () => {
    const l = richLive(); const att = attest(paramsFor(l)); const rows = clone(l.rows) as Row[]; (rows[3] as Record<string, unknown>).durationMs = 999; const s = reseal(rows);
    expect(authentic(validateRich({ ...l, rows: s.rows, lines: s.lines } as Live, {}, att))).toBe(false);
  });
  it("an attestation whose signed window ends before the journal's last row is never authentic", () => {
    const l = richLive(); const early = new Date(T0 + 30 * 60_000).toISOString();
    expect(authentic(validateRich(l, {}, attest(paramsFor(l, { endedAt: early }))))).toBe(false);
  });
  it("a trusted authority name bound to someone else's key, or an unknown authority, is never authentic", () => {
    const l = richLive();
    expect(authentic(validateRich(l, {}, attest(paramsFor(l), undefined, "paper-unknown-authority")))).toBe(false);
  });
});

describe("[ENFORCED] clumsy fabrication and interrupted capture are caught even when SIGNED", () => {
  const signed = (extra: Array<Record<string, unknown>>, ticks = sixtyMinuteTicks(T0), finals: Record<string, Record<string, number>> = RICH_FINALS) => {
    const l = liveJournal({ citizens: ROSTER, extra, ticks }); return validateLive(l, attest(paramsFor(l)), { finalInventories: finals, citizens: ROSTER });
  };
  it("a phantom gather (verified, but the inventory never changed) is a violation, never authentic", () => {
    const r = signed([
      { kind: "action_attempt", citizenId: "gpt_atlas", attemptId: "p1", action: "gather", decisionSource: "scripted", decisionEventId: "d", expectedItem: "diamond" },
      { kind: "action_observation", citizenId: "gpt_atlas", attemptId: "p1", verified: true, successReported: true, beforeInventory: {}, afterInventory: {}, worldChanges: [] },
    ], undefined, { gpt_atlas: {} });
    expect(authentic(r)).toBe(false); expect(codes(r).length).toBeGreaterThan(0);
  });
  it("a broken inventory chain between two observations of one citizen is a violation", () => {
    const r = signed([
      { kind: "action_attempt", citizenId: "gpt_atlas", attemptId: "c1", action: "gather", decisionSource: "scripted", decisionEventId: "d1", expectedItem: "oak_log" },
      { kind: "action_observation", citizenId: "gpt_atlas", attemptId: "c1", verified: true, successReported: true, beforeInventory: {}, afterInventory: { oak_log: 1 }, worldChanges: [] },
      { kind: "action_attempt", citizenId: "gpt_atlas", attemptId: "c2", action: "gather", decisionSource: "scripted", decisionEventId: "d2", expectedItem: "oak_log" },
      { kind: "action_observation", citizenId: "gpt_atlas", attemptId: "c2", verified: true, successReported: true, beforeInventory: { oak_log: 40 }, afterInventory: { oak_log: 41 }, worldChanges: [] },
    ], undefined, { gpt_atlas: { oak_log: 41 } });
    expect(authentic(r)).toBe(false); expect(codes(r)).toContain("INVENTORY_CONTINUITY_DISRUPTION");
  });
  it("a missing stretch of tick samples (21 minutes with no capture) cannot reach 60 minutes", () => {
    const r = signed(richExtra(), sixtyMinuteTicks(T0).filter((_, i) => i < 20 || i > 40));
    expect(authentic(r)).toBe(false); expect(codes(r)).toContain("DURATION_EVIDENCE_DEFICIT");
  });
  it("a capture interrupted at 10 minutes and then honestly signed is not a 60-minute run", () => {
    const r = signed(richExtra(), sixtyMinuteTicks(T0, 5000, 1200, 60_000, 11));
    expect(authentic(r)).toBe(false); expect(codes(r)).toContain("DURATION_EVIDENCE_DEFICIT");
  });
  it("a server game tick that goes backwards (restart / splice) is not authentic", () => {
    const r = signed(richExtra(), sixtyMinuteTicks(T0).map((t, i) => (i === 30 ? { ...t, serverGameTick: 100 } : t)));
    expect(authentic(r)).toBe(false);
  });
  it("two runs spliced into one re-sealed journal produce identity/continuity violations", () => {
    const a = richLive(); const b = richLive(); const s = reseal(clone([...a.rows, ...b.rows]) as Row[]);
    const sp = { ...a, rows: s.rows, lines: s.lines } as Live; const r = validateLive(sp, attest(paramsFor(sp)), { finalInventories: RICH_FINALS, citizens: ROSTER });
    expect(authentic(r)).toBe(false); expect(codes(r)).toContain("DUPLICATE_ATTEMPT_ID");
  });
});

describe("[UNIMPLEMENTED] defenses PR #119 specifies that the current validator does not have (documented today's behaviour: accepted)", () => {
  for (const s of SCENARIOS) {
    it(`${s.gap} ${s.name}: today the signed run is ${s.today}`, () => {
      const r = s.run();
      expect(r.mode).toBe("real_minecraft"); expect(r.overallStatus).toBe("VERIFIED"); expect(r.notProven.filter((n) => s.flagged.test(n.code))).toEqual([]);
    });
  }
  it("the public ValidatorInput has no expected-session / world / UUID / receipt input at all: extra constraints are silently ignored", () => {
    const l = richLive();
    const r = validateRich(l, { expectedCaptureSessionId: "99999999-2222-4333-8444-555555555555", worldFingerprint: "other-world", expectedUuids: { gpt_atlas: "x" }, providerReceipts: [] });
    expect(authentic(r)).toBe(true);
  });
});

describe("[FIRST-SMOKE] the unauthenticated scripted Paper observation never becomes evidence-grade", () => {
  const finals = { finalInventories: RICH_FINALS, citizens: ROSTER };
  it("the same scripted journal without any attestation is offline_simulated and never VERIFIED, and says why", () => {
    const l = richLive(); const r = validateLive(l, undefined, finals);
    expect(r.mode).toBe("offline_simulated"); expect(r.overallStatus).not.toBe("VERIFIED"); expect(r.notProven.some((n) => n.code === "UNPROVEN_PAPER_AUTHENTICITY")).toBe(true);
  });
  it("a journal that CLAIMS live mode with 60 minutes of plausible server ticks but no signature is still offline_simulated", () => {
    const l = liveJournal({ citizens: ROSTER, extra: richExtra(), mode: "live" }); const r = validateLive(l, undefined, finals);
    expect(r.mode).toBe("offline_simulated"); expect(authentic(r)).toBe(false);
  });
  it("a signature-shaped artifact under an EMPTY trust root, or under a trust entry that is not the signer's key, is never authentic (the caller owns the trust root)", () => {
    const l = richLive();
    expect(authentic(validateRich(l, { trustedKeys: {} }))).toBe(false);
    expect(authentic(validateRich(l, { trustedKeys: { "paper-qa67-authority": "not-a-key" } }))).toBe(false);
  });
  it("evidence-grade is only reachable with BOTH a trusted signature and the 60-minute tick evidence: a signed 1-minute smoke is not 60-minute evidence", () => {
    const l = liveJournal({ citizens: ROSTER, extra: richExtra(), ticks: sixtyMinuteTicks(T0, 5000, 1200, 60_000, 2) });
    const r = validateLive(l, attest(paramsFor(l)), finals); expect(authentic(r)).toBe(false);
    void EXP;
  });
});
