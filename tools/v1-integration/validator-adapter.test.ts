import { describe, expect, it } from "vitest";
import { bundleFixture } from "./bundle-fixture.js";
import { validateBundle } from "./manifest.js";
import { adaptAntigravityReport, type AntigravityReport } from "./validator-adapter.js";
function fixture(): AntigravityReport { return { version: "1.0.0", validatorName: "antigravity-evidence-validator", experimentId: "fixture-1", sourceSha: "a".repeat(40), mode: "offline_simulated", overallStatus: "VERIFIED", attribution: { runId: "fixture-1", citizens: ["gpt-a", "claude-a"] }, notProven: [] }; }
describe("Antigravity Phase 1/2 report adapter", () => {
  it("maps a fixture verdict without turning it into independently verified acceptance", () => {
    const run = bundleFixture(); run.validator = adaptAntigravityReport(run, fixture(), "validator.json");
    expect(run.validator.verdict).toBe("PASS"); expect(validateBundle(run).verdict).toBe("NOT PROVEN");
  });
  it.each(["sha", "mode", "citizen", "run"])("rejects mismatched %s", (kind) => {
    const report = fixture();
    if (kind === "sha") report.sourceSha = "b".repeat(40);
    if (kind === "mode") report.mode = "real_minecraft";
    if (kind === "citizen") report.attribution.citizens = ["other"];
    if (kind === "run") report.attribution.runId = "other";
    expect(() => adaptAntigravityReport(bundleFixture(), report, "validator.json")).toThrow(/mismatch/);
  });
  it("retains upstream missing evidence and violation verdicts", () => {
    const report = fixture(); report.notProven = [{ code: "MISSING_SERVER_TICK", missingFields: ["serverGameTick"] }];
    expect(adaptAntigravityReport(bundleFixture(), report, "validator.json").verdict).toBe("NOT PROVEN");
    report.overallStatus = "VIOLATIONS_DETECTED";
    expect(adaptAntigravityReport(bundleFixture(), report, "validator.json").verdict).toBe("FAIL");
  });
});
