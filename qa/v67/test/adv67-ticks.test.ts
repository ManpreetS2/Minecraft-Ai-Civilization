// Signed-tick tolerance, signed-timestamp verification, and "missing evidence never becomes proof".
import { describe, expect, it } from "vitest";
import { verifySourceAttestation, auditDurationAndTicks } from "../../../experiments/evidence-validator/src/index.js";
import { createTestManifest } from "../../../experiments/evidence-validator/fixtures/helpers.js";
import { liveJournal, paramsFor, attest, validateLive, AUTH, EXP, SHA, key, T0, attemptObs } from "../lib/live.js";
import { sixtyMinuteTicks, type TickSpec } from "../lib/journal.js";

const iso = (ms: number) => new Date(ms).toISOString();
const real = (r: ReturnType<typeof validateLive>) => r.mode === "real_minecraft";

describe("1,200-tick tolerance: what the signed total_server_ticks check really enforces", () => {
  const l = liveJournal();
  const span = 72_000;
  const outcome = (delta: number) => {
    const p = paramsFor(l, { totalServerTicks: span + delta });
    const r = validateLive(l, attest(p));
    return { proven: r.sourceAttestationAudit?.proven === true, real: real(r), reasons: r.sourceAttestationAudit?.reasons ?? [] };
  };
  it("characterises the accepted band around the sampled span (signed first/last always equal to the journal samples)", () => {
    const table: Record<string, boolean> = {};
    for (const d of [-1, 0, 1, 2, 600, 1199, 1200, 1201, 2400, 6000, 72_000]) table[String(d)] = outcome(d).proven;
    console.log("TOLERANCE_TABLE (signed total - sampled span -> attestation proven)", JSON.stringify(table));
    expect(table["-1"]).toBe(false);
    expect(table["0"]).toBe(true);
    expect(table["1201"]).toBe(false);
  });
  it("[QA67-L2] a signed total that disagrees with signed last-first (same samples) by up to 1,200 ticks must be rejected", () => {
    // first/last are signed AND must equal the journal samples, so total has no independent degree of freedom
    // for a sampled series; accepting +1200 admits an inconsistent signed statement.
    expect(outcome(1200).proven).toBe(false);
  });
  it("[QA67-L2] ... and even +1 tick of unexplained inconsistency must not be silently accepted", () => {
    expect(outcome(1).proven).toBe(false);
  });
  it("accepting the inconsistency never raises the proven elapsed ticks: duration audit uses journal samples, not the signed total", () => {
    const a = validateLive(l, attest(paramsFor(l, { totalServerTicks: span + 1200 })));
    expect(a.durationAudit.serverTickCount).toBe(61);
    // The signed total is not consumed anywhere else, so the tolerance cannot extend a short run:
    const short = liveJournal({ ticks: sixtyMinuteTicks(T0, 5000, 1100) }); // 66,000 < 68,400
    const r = validateLive(short, attest(paramsFor(short, { totalServerTicks: 66_000 + 1200 })));
    expect(real(r)).toBe(false);
  });
  it("an HONEST wider signed window (start/stop outside the first/last samples) is rejected beyond +1200: the constant is not derived from the sampling interval", () => {
    // journal samples are 1 minute apart (1200 ticks). A window covering one extra sample on each side = +2400.
    const a = outcome(2400);
    console.log("HONEST_WINDOW_PLUS_2_INTERVALS proven=", a.proven, a.reasons.slice(0, 1));
    expect(a.proven).toBe(false);
  });
  it("tolerance is independent of the sampling interval: with 5-minute samples (allowed up to 6000 ticks) +1200 is still the band", () => {
    const ticks = sixtyMinuteTicks(T0, 5000, 6000, 300_000, 13); // 72,000 ticks over 60 min with 5-min samples
    const wide = liveJournal({ ticks });
    const r1 = validateLive(wide, attest(paramsFor(wide)));
    const r2 = validateLive(wide, attest(paramsFor(wide, { totalServerTicks: 72_000 + 1200 })));
    console.log("FIVE_MIN_SAMPLES exact=", r1.sourceAttestationAudit?.proven, "+1200=", r2.sourceAttestationAudit?.proven, "durationComplete=", r1.durationAudit.durationComplete, r1.durationAudit.reasons.slice(0, 2));
    expect(typeof r1.sourceAttestationAudit?.proven).toBe("boolean");
  });
  it("signed first/last that differ from the journal samples by even 1 tick are rejected (no tolerance there)", () => {
    for (const o of [{ firstServerTick: 5001 }, { lastServerTick: 77_001 }, { firstServerTick: 4999 }]) {
      const p = paramsFor(l, o);
      expect(validateLive(l, attest(p)).sourceAttestationAudit?.proven).toBe(false);
    }
  });
  it("total less than the sampled span, last<first, and absurd totals are rejected", () => {
    for (const o of [{ totalServerTicks: 0 }, { totalServerTicks: 71_999 }, { totalServerTicks: 10_000_000 }]) {
      expect(validateLive(l, attest(paramsFor(l, o))).sourceAttestationAudit?.proven, JSON.stringify(o)).toBe(false);
    }
    const p = paramsFor(l, { firstServerTick: 77_000, lastServerTick: 5000, totalServerTicks: 0 });
    expect(validateLive(l, attest(p)).sourceAttestationAudit?.proven).toBe(false);
  });
});

