// QA86 DEFECT DEMONSTRATIONS (ordinary assertions of the SAFE behaviour; RED on PR #86 where the defect is present, green when fixed).
// Kept out of the default config (vitest.defects.config.ts). Signed raw lines are genuine and untouched; only caller-supplied fields change.
import { describe, expect, it } from "vitest";
import { T0, attest, liveJournal, paramsFor, validateLive } from "../lib/live.js";
import { clone, type Row } from "../lib/journal.js";
import { ATLAS, MAYA, ROSTER, richExtra, richLive, validateRich, RICH_FINALS, type R } from "../lib/rich.js";

const codes = (r: { violations: Array<{ code: string }> }) => r.violations.map((v) => v.code);
const parsed = (l: ReturnType<typeof richLive>, f: (rows: Row[]) => void) => { const rows = clone(l.rows) as Row[]; f(rows); return { ...l, rows }; };
const find = (rows: Row[], kind: string, id: string) => rows.find((r) => r.kind === kind && r.attemptId === id) as Row;
const setExtra = (id: string, kind: string, patch: R) => richExtra().map((r) => (r.attemptId === id && r.kind === kind ? { ...r, ...patch } : r));

describe("[QA86-M1] observation fields still taken from the caller-supplied row, not the signed raw line", () => {
  it("an eat action whose SIGNED observation shows no hunger increase (unverified: phantom calories) cannot become VERIFIED by editing hungerBefore/hungerAfter in the parsed row", () => {
    const j = richLive({ extra: setExtra("a6", "action_observation", { hungerBefore: 16, hungerAfter: 16 }) });
    const honest = validateRich(j);
    const forged = validateRich(parsed(j, (rows) => { Object.assign(find(rows, "action_observation", "a6"), { hungerBefore: 10, hungerAfter: 16 }); }));
    console.log("EAT honest.verified=", honest.summary.verifiedActions, "forged.verified=", forged.summary.verifiedActions, "forged.codes=", codes(forged).join(",") || "none", forged.mode, forged.overallStatus);
    expect(honest.summary.verifiedActions).toBe(8);
    expect(forged.summary.verifiedActions).toBe(8);
    expect(codes(forged)).toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
  it("a speech action whose SIGNED observation has NO authorized recipients (unverified) cannot become VERIFIED by adding recipients to the parsed row", () => {
    const j = richLive({ extra: setExtra("a7", "action_observation", { authorizedRecipients: [] }) });
    const honest = validateRich(j);
    const forged = validateRich(parsed(j, (rows) => { (find(rows, "action_observation", "a7") as R).authorizedRecipients = [MAYA]; }));
    console.log("SPEECH honest.verified=", honest.summary.verifiedActions, "forged.verified=", forged.summary.verifiedActions, "forged.codes=", codes(forged).join(",") || "none", forged.mode, forged.overallStatus);
    expect(honest.summary.verifiedActions).toBe(8);
    expect(forged.summary.verifiedActions).toBe(8);
    expect(codes(forged)).toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
  it("health fields (healthBefore/healthAfter) edited in the parsed row diverge from the signed row and are flagged", () => {
    const r = validateRich(parsed(richLive(), (rows) => { (find(rows, "action_observation", "a6") as R).healthAfter = 1; }));
    expect(codes(r)).toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
});

describe("[QA86-L1] citizenId is not part of the raw-row binding", () => {
  it("re-attributing a signed MOVE (attempt AND observation) from one registered citizen to another is flagged", () => {
    const extra: R[] = [
      { kind: "action_attempt", citizenId: ATLAS, attemptId: "mv", action: "move", decisionSource: "scripted", decisionEventId: "dmv", target: { x: 5, y: 64, z: 5 }, range: 1 },
      { kind: "action_observation", citizenId: ATLAS, attemptId: "mv", verified: true, successReported: true, beforeInventory: {}, afterInventory: {}, position: { x: 5, y: 64, z: 5 }, worldChanges: [] },
      { kind: "action_attempt", citizenId: MAYA, attemptId: "m1", action: "gather", decisionSource: "scripted", decisionEventId: "dm1", expectedItem: "oak_log" },
      { kind: "action_observation", citizenId: MAYA, attemptId: "m1", verified: true, successReported: true, beforeInventory: {}, afterInventory: { oak_log: 1 }, worldChanges: [] },
    ];
    const j = liveJournal({ citizens: ROSTER, extra });
    const run = (l: typeof j) => validateLive(l, attest(paramsFor(l)), { finalInventories: { [ATLAS]: {}, [MAYA]: { oak_log: 1 } }, citizens: ROSTER });
    const honest = run(j);
    const rows = clone(j.rows) as Row[]; for (const r of rows) if (r.attemptId === "mv") r.citizenId = MAYA;
    const forged = run({ ...j, rows });
    const per = (r: typeof honest, c: string) => r.actionVerifications.filter((a) => a.citizenId === c && a.status === "VERIFIED").length;
    console.log("REATTRIBUTE honest atlas/maya=", per(honest, ATLAS), per(honest, MAYA), "forged atlas/maya=", per(forged, ATLAS), per(forged, MAYA), "codes=", codes(forged).join(",") || "none", forged.mode, forged.overallStatus);
    expect(per(honest, ATLAS)).toBe(1);
    expect(codes(forged)).toContain("RAW_JOURNAL_ROW_MISMATCH");
  });
});

describe("[QA86-L2] the parsed start row's roster is not bound to the signed start row", () => {
  it("deleting `citizens` from the parsed start row hides a roster conflict that the signed start row carries", () => {
    const j = liveJournal({ citizens: [ATLAS, MAYA, "extra_citizen"], extra: [] });
    const run = (l: typeof j) => validateLive(l, attest(paramsFor(l)), { citizens: ROSTER });
    const honest = run(j); const rows = clone(j.rows) as Row[]; delete (rows[0] as R).citizens;
    const forged = run({ ...j, rows });
    console.log("ROSTER honest.codes=", codes(honest).join(","), "forged.codes=", codes(forged).join(",") || "none", forged.mode, forged.overallStatus);
    expect(codes(honest)).toContain("ROSTER_CONFLICT");
    expect(codes(forged)).toContain("ROSTER_CONFLICT");
  });
});

describe("[QA86-I1] residual informational probes (ordinary assertions of the safe behaviour)", () => {
  it("raw lines present but every parsed row removed and every caller option omitted: the report must not read VERIFIED", () => {
    const l = richLive(); const r = validateLive({ ...l, rows: [] }, attest(paramsFor(l)), {});
    expect(r.overallStatus).not.toBe("VERIFIED");
  });
  it("signed first observation with a non-empty before-inventory and NO physical final inventories supplied is not VERIFIED/real_minecraft", () => {
    const j = richLive({ extra: setExtra("a1", "action_observation", { beforeInventory: { oak_log: 40 }, afterInventory: { oak_log: 41 } }) });
    const r = validateLive(j, attest(paramsFor(j)), { citizens: ROSTER });
    console.log("NO_FINALS mode=", r.mode, "status=", r.overallStatus, "codes=", codes(r).join(",") || "none");
    expect(r.overallStatus).not.toBe("VERIFIED");
  });
});
void T0; void RICH_FINALS;
