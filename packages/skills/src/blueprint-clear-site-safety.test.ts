import { describe, expect, it } from "vitest";
import { isProtectedFurnitureName } from "@civ/minecraft-knowledge";

/**
 * clearSite must refuse protected furniture (Mission 006A).
 * Full dig path is covered via name guard; this locks the policy dependency.
 */
describe("clearSite furniture safety policy", () => {
  it("treats chest/bed/door as protected furniture names", () => {
    expect(isProtectedFurnitureName("chest")).toBe(true);
    expect(isProtectedFurnitureName("oak_door")).toBe(true);
    expect(isProtectedFurnitureName("red_bed")).toBe(true);
    expect(isProtectedFurnitureName("short_grass")).toBe(false);
    expect(isProtectedFurnitureName("oak_leaves")).toBe(false);
  });
});