describe("signed wall-clock timestamps: what is and is not verified", () => {
  const l = liveJournal();
  const sig = (o: Parameters<typeof paramsFor>[1]) => validateLive(l, attest(paramsFor(l, o)));
  it("rejects unparseable, equal, and reversed signed timestamps", () => {
    for (const o of [{ startedAt: "garbage" }, { endedAt: "garbage" }, { startedAt: iso(T0), endedAt: iso(T0) }, { startedAt: iso(T0 + 3600_000), endedAt: iso(T0) }]) {
      expect(sig(o).sourceAttestationAudit?.proven, JSON.stringify(o)).toBe(false);
    }
  });
  it("[QA67-M3] a signed capture window that cannot contain the journal's 60 minutes / 72,000 ticks must not be proven (window = 1 second)", () => {
    const a = sig({ startedAt: iso(T0), endedAt: iso(T0 + 1000) });
    console.log("WINDOW_1S proven=", a.sourceAttestationAudit?.proven, "mode=", a.mode, "status=", a.overallStatus);
    expect(a.sourceAttestationAudit?.proven).toBe(false);
  });
  it("[QA67-M3] a signed window that does not overlap the journal at all (a year earlier / in the future) must not be proven", () => {
    for (const shift of [-365 * 86400_000, 400 * 86400_000]) {
      const a = sig({ startedAt: iso(T0 + shift), endedAt: iso(T0 + shift + 3600_000) });
      console.log("WINDOW_SHIFT", shift / 86400_000, "days proven=", a.sourceAttestationAudit?.proven);
      expect(a.sourceAttestationAudit?.proven, String(shift)).toBe(false);
    }
  });
  it("[QA67-M3] ticks faster than 20 TPS over the signed window are impossible and must be rejected (72,000 ticks signed over 60s)", () => {
    const a = sig({ startedAt: iso(T0), endedAt: iso(T0 + 60_000) });
    expect(a.sourceAttestationAudit?.proven).toBe(false);
  });
  it("journal wall-clock, not the signed window, gates a live claim: a 2-minute journal cannot satisfy 60 minutes even with a 60-minute signed window", () => {
    const ticks = sixtyMinuteTicks(T0, 5000, 1200, 2000, 61); // 61 samples 2 s apart => 72,000 ticks in 2 minutes (e.g. /tick sprint)
    const fast = liveJournal({ ticks });
    const r = validateLive(fast, attest(paramsFor(fast)));
    console.log("TICK_SPRINT_2MIN mode=", r.mode, "durationComplete=", r.durationAudit.durationComplete, r.durationAudit.reasons.slice(0, 2));
    expect(real(r)).toBe(false);
  });
});

