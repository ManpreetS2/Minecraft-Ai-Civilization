// A rich, internally consistent, genuinely-signed-style 60-minute journal exercising every action kind the verifier knows.
import { attest, liveJournal, paramsFor, validateLive, type Live } from "./live.js";
export type R = Record<string, unknown>;
const att = (citizenId: string, attemptId: string, action: string, extra: R = {}): R => ({ kind: "action_attempt", citizenId, attemptId, action, decisionSource: "scripted", decisionEventId: `d-${attemptId}`, ...extra });
const obs = (citizenId: string, attemptId: string, before: R, after: R, extra: R = {}): R => ({ kind: "action_observation", citizenId, attemptId, verified: true, successReported: true, beforeInventory: before, afterInventory: after, worldChanges: [], ...extra });

export const ATLAS = "gpt_atlas", MAYA = "gpt_maya";
export const ROSTER = [ATLAS, MAYA, "claude_theo", "claude_ava"]; // the roster createTestManifest() declares
export function richExtra(): R[] {
  const i0 = {}, i1 = { oak_log: 2 }, i2 = { oak_log: 2, bread: 1 }, i3 = { oak_log: 1, bread: 1, oak_planks: 4 }, i4 = { oak_log: 1, bread: 1, oak_planks: 3 };
  const i6 = { oak_log: 1, oak_planks: 3 }, i7 = { oak_planks: 3 };
  return [
    att(ATLAS, "a1", "gather", { expectedItem: "oak_log" }), obs(ATLAS, "a1", i0, i1),
    att(ATLAS, "a2", "gather", { expectedItem: "bread" }), obs(ATLAS, "a2", i1, i2),
    att(ATLAS, "a3", "craft", { expectedItem: "oak_planks" }), obs(ATLAS, "a3", i2, i3),
    att(ATLAS, "a4", "place", { expectedItem: "oak_planks", target: { x: 1, y: 64, z: 1 } }),
    obs(ATLAS, "a4", i3, i4, { worldChanges: [{ position: { x: 1, y: 64, z: 1 }, before: "air", after: "oak_planks" }] }),
    att(ATLAS, "a5", "move", { target: { x: 10, y: 64, z: 10 }, range: 1 }), obs(ATLAS, "a5", i4, i4, { position: { x: 10, y: 64, z: 10 } }),
    att(ATLAS, "a6", "eat", { expectedItem: "bread" }), obs(ATLAS, "a6", i4, i6, { hungerBefore: 10, hungerAfter: 16, healthBefore: 18, healthAfter: 20 }),
    att(ATLAS, "a7", "speech"), obs(ATLAS, "a7", i6, i6, { authorizedRecipients: [MAYA] }),
    att(ATLAS, "a8", "deposit", { expectedItem: "oak_log" }), obs(ATLAS, "a8", i6, i7),
    att(MAYA, "m1", "gather", { expectedItem: "oak_log" }), obs(MAYA, "m1", {}, { oak_log: 1 }),
  ];
}
export const RICH_FINALS = { [ATLAS]: { oak_planks: 3 }, [MAYA]: { oak_log: 1 } };
export const richLive = (o: Parameters<typeof liveJournal>[0] = {}): Live => liveJournal({ citizens: ROSTER, extra: richExtra(), ...o });
export const validateRich = (l: Live, extra: R = {}, att2?: unknown) => validateLive(l, att2 ?? attest(paramsFor(l)), { finalInventories: RICH_FINALS, citizens: ROSTER, ...extra });
