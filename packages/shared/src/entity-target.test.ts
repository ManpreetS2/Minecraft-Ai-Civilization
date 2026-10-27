import { describe, expect, it } from "vitest";
import { classifyEntityPresence, entityGoneMessage, isEntityPresent } from "./entity-target.js";

describe("generic entity targeting", () => {
  it("classifies death as TARGET_DEAD, not out of range", () => {
    const skeleton = { id: 7, name: "skeleton", health: 0, isValid: false };
    expect(classifyEntityPresence({ 7: skeleton }, skeleton)).toBe("TARGET_DEAD");
    expect(entityGoneMessage("TARGET_DEAD", "skeleton")).toContain("TARGET_DEAD");
    expect(entityGoneMessage("TARGET_DEAD", "skeleton")).not.toMatch(/out of range/i);
  });

  it("classifies despawn/removal as ENTITY_REMOVED for any entity type", () => {
    const cow = { id: 3, name: "cow" };
    expect(classifyEntityPresence({}, cow)).toBe("ENTITY_REMOVED");
    expect(classifyEntityPresence({ 9: { id: 9, name: "villager" } }, cow)).toBe("ENTITY_REMOVED");
    expect(entityGoneMessage("ENTITY_REMOVED", "cow")).toContain("ENTITY_REMOVED");
    expect(entityGoneMessage("ENTITY_REMOVED", "cow")).not.toMatch(/out of range/i);
  });

  it("treats isValid false as dead/destroyed for villagers and hostiles alike", () => {
    const villager = { id: 4, name: "villager", isValid: false as const };
    expect(classifyEntityPresence({ 4: villager }, villager)).toBe("TARGET_DEAD");
    const zombie = { id: 5, name: "zombie", isValid: false as const };
    expect(classifyEntityPresence({ 5: zombie }, zombie)).toBe("TARGET_DEAD");
  });

  it("keeps a live tracked entity as PRESENT", () => {
    const pig = { id: 2, name: "pig", health: 8, isValid: true };
    expect(isEntityPresent({ 2: pig }, pig)).toBe(true);
    expect(classifyEntityPresence({ 2: pig }, pig)).toBe("PRESENT");
  });
});