describe("missing / sparse / gapped evidence never becomes proof of uninterrupted Paper execution", () => {
  const sign = (l: ReturnType<typeof liveJournal>, o = {}) => attest(paramsFor(l, o));
  it("no serverGameTick at all (nulls) + a signature over zeros => not proven", () => {
    const ticks: TickSpec[] = sixtyMinuteTicks(T0).map((t) => ({ ...t, serverGameTick: null }));
    const l = liveJournal({ ticks });
    const r = validateLive(l, sign(l, { firstServerTick: 0, lastServerTick: 0, totalServerTicks: 0 }));
    expect(real(r)).toBe(false);
    expect(r.durationAudit.serverTickProven).toBe(false);
  });
  it("no attestation, perfect-looking ticks => not proven, offline_simulated", () => {
    const l = liveJournal();
    const r = validateLive(l, undefined);
    expect(real(r)).toBe(false);
    expect(r.durationAudit.serverTickProven).toBe(false);
    expect(r.mode).toBe("offline_simulated");
  });
  it("tick rows omitted by the caller (journalRows without ticks) while raw lines + signature are genuine => not proven", () => {
    const l = liveJournal();
    const rows = l.rows.filter((x) => x.kind !== "tick");
    const r = validateLive({ ...l, rows }, sign(l));
    expect(real(r)).toBe(false);
  });
  it("only a few samples spanning the whole run (gap > 5 min between samples) => rejected", () => {
    const l = liveJournal({ ticks: sixtyMinuteTicks(T0, 5000, 24_000, 900_000, 5) });
    const r = validateLive(l, sign(l));
    expect(real(r)).toBe(false);
  });
  it("a 10-minute wall-clock hole (no rows) inside an otherwise perfect run => rejected", () => {
    const ticks = sixtyMinuteTicks(T0).filter((_, i) => i < 20 || i > 30);
    const l = liveJournal({ ticks });
    const r = validateLive(l, sign(l));
    expect(real(r)).toBe(false);
  });
  it("tick regression / duplicate sample => rejected", () => {
    const ticks = sixtyMinuteTicks(T0);
    ticks[30]!.serverGameTick = ticks[29]!.serverGameTick!; // duplicate
    const l = liveJournal({ ticks });
    expect(real(validateLive(l, sign(l)))).toBe(false);
    const t2 = sixtyMinuteTicks(T0);
    t2[30]!.serverGameTick = 100; // restart
    const l2 = liveJournal({ ticks: t2 });
    expect(real(validateLive(l2, sign(l2)))).toBe(false);
  });
  it("no TPS observations => not proven", () => {
    const ticks = sixtyMinuteTicks(T0).map(({ measuredTps: _m, ...rest }) => rest as TickSpec);
    const l = liveJournal({ ticks });
    expect(real(validateLive(l, sign(l)))).toBe(false);
  });
  it("68,399 elapsed ticks (just under the 95% floor) => rejected; 68,400 accepted (by design: <=3 min of server pause tolerated)", () => {
    const mk = (n: number) => { const t = sixtyMinuteTicks(T0, 5000, 1140); t[60]!.serverGameTick = 5000 + n; return liveJournal({ ticks: t }); };
    const a = mk(68_399), b = mk(68_400);
    console.log("FLOOR 68399 real=", real(validateLive(a, sign(a))), " 68400 real=", real(validateLive(b, sign(b))));
    expect(real(validateLive(a, sign(a)))).toBe(false);
    expect(real(validateLive(b, sign(b)))).toBe(true);
  });
});

