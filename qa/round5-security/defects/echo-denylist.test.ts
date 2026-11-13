 
// Round 5 / PR #150 DESIRED contract (QA150-L1; red = not met): the stated goal is that unknown authority claims are not echoed. The implementation is a keyword denylist, so other authority-flavoured names are still echoed.
import { describe, expect, it } from "vitest";
import { attest, liveJournal, paramsFor, validateLive } from "../../v94/lib/live.js";
import { ROSTER } from "../../v94/lib/rich.js";
const ATLAS = "gpt_atlas";
const run = (extra: Record<string, unknown>) => { const l = liveJournal({ citizens: ROSTER, extra: [
  { kind: "action_attempt", citizenId: ATLAS, attemptId: "a", action: "gather", decisionSource: "scripted", decisionEventId: "d-a", expectedItem: "oak_log", ...extra },
  { kind: "action_observation", citizenId: ATLAS, attemptId: "a", verified: true, successReported: true, beforeInventory: {}, afterInventory: { oak_log: 1 }, worldChanges: [] }] });
  return validateLive(l, attest(paramsFor(l)), { finalInventories: { [ATLAS]: { oak_log: 1 } }, citizens: ROSTER }); };
describe("authority-flavoured unknown names that the denylist does not match", () => {
  for (const name of ["verified", "real_minecraft", "paper_attested", "trusted_by_server", "signature_valid", "witnessed", "PASSED"]) {
    it(`${name}: not echoed verbatim in the report`, () => { const j = JSON.stringify(run({ [name]: true }).notProven); expect(j).not.toContain(`'${name}'`); });
  }
});
