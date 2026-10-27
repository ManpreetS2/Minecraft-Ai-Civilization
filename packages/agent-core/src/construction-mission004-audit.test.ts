/**
 * Mission 004 — adversarial audit regressions.
 * Distinguishes proven offline logic from unverified Mineflayer assumptions.
 */
import { describe, expect, it, vi } from "vitest";
import {
  WORKSHOP_CABIN_ID,
  blockMatchesPlan,
  expandBlueprint,
  getBlueprint,
  remainingAfterPartialBuild,
  resolveMaterials,
  worldPosition,
} from "@civ/minecraft-knowledge";
import { ok, type ActionResult } from "@civ/shared";
import type { BuildSession, SkillContext } from "@civ/skills";
import { SettlementRuntime } from "./settlement-runtime.js";
import {
  runWorkshopCabinOfflineAcceptance,
  seedFlatPad,
  simGetBlock,
  simulatePlaceNext,
  type SimWorld,
} from "./construction-offline-engine.js";
import { executeBuildStructurePlan, type AdvanceBuildFn } from "./build-structure.js";
import { selectConstructionSite } from "./construction-site-select.js";
import type { PlannedTask } from "./planner.js";

function stubPlan(item: string): PlannedTask {
  return {
    goal: "contribute_to_project",
    task: "build_structure",
    action: "buildStructure",
    source: "planner",
    reason: "mission004_audit",
    priority: 1,
    item,
  };
}

describe("Mission 004 adversarial: simulator ≠ production placer", () => {
  it("offline acceptance is simulatedOnly and never needs advanceBlueprintBuild", async () => {
    const result = await runWorkshopCabinOfflineAcceptance({ interruptAfter: 4 });
    expect(result.simulatedOnly).toBe(true);
    expect(result.phase).toBe("COMPLETED");
    // Harness proves map-write completion, not Mineflayer placeBlock / neighbor support / nav.
    expect(result.worldVerifiedComplete).toBe(true);
  }, 30_000);

  it("plans door lower+upper; exact identity only (Mission 005)", () => {
    const blueprint = getBlueprint(WORKSHOP_CABIN_ID)!;
    const materials = resolveMaterials(blueprint, {
      oak_planks: 200,
      oak_door: 1,
      chest: 1,
      torch: 1,
      crafting_table: 1,
    });
    const expanded = expandBlueprint(blueprint, materials, "south", [
      "chest",
      "lighting",
      "crafting_table",
    ]);
    const lower = expanded.blocks.find((b) => b.multiblockPart === "door_lower");
    const upper = expanded.blocks.find((b) => b.multiblockPart === "door_upper");
    expect(lower).toBeTruthy();
    expect(upper?.impliedBySibling).toBe(true);
    expect(blockMatchesPlan(lower!, "oak_door", materials)).toBe(true);
    expect(blockMatchesPlan(lower!, "spruce_door", materials)).toBe(false);
  });

  it("simulatePlaceNext does not require a supporting neighbor (unlike live placeBlock)", () => {
    const blueprint = getBlueprint(WORKSHOP_CABIN_ID)!;
    const materials = resolveMaterials(blueprint, { oak_planks: 200, oak_door: 1 });
    const expanded = expandBlueprint(blueprint, materials, "south", []);
    const world: SimWorld = new Map();
    const origin = { x: 0, y: 70, z: 0 };
    // Seed every planned cell as air with NO solid neighbors anywhere — live placeBlock
    // would fail "no supporting neighbor"; the offline simulator still succeeds.
    for (const block of expanded.blocks) {
      const pos = worldPosition(origin, block.dx, block.dy, block.dz, blueprint.footprint, "south");
      world.set(`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`, "air");
    }
    const inventory = { oak_planks: 64, oak_door: 1 };
    const satisfied = new Set<number>();
    // Mark skipIfSolid foundation indices satisfied so next pick is a free-floating floor/wall.
    expanded.blocks.forEach((block, index) => {
      if (block.skipIfSolid) satisfied.add(index);
    });
    const step = simulatePlaceNext({
      expanded,
      origin,
      facing: "south",
      world,
      inventory,
      satisfied,
    });
    expect(step.simulated).toBe(true);
    expect(step.ok).toBe(true);
    expect(step.item).toBeTruthy();
  });
});