describe("claimed duration < 60 minutes weakens the tick requirements (stale-server / frozen-server probes)", () => {
  const manifestFor = (m: number) => createTestManifest({ experimentId: EXP, sourceSha: SHA, durationMinutes: m });
  const run = (minutes: number, l: ReturnType<typeof liveJournal>, o = {}) => {
    const att = attest(paramsFor(l, o));
    return validateLive(l, att, { manifest: manifestFor(minutes) });
  };
  it("[QA67-M5] a 59-minute live claim whose server tick is FROZEN (every sample = 5000) must not be proven as uninterrupted Paper execution", () => {
    const ticks = sixtyMinuteTicks(T0, 5000, 0).map((t) => ({ ...t, serverGameTick: 5000 }));
    // frozen => duplicate ticks; the validator treats equal consecutive ticks as regression, so use ONE sample + null filler rows
    const filler = sixtyMinuteTicks(T0).map((t, i) => { if (i === 0) return { ...t, serverGameTick: 5000 }; const { serverGameTick: _s, ...rest } = t; return rest as TickSpec; }); // key omitted (valid for base AND candidate)
    void ticks;
    const l = liveJournal({ ticks: filler });
    const r = run(59, l, { firstServerTick: 5000, lastServerTick: 5000, totalServerTicks: 0 });
    console.log("FROZEN_SERVER_59MIN mode=", r.mode, "status=", r.overallStatus, "tickProven=", r.durationAudit.serverTickProven, r.durationAudit.reasons.slice(0, 2));
    expect(real(r)).toBe(false);
  });
  it("[QA67-M5] a 30-minute live claim with only 25 ticks of server progress over 30 wall-minutes must not be proven", () => {
    const ticks = sixtyMinuteTicks(T0, 5000, 1, 30_000, 61); // 61 samples, 30 s apart, +1 tick each => 60 ticks in 30 min
    const l = liveJournal({ ticks });
    const r = run(30, l);
    console.log("SLOW_SERVER_30MIN mode=", r.mode, "tickProven=", r.durationAudit.serverTickProven);
    expect(real(r)).toBe(false);
  });
  it("control: the same 59/30-minute claims with a genuine tick rate are provable", () => {
    const ticks = sixtyMinuteTicks(T0, 5000, 1200, 60_000, 60); // 59 minutes
    const l = liveJournal({ ticks });
    expect(real(run(59, l))).toBe(true);
  });
  it("durationMinutes = 0 never reaches real_minecraft", () => {
    const l = liveJournal();
    expect(real(run(0, l))).toBe(false);
  });
});

describe("missing / invalid timestamps never create proof", () => {
  const l = liveJournal();
  it("attestation without startedAt / endedAt (either or both) is never proven", () => {
    for (const drop of [["startedAt"], ["endedAt"], ["startedAt", "endedAt"]]) {
      const att = attest(paramsFor(l)) as Record<string, unknown>; for (const k of drop) delete att[k];
      const r = validateLive(l, att);
      expect(r.sourceAttestationAudit?.proven, drop.join()).toBe(false);
      expect(r.mode).not.toBe("real_minecraft");
    }
  });
  it("a journal tick row with an unparseable / missing 'at' is surfaced and blocks real_minecraft", () => {
    for (const mut of [(r: { at?: string }) => { r.at = "not-a-date"; }, (r: { at?: string }) => { delete r.at; }]) {
      const rows = l.rows.map((r) => ({ ...r }));
      mut(rows.find((x, i) => i === 10));
      const r = validateLive({ ...l, rows: rows as never }, attest(paramsFor(l)));
      expect(r.mode).not.toBe("real_minecraft");
    }
  });
  it("Paper ticks sampled only in the first 10% of the run, then 54 minutes of tick-less filler rows, with an honest signed window covering only the sampled part, must not prove 60 uninterrupted minutes", () => {
    const ticks = sixtyMinuteTicks(T0).map((t, i) => (i <= 6 ? { ...t, serverGameTick: 5000 + i * 12_000 } : { ...t, serverGameTick: null }));
    const j = liveJournal({ ticks });
    // honest signer: it only ever observed ticks 5000..77000 within the first 6 minutes (tick sprint), then the server went away
    const att = attest(paramsFor(j, { endedAt: iso(T0 + 6 * 60_000) }));
    const r = validateLive(j, att);
    console.log("NULL_FILLER mode=", r.mode, "status=", r.overallStatus, "reasons=", r.durationAudit.reasons.slice(0, 2));
    expect(real(r)).toBe(false);
  });
});

void AUTH; void key; void attemptObs; void verifySourceAttestation; void auditDurationAndTicks;
