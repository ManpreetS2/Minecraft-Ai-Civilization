// Shared scenario table: each is a SIGNED run (synthetic test key) that a real defense from PR #119 section 6 must reject but today's validator accepts.
import { reseal, sixtyMinuteTicks, type Row, clone } from "../../v94/lib/journal.js";
import { attest, liveJournal, paramsFor, T0, validateLive, type Live } from "../../v94/lib/live.js";
import { RICH_FINALS, ROSTER, richExtra, richLive, validateRich } from "../../v94/lib/rich.js";

type Rec = Record<string, unknown>;
const finals = { finalInventories: RICH_FINALS, citizens: ROSTER };
const signedExtra = (extra: Rec[], f: Record<string, Record<string, number>> = RICH_FINALS) => {
  const l = liveJournal({ citizens: ROSTER, extra }); return validateLive(l, attest(paramsFor(l)), { finalInventories: f, citizens: ROSTER });
};

/** A long, internally consistent, plausible fabrication: 40 gathers + 10 straight-line moves + deposit chain, with no server-side witness behind any of it. */
function plausibleFabrication(): Rec[] {
  const out: Rec[] = []; let inv = 0;
  for (let i = 0; i < 40; i += 1) {
    out.push({ kind: "action_attempt", citizenId: "gpt_atlas", attemptId: `fab-g${i}`, action: "gather", decisionSource: "scripted", decisionEventId: `fd-g${i}`, expectedItem: "oak_log" });
    out.push({ kind: "action_observation", citizenId: "gpt_atlas", attemptId: `fab-g${i}`, verified: true, successReported: true, beforeInventory: inv ? { oak_log: inv } : {}, afterInventory: { oak_log: inv + 1 }, worldChanges: [] });
    inv += 1;
    if (i % 4 === 3) {
      const x = 10 + i;
      out.push({ kind: "action_attempt", citizenId: "gpt_atlas", attemptId: `fab-m${i}`, action: "move", decisionSource: "scripted", decisionEventId: `fd-m${i}`, target: { x, y: 64, z: 10 }, range: 1 });
      out.push({ kind: "action_observation", citizenId: "gpt_atlas", attemptId: `fab-m${i}`, verified: true, successReported: true, beforeInventory: { oak_log: inv }, afterInventory: { oak_log: inv }, worldChanges: [], position: { x, y: 64, z: 10 } });
    }
  }
  return out;
}

export interface Scenario { gap: string; name: string; today: string; flagged: RegExp; run: () => ReturnType<typeof validateRich> }
export const SCENARIOS: Scenario[] = [
  { gap: "G1", name: "plausible fabricated physical journal written by the harness (50 consistent actions, no server witness)", today: "real_minecraft/VERIFIED", flagged: /WITNESS|PHYSICAL|PROVENANCE/i,
    run: () => signedExtra(plausibleFabrication(), { gpt_atlas: { oak_log: 40 } }) },
  { gap: "G2", name: "a genuine attestation replayed as a second run (no used-session registry)", today: "accepted both times", flagged: /REPLAY|SESSION/i,
    run: () => { const l = richLive(); const att = attest(paramsFor(l)); validateRich(l, {}, att); return validateRich(clone(l) as Live, {}, att); } },
  { gap: "G2", name: "attestation session id differs from the provisioned session: the caller cannot even state the expected session (ValidatorInput has no such field)", today: "accepted",
    flagged: /SESSION/i, run: () => { const l = richLive(); return validateRich(l, { expectedCaptureSessionId: "99999999-2222-4333-8444-555555555555" }); } },
  { gap: "G3", name: "correct key and digest, journal declares a DIFFERENT world (start-row world fingerprint contradicts the manifest world seed)", today: "real_minecraft/VERIFIED", flagged: /WORLD/i,
    run: () => { const l = richLive(); const rows = clone(l.rows) as Row[]; (rows[0] as Rec).worldSeed = "a-completely-different-world"; (rows[0] as Rec).worldFingerprint = "sha256:other"; const s = reseal(rows); const m = { ...l, rows: s.rows, lines: s.lines } as Live; return validateRich(m, {}, attest(paramsFor(m))); } },
  { gap: "G4", name: "no session_seal / shutdown row: a crash-truncated journal re-signed at its digest", today: "real_minecraft/VERIFIED", flagged: /SEAL|SHUTDOWN|CHECKPOINT/i,
    run: () => { const l = richLive(); const m = { ...l, rows: l.rows.slice(0, -1), lines: l.lines.slice(0, -1) } as Live; return validateRich(m, {}, attest(paramsFor(m))); } },
  { gap: "G4", name: "a single end-of-run signature: no periodic checkpoints exist or are required for a 60-minute run", today: "real_minecraft/VERIFIED", flagged: /CHECKPOINT/i,
    run: () => validateRich(richLive()) },
  { gap: "G6", name: "every decision claims decisionSource 'model' but there are no provider receipts anywhere", today: "real_minecraft/VERIFIED", flagged: /RECEIPT|MODEL|PROVIDER/i,
    run: () => { const extra = richExtra().map((r) => (r.kind === "action_attempt" ? { ...r, decisionSource: "model" } : r)); const l = liveJournal({ citizens: ROSTER, extra }); return validateLive(l, attest(paramsFor(l)), finals); } },
  { gap: "G8", name: "two citizens joined under the SAME Minecraft UUID (join rows are not a concept the validator knows)", today: "real_minecraft/VERIFIED", flagged: /UUID|IDENTITY|JOIN/i,
    run: () => { const same = "11111111-1111-4111-8111-111111111111"; const l = liveJournal({ citizens: ROSTER, extra: [{ kind: "join", citizenId: "gpt_atlas", uuid: same, username: "Atlas" }, { kind: "join", citizenId: "gpt_maya", uuid: same, username: "Maya" }, ...richExtra()] }); return validateLive(l, attest(paramsFor(l)), finals); } },
  { gap: "G8", name: "citizen ids swapped against their join UUIDs (atlas acts under maya's UUID)", today: "real_minecraft/VERIFIED", flagged: /UUID|IDENTITY|JOIN/i,
    run: () => { const l = liveJournal({ citizens: ROSTER, extra: [{ kind: "join", citizenId: "gpt_maya", uuid: "aaaaaaaa-1111-4111-8111-111111111111", username: "Atlas" }, { kind: "join", citizenId: "gpt_atlas", uuid: "bbbbbbbb-1111-4111-8111-111111111111", username: "Maya" }, ...richExtra()] }); return validateLive(l, attest(paramsFor(l)), finals); } },
];
void sixtyMinuteTicks; void T0;
