import { describe, expect, it } from "vitest";
import { fail, ok } from "@civ/shared";

describe("skill result contract", () => {
  it("uses structured success and failure", () => {
    const success = ok({ position: { x: 1, y: 2, z: 3 } }, 10);
    expect(success.success).toBe(true);
    const failure = fail("PATH_BLOCKED", "blocked", 11, true);
    expect(failure.success).toBe(false);
    expect(failure.code).toBe("PATH_BLOCKED");
  });
});
