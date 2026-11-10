// QA86 A: VALID signed evidence must still be accepted by PR #86 (regression hunt). Synthetic signed fixtures prove the verifier's
// logic only; they say NOTHING about whether a real Paper signing authority exists.
import { createPublicKey, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as ed from "../lib/ed25519.js";
import { AUTH, T0, attest, key, liveJournal, paramsFor, validateLive } from "../lib/live.js";
import { payloadOf, sixtyMinuteTicks, type TickSpec } from "../lib/journal.js";
import { RICH_FINALS, richLive, validateRich } from "../lib/rich.js";

const iso = (ms: number) => new Date(ms).toISOString();
const real = (r: { mode: string }) => r.mode === "real_minecraft";
const codes = (r: { violations: Array<{ code: string }> }) => r.violations.map((v) => v.code);
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const pemOf = (raw: Buffer) => `-----BEGIN PUBLIC KEY-----\n${Buffer.concat([SPKI, raw]).toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----`;

describe("valid signed controls", () => {
  it("rich run (gather, craft, place, move, eat, speech, deposit; two citizens) signed by node:crypto: real_minecraft / VERIFIED, 9/9 actions, zero violations", () => {
    const r = validateRich(richLive());
    expect(r.mode).toBe("real_minecraft"); expect(r.overallStatus).toBe("VERIFIED");
    expect(r.summary.verifiedActions).toBe(9); expect(r.summary.totalAttemptedActions).toBe(9); expect(r.violations).toEqual([]);
  });
  it("the same run signed by the QA-owned BigInt RFC 8032 signer (no node:crypto in the signing path) is also accepted, via PEM, hex and KeyObject keys", () => {
    for (let i = 0; i < 6; i++) {
      const seed = randomBytes(32), pub = ed.publicKey(seed); const l = richLive(); const p = paramsFor(l);
      const a = { sourceType: "paper_server_attested" as const, signingAuthority: AUTH, signature: `ed25519:${ed.sign(seed, payloadOf(p)).toString("hex")}`, ...p };
      for (const k of [pemOf(pub), pub.toString("hex"), createPublicKey(pemOf(pub))]) {
        const r = validateLive(l, a, { trustedKeys: { [AUTH]: k }, finalInventories: RICH_FINALS });
        expect(real(r), `seed#${i}: ${r.violations.map((v) => v.code).join(",")}`).toBe(true); expect(r.overallStatus).toBe("VERIFIED");
      }
    }
  });
  it("TPS jitter (1140/1230 ticks per minute alternating, ~19.5 TPS) is accepted", () => {
    let t = 5000; const ticks: TickSpec[] = [{ at: iso(T0), serverGameTick: t, measuredTps: 19.5 }];
    for (let i = 0; i < 60; i += 1) ticks.push({ at: iso(T0 + (i + 1) * 60_000), serverGameTick: (t += i % 2 ? 1140 : 1230), measuredTps: 19.5 });
    const l = liveJournal({ ticks }); expect(real(validateLive(l, attest(paramsFor(l))))).toBe(true);
  });
  it("signed window padded by 10 min on each side, or written with a +00:00 offset, is accepted (containment, not equality)", () => {
    const l = liveJournal();
    for (const o of [{ startedAt: iso(T0 - 600_000), endedAt: iso(T0 + 4_200_000) }, { startedAt: iso(T0).replace("Z", "+00:00"), endedAt: iso(T0 + 3_600_000).replace("Z", "+00:00") }]) {
      expect(real(validateLive(l, attest(paramsFor(l, o)))), JSON.stringify(o)).toBe(true);
    }
  });
});

describe("capture-window containment: exact skew boundaries (journal spans T0 .. T0+3600 s; tolerance is 5 s)", () => {
  const l = liveJournal();
  const win = (startedAt: number, endedAt: number) => validateLive(l, attest(paramsFor(l, { startedAt: iso(startedAt), endedAt: iso(endedAt) })));
  it("start exactly 5.000 s after the first journal row is accepted; 5.001 s is rejected", () => {
    expect(real(win(T0 + 5000, T0 + 3_600_000))).toBe(true);
    expect(real(win(T0 + 5001, T0 + 3_600_000))).toBe(false);
  });
  it("end exactly 5.000 s before the last journal row is accepted; 5.001 s is rejected", () => {
    expect(real(win(T0, T0 + 3_595_000))).toBe(true);
    expect(real(win(T0, T0 + 3_594_999))).toBe(false);
  });
  for (const [name, s, e] of [
    ["shifted 30 min later", T0 + 1_800_000, T0 + 5_400_000], ["shifted 30 min earlier", T0 - 1_800_000, T0 + 1_800_000], ["overlaps only the final second", T0 + 3_599_000, T0 + 7_200_000],
    ["overlaps only the first second", T0 - 3_000_000, T0 + 1_000], ["window entirely after the journal", T0 + 4_000_000, T0 + 7_600_000], ["window entirely before the journal", T0 - 4_000_000, T0 - 100_000],
    ["zero-length window inside the journal", T0 + 1_800_000, T0 + 1_800_000], ["window covers only the middle 10 minutes", T0 + 1_500_000, T0 + 2_100_000],
  ] as const) {
    it(`window ${name} is not proven, and the report cannot read real_minecraft / VERIFIED`, () => {
      const r = win(s, e); expect(real(r)).toBe(false); expect(r.overallStatus).not.toBe("VERIFIED");
    });
  }
});

describe("trusted-authority allow-list", () => {
  const l = liveJournal();
  it("undefined allow-list + trustedKeys: the keyed authority is trusted (documented behaviour)", () => { expect(real(validateLive(l, attest(paramsFor(l))))).toBe(true); });
  it("allow-list naming the signer: accepted", () => { expect(real(validateLive(l, attest(paramsFor(l)), { trustedAuthorities: [AUTH] }))).toBe(true); });
  it("EMPTY allow-list: fail closed, never real_minecraft", () => { const r = validateLive(l, attest(paramsFor(l)), { trustedAuthorities: [] }); expect(real(r)).toBe(false); expect(r.overallStatus).not.toBe("VERIFIED"); });
  it("allow-list naming someone else, a prefix, a case variant or the prototype key: all rejected", () => {
    for (const list of [["other-authority"], [AUTH.slice(0, -1)], [AUTH.toUpperCase()], ["__proto__"], ["constructor"]]) {
      expect(real(validateLive(l, attest(paramsFor(l)), { trustedAuthorities: list })), JSON.stringify(list)).toBe(false);
    }
  });
  it("a signer whose authority name is 'constructor'/'__proto__' cannot borrow a trust-root entry via the prototype chain", () => {
    for (const name of ["constructor", "__proto__", "toString"]) {
      const r = validateLive(l, attest(paramsFor(l), key.privatePem, name), { trustedKeys: { [AUTH]: key.publicPem } });
      expect(real(r), name).toBe(false);
    }
  });
});

describe("legitimate physical inventory losses, with and without attributable evidence", () => {
  it("WITH attributable evidence (a verified deposit/craft/place/eat action whose observed before/after shows the loss) the ledger balances: no UNEXPLAINED_LOSS", () => {
    const r = validateRich(richLive()); expect(codes(r)).not.toContain("UNEXPLAINED_LOSS"); expect(r.inventoryAudit.discrepancies).toEqual([]);
  });
  it("WITHOUT evidence (an item vanishes from the final physical inventory with no action): flagged as UNEXPLAINED_LOSS, not silently accepted", () => {
    const l = richLive(); const r = validateRich(l, { finalInventories: { ...RICH_FINALS, gpt_maya: { oak_log: 0 } } });
    expect(r.inventoryAudit.discrepancies.some((d) => d.type === "UNEXPLAINED_LOSS" && d.citizenId === "gpt_maya")).toBe(true);
    expect(r.overallStatus).not.toBe("VERIFIED"); expect(real(r)).toBe(false);
  });
  it("a loss that is real but unattributed is reported as a hard violation (documented limit: there is no 'loss event' kind a chest deposit can be recorded with besides an action observation)", () => {
    const r = validateRich(richLive(), { finalInventories: { ...RICH_FINALS, gpt_atlas: { oak_planks: 2 } } });
    expect(r.inventoryAudit.discrepancies.map((d) => d.type)).toContain("UNEXPLAINED_LOSS");
  });
  it("a gain with no action is a SPONTANEOUS_GAIN violation", () => {
    const r = validateRich(richLive(), { finalInventories: { ...RICH_FINALS, gpt_maya: { oak_log: 2 } } });
    expect(r.inventoryAudit.discrepancies.map((d) => d.type)).toContain("SPONTANEOUS_GAIN");
  });
});

describe("evidence that is not genuinely signed never becomes real_minecraft", () => {
  it("unsigned journal with the same rows: offline_simulated, not VERIFIED-as-real", () => {
    const l = richLive(); const r = validateLive(l, undefined as never, { finalInventories: RICH_FINALS });
    expect(r.mode).toBe("offline_simulated"); expect(r.notProven.map((n) => n.code)).toContain("UNPROVEN_PAPER_AUTHENTICITY");
  });
  it("signature by a key that is not the trusted key: rejected", () => {
    const other = ed.sign(randomBytes(32), payloadOf(paramsFor(richLive())));
    const l = richLive(); const a = { ...attest(paramsFor(l)), signature: `ed25519:${other.toString("hex")}` };
    expect(real(validateLive(l, a, { finalInventories: RICH_FINALS }))).toBe(false);
  });
  it("evidence digest of a different journal: rejected", () => {
    const l = richLive(); const a = attest(paramsFor(l, { evidenceDigest: "0".repeat(64) })); expect(real(validateLive(l, a, { finalInventories: RICH_FINALS }))).toBe(false);
  });
  it("sixtyMinuteTicks helper sanity: 61 samples, 3 600 000 ms", () => { const t = sixtyMinuteTicks(T0); expect(t).toHaveLength(61); expect(Date.parse(t[60]!.at) - Date.parse(t[0]!.at)).toBe(3_600_000); });
});
