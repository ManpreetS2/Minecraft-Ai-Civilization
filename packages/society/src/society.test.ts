import { describe, expect, it } from "vitest";
import { applySocialEvent } from "./index.js";

describe("relationships", () => {
  it("increases trust after help and resentment after taking resources", () => {
    const base = {
      citizenId: "citizen_atlas",
      otherId: "citizen_maya",
      trust: 0,
      affection: 0,
      respect: 0,
      resentment: 0,
      familiarity: 0,
    };
    const helped = applySocialEvent(base, "helped");
    expect(helped.trust).toBeGreaterThan(0);
    const taken = applySocialEvent(helped, "took_resources");
    expect(taken.resentment).toBeGreaterThan(0);
    expect(taken.trust).toBeLessThan(helped.trust);
  });
});
