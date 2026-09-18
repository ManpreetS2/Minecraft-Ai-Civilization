import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { placeBlock } from "./world.js";
import type { PlacementIntent } from "./placement.js";

export type StructureBlock = {
  dx: number;
  dy: number;
  dz: number;
  block: string;
  purpose?: PlacementIntent["purpose"];
};

export type StructurePlan = {
  id: string;
  blocks: StructureBlock[];
};

export type BlockCheck = "PLACED" | "MISSING" | "WRONG_BLOCK" | "UNREACHABLE";

export function probeShelter(): StructurePlan {
  const blocks: StructureBlock[] = [];
  const plank = (dx: number, dy: number, dz: number): StructureBlock => ({
    dx,
    dy,
    dz,
    block: "oak_planks",
    purpose: "shelter_blueprint",
  });
  for (let x = 0; x < 3; x += 1) {
    for (let z = 0; z < 3; z += 1) {
      blocks.push(plank(x, 0, z));
    }
  }
  for (let y = 1; y <= 2; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      for (let z = 0; z < 3; z += 1) {
        const wall = x === 0 || z === 0 || x === 2 || z === 2;
        const door = x === 1 && z === 0;
        if (wall && !door) blocks.push(plank(x, y, z));
      }
    }
  }
  for (let x = 0; x < 3; x += 1) {
    for (let z = 0; z < 3; z += 1) {
      blocks.push(plank(x, 3, z));
    }
  }
  blocks.push({ dx: 1, dy: 1, dz: 0, block: "oak_door", purpose: "shelter_blueprint" });
  return { id: "probe_shelter_3x3", blocks };
}

export function probeFort(): StructurePlan {
  const blocks: StructureBlock[] = [];
  const size = 5;
  for (let x = 0; x < size; x += 1) {
    for (let z = 0; z < size; z += 1) {
      const wall = x === 0 || z === 0 || x === size - 1 || z === size - 1;
      const gate = x === Math.floor(size / 2) && z === 0;
      if (wall && !gate) {
        blocks.push({ dx: x, dy: 0, dz: z, block: "cobblestone" });
        blocks.push({ dx: x, dy: 1, dz: z, block: "cobblestone" });
      }
    }
  }
  blocks.push({ dx: 2, dy: 0, dz: 0, block: "oak_fence_gate", purpose: "doorway" });
  return { id: "probe_fort_5x5", blocks };
}

export function classifyStructureBlock(
  expected: string,
  actual: string | undefined,
): BlockCheck {
  if (!actual || actual === "air" || actual === "cave_air") return "MISSING";
  if (expected === "oak_door" && actual.endsWith("_door")) return "PLACED";
  if (expected === "oak_fence_gate" && actual.endsWith("_gate")) return "PLACED";
  if (actual === expected) return "PLACED";
  return "WRONG_BLOCK";
}

export function verifyStructure(
  ctx: SkillContext,
  plan: StructurePlan,
  origin: Vec3,
): { placed: number; missing: number; wrong: number; checks: Array<{ block: string; status: BlockCheck }> } {
  let placed = 0;
  let missing = 0;
  let wrong = 0;
  const checks: Array<{ block: string; status: BlockCheck }> = [];
  for (const entry of plan.blocks) {
    const pos = { x: origin.x + entry.dx, y: origin.y + entry.dy, z: origin.z + entry.dz };
    const found = ctx.bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
    const status = classifyStructureBlock(entry.block, found?.name);
    checks.push({ block: entry.block, status });
    if (status === "PLACED") placed += 1;
    else if (status === "MISSING") missing += 1;
    else wrong += 1;
  }
  return { placed, missing, wrong, checks };
}

export async function executeStructure(
  ctx: SkillContext,
  plan: StructurePlan,
  origin: Vec3,
): Promise<ActionResult<{ placed: number; missing: number; id: string }>> {
  const started = Date.now();
  for (const entry of plan.blocks) {
    const pos = { x: origin.x + entry.dx, y: origin.y + entry.dy, z: origin.z + entry.dz };
    const found = ctx.bot.blockAt(new Vec3Class(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
    if (classifyStructureBlock(entry.block, found?.name) === "PLACED") continue;
    const intent = { purpose: entry.purpose ?? "shelter_blueprint" };
    const placed = await placeBlock(ctx, entry.block, pos, intent);
    if (!placed.success) {
      return fail(placed.code === "PURPOSELESS_PLACEMENT" ? placed.code : "BUILD_BLOCKED", placed.error, Date.now() - started, true, {
        block: entry.block,
        position: pos,
      });
    }
  }
  const report = verifyStructure(ctx, plan, origin);
  if (report.missing > 0 || report.wrong > 0) {
    return fail(
      "VERIFY_FAILED",
      `${plan.id} missing=${report.missing} wrong=${report.wrong} placed=${report.placed}/${plan.blocks.length}`,
      Date.now() - started,
      true,
    );
  }
  return ok({ placed: report.placed, missing: report.missing, id: plan.id }, Date.now() - started);
}
