import { describe, expect, it } from "vitest";
import { classifySkill } from "./skill-result.js";
import { fail, ok } from "@civ/shared";
import { missingPrerequisites, prerequisiteChain, recipeFor } from "./obtain.js";

describe("skill result schemas", () => {
  it("classifies verified outcomes", () => {
    expect(classifySkill(ok({ collected: 1 }, 10))).toBe("SUCCESS");
    expect(classifySkill(fail("MISSING_TOOL", "need pickaxe", 4, true))).toBe("PREREQUISITE_MISSING");
    expect(classifySkill(fail("TARGET_UNREACHABLE", "no path", 4, true))).toBe("BLOCKED");
    expect(classifySkill(fail("INTERRUPTED", "abort", 1, true))).toBe("INTERRUPTED");
    expect(classifySkill(fail("DIG_FAILED", "broke", 8, true))).toBe("FAILED");
  });
});

describe("obtainItem prerequisite chaining", () => {
  it("resolves stone pickaxe through wood then cobble", () => {
    const chain = prerequisiteChain("stone_pickaxe");
    expect(chain[0]).toBe("oak_log");
    expect(recipeFor("stone_pickaxe")?.kind).toBe("craft");
  });

  it("skips already-held ingredients", () => {
    const missing = missingPrerequisites(
      { oak_planks: 8, stick: 4, cobblestone: 3 },
      "stone_pickaxe",
    );
    expect(missing).toEqual(["stone_pickaxe"]);
  });

  it("asks for cobble after wood tools exist", () => {
    const missing = missingPrerequisites({ oak_planks: 16, stick: 8 }, "stone_pickaxe");
    expect(missing).toContain("cobblestone");
    expect(missing).not.toContain("oak_log");
  });
});
