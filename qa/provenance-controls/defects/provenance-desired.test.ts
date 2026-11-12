// The SAME scenarios as test/scenarios.ts, asserted the way PR #119 section 6 requires: each must NOT be real_minecraft/VERIFIED.
// RED today by design (each is an UNIMPLEMENTED defense, not a regression). A test turning green means the defense landed; then move the scenario's
// characterization test to an [ENFORCED] one.
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../test/scenarios.js";

describe("desired behaviour for unimplemented defenses (red = not yet implemented)", () => {
  for (const s of SCENARIOS) {
    it(`${s.gap} ${s.name}: must not be authentic`, () => {
      const r = s.run();
      expect(r.mode === "real_minecraft" && r.overallStatus === "VERIFIED").toBe(false);
    });
  }
});
