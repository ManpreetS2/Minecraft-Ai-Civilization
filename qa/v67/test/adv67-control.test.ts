import { describe, expect, it } from "vitest";
import { liveJournal, paramsFor, attest, validateLive } from "../lib/live.js";

describe("control: a fully consistent signed 60-minute Paper capture", () => {
  it("is the only configuration in this harness that reaches real_minecraft", () => {
    const l = liveJournal();
    const r = validateLive(l, attest(paramsFor(l)));
    console.log("CONTROL", r.overallStatus, r.mode, r.durationAudit.serverTickProven, r.durationAudit.durationComplete, r.durationAudit.reasons, r.violations.map((v) => v.code), r.notProven.map((n) => n.code));
    expect(r.sourceAttestationAudit?.proven).toBe(true);
    expect(r.mode).toBe("real_minecraft");
  });
});