describe("Mission 004 adversarial: production site selection wiring", () => {
  it("executeBuildStructurePlan without plan.target refuses unsafe body-adjacent build when pad unloaded", async () => {
    const runtime = new SettlementRuntime();
    const world: SimWorld = new Map(); // unloaded → site select must fail closed
    const getBlock = simGetBlock(world);
    const advance = vi.fn(async (_ctx: SkillContext, session: BuildSession) =>
      ok({ session, stage: "FOUNDATION" as const, placedThisCall: 0 }, 0),
    ) as unknown as AdvanceBuildFn;
    const ctx = {
      citizenId: "citizen_atlas",
      body: { position: () => ({ x: 10, y: 70, z: 10 }) },
      bot: {
        inventory: { items: () => [] },
        entity: { position: { x: 10, y: 70, z: 10 } },
        blockAt: () => undefined,
      },
    } as unknown as SkillContext;

    const result: ActionResult = await executeBuildStructurePlan({
      ctx,
      plan: stubPlan(WORKSHOP_CABIN_ID),
      runtime,
      getBlock,
      advance,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("SITE_UNSUITABLE");
    expect(advance).not.toHaveBeenCalled();
  });

  it("executeBuildStructurePlan selects a loaded pad instead of building at body feet", async () => {
    const runtime = new SettlementRuntime();
    const world: SimWorld = new Map();
    const body = { x: 500, y: 70, z: 500 };
    // Seed a pad offset from body so site-select rings can find it; leave body volume empty of pad
    seedFlatPad(world, { x: 508, y: 70, z: 500 }, 20, 20, 70);
    const getBlock = simGetBlock(world);
    const selected = selectConstructionSite({
      blueprint: getBlueprint(WORKSHOP_CABIN_ID)!,
      from: body,
      citizenId: "citizen_atlas",
      runtime,
      getBlock,
      facing: "south",
      radius: 16,
    });
    expect(selected.ok).toBe(true);

    const advance = vi.fn(async (_ctx: SkillContext, session: BuildSession) =>
      ok({ session, stage: "FOUNDATION" as const, placedThisCall: 0 }, 0),
    ) as unknown as AdvanceBuildFn;
    const inventory = [
      { name: "oak_planks", count: 200 },
      { name: "oak_door", count: 1 },
      { name: "chest", count: 1 },
      { name: "torch", count: 1 },
      { name: "crafting_table", count: 1 },
    ];
    const ctx = {
      citizenId: "citizen_atlas",
      body: { position: () => body },
      bot: {
        inventory: { items: () => inventory },
        entity: { position: body },
        blockAt: (pos: { x: number; y: number; z: number }) => {
          const name = getBlock({ x: pos.x, y: pos.y, z: pos.z });
          return name ? { name } : undefined;
        },
      },
    } as unknown as SkillContext;

    const result = await executeBuildStructurePlan({
      ctx,
      plan: stubPlan(WORKSHOP_CABIN_ID),
      runtime,
      getBlock,
      advance,
    });

    expect(result.success).toBe(true);
    expect(runtime.project?.site).toBeTruthy();
    const site = runtime.project!.site!;
    // Must not silently use body feet as origin when a safer pad exists.
    expect(Math.floor(site.x) === Math.floor(body.x) && Math.floor(site.z) === Math.floor(body.z)).toBe(
      false,
    );
  });
});

describe("Mission 004 adversarial: COMPLETED gate", () => {
  it("remainingAfterPartialBuild refuses COMPLETE when any planned cell is unknown", () => {
    const origin = { x: 0, y: 70, z: 0 };
    const remaining = remainingAfterPartialBuild(WORKSHOP_CABIN_ID, origin, "south", () => undefined);
    expect(remaining.unknown).toBeGreaterThan(0);
    expect(remaining.missing + remaining.wrong + remaining.unknown).toBeGreaterThan(0);
    expect(remaining.correct).toBe(0);
  });

  it("H9-style protected furniture in footprint stays PROTECTED_CONFLICT", () => {
    const blueprint = getBlueprint(WORKSHOP_CABIN_ID)!;
    const materials = resolveMaterials(blueprint, {
      oak_planks: 200,
      oak_door: 1,
      chest: 1,
      torch: 1,
      crafting_table: 1,
    });
    const expanded = expandBlueprint(blueprint, materials, "south", ["chest", "lighting", "crafting_table"]);
    const origin = { x: 0, y: 70, z: 0 };
    const chestPos = worldPosition(
      origin,
      expanded.blocks.find((b) => b.role === "chest")!.dx,
      expanded.blocks.find((b) => b.role === "chest")!.dy,
      expanded.blocks.find((b) => b.role === "chest")!.dz,
      blueprint.footprint,
      "south",
    );
    // Occupy a wall cell with foreign chest (settlement property)
    const wall = expanded.blocks.find((b) => b.role === "wall" || b.category === "WALL_MATERIAL")!;
    const wallPos = worldPosition(origin, wall.dx, wall.dy, wall.dz, blueprint.footprint, "south");
    const getBlock = (pos: { x: number; y: number; z: number }) => {
      if (
        Math.floor(pos.x) === Math.floor(wallPos.x) &&
        Math.floor(pos.y) === Math.floor(wallPos.y) &&
        Math.floor(pos.z) === Math.floor(wallPos.z)
      ) {
        return "chest";
      }
      return "air";
    };
    const remaining = remainingAfterPartialBuild(WORKSHOP_CABIN_ID, origin, "south", getBlock);
    expect(remaining.protectedConflicts).toBeGreaterThan(0);
    void chestPos;
  });
});
