import { describe, expect, it } from "vitest";
import { validateExperimentEvidence } from "../src/validator.js";

describe("Evidence Validator Smoke", () => {
  it("initializes validator and returns not proven on empty input", () => {
    const report = validateExperimentEvidence({});
    expect(report.overallStatus).toBe("NOT_PROVEN");
  });
});
