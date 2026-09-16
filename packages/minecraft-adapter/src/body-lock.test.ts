import { describe, expect, it } from "vitest";
import { pidAlive } from "./body-lock.js";

describe("pidAlive", () => {
  it("reports the current process as alive", () => {
    expect(pidAlive(process.pid)).toBe(true);
  });

  it("reports a likely-dead pid as not alive", () => {
    expect(pidAlive(999_999_999)).toBe(false);
  });
});
