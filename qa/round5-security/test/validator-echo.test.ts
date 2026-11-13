 
// Round 5 / Mission 1: PR #150 (e31bcb4) fingerprints "authority-looking" unknown signed field names (`/provider|genuine|auth|model|provenance/i`) instead of echoing them.
// Default suite: no unknown signed claim ever changes a verdict; fingerprinted names are deterministic and never echo the claim. Synthetic key; offline.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { attest, liveJournal, paramsFor, validateLive } from "../../v94/lib/live.js";
import { ROSTER } from "../../v94/lib/rich.js";
const ATLAS = "gpt_atlas"; type R = Record<string, unknown>;
const run = (extra: R) => { const l = liveJournal({ citizens: ROSTER, extra: [
  { kind: "action_attempt", citizenId: ATLAS, attemptId: "a", action: "gather", decisionSource: "scripted", decisionEventId: "d-a", expectedItem: "oak_log", ...extra },
  { kind: "action_observation", citizenId: ATLAS, attemptId: "a", verified: true, successReported: true, beforeInventory: {}, afterInventory: { oak_log: 1 }, worldChanges: [] }] });
  return validateLive(l, attest(paramsFor(l)), { finalInventories: { [ATLAS]: { oak_log: 1 } }, citizens: ROSTER }); };
const fields = (r: ReturnType<typeof run>) => r.notProven.filter((n) => n.code === "UNKNOWN_SIGNED_FIELD").map((n) => n.missingFields?.[0] ?? "");
describe("#150: unknown signed provenance claims are inert and not echoed (names matched by the denylist)", () => {
  it("regex-matched names are reported only as claim-sha256:<hex of the name>, deterministically, and the run's decision/status is unchanged", () => {
    const names = ["isGenuineModel", "provider", "authenticated", "modelId", "provenanceTag", "AUTHORITY"];
    const base = run({}); const r = run(Object.fromEntries(names.map((n) => [n, true]))); const f = fields(r);
    for (const n of names) { expect(f).toContain(`claim-sha256:${createHash("sha256").update(n).digest("hex")}`); expect(JSON.stringify(r)).not.toContain(n.toLowerCase() === n ? `'${n}'` : n); }
    expect(r.actionVerifications[0]?.decisionSource).toBe("scripted"); expect(r.overallStatus).toBe(base.overallStatus); expect(r.summary.verifiedActions).toBe(base.summary.verifiedActions);
  });
  it("positive control: an ordinary unknown name (tickCpuMs) is still reported by name, and does not change the verdict", () => {
    const base = run({}); const r = run({ tickCpuMs: 7 }); expect(fields(r)).toEqual(["tickCpuMs"]); expect(r.overallStatus).toBe(base.overallStatus); expect(r.summary.verifiedActions).toBe(base.summary.verifiedActions);
  });
  it("hostile names (newline, markdown, HTML, 4 KB) stay inside one JSON string and inside the metadata byte bound", () => {
    const base = run({}); const r = run({ "x\n## âœ… ALL CHECKS PASSED": 1, "<img src=x onerror=alert(1)>": 1 }); const j = JSON.stringify(r); expect(() => JSON.parse(j)).not.toThrow(); expect(r.overallStatus).toBe(base.overallStatus); expect(r.summary.verifiedActions).toBe(base.summary.verifiedActions);
    const big = run({ ["k".repeat(4200)]: 1 }); expect(big.violations.map((v) => v.code)).toContain("RAW_JOURNAL_RESOURCE_LIMIT");
  });
});
