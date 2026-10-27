import { describe, expect, it } from "vitest";
import {
  isProtectedFurnitureName,
  refuseAccidentalPropertyBreak,
  refuseAccidentalPropertyReplace,
} from "./property.js";

describe("protected furniture names", () => {
  it("treats chests, beds, and doors as protected even when namespaced", () => {
    expect(isProtectedFurnitureName("minecraft:chest")).toBe(true);
    expect(isProtectedFurnitureName("trapped_chest")).toBe(true);
    expect(isProtectedFurnitureName("yellow_bed")).toBe(true);
    expect(isProtectedFurnitureName("oak_door")).toBe(true);
    expect(isProtectedFurnitureName("coal_ore")).toBe(false);
    expect(isProtectedFurnitureName("oak_log")).toBe(false);
  });

  it("refuses breaking a chest to reach ore", () => {
    const denied = refuseAccidentalPropertyBreak("chest");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("ACCESS_DENIED");
    expect(refuseAccidentalPropertyBreak("coal_ore").ok).toBe(true);
  });

  it("refuses placing over a bed or door", () => {
    expect(refuseAccidentalPropertyReplace("red_bed").ok).toBe(false);
    expect(refuseAccidentalPropertyReplace("oak_door").ok).toBe(false);
    expect(refuseAccidentalPropertyReplace("air").ok).toBe(true);
  });
});
