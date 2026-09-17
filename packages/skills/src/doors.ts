import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { navigationBackend } from "@civ/minecraft-adapter";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlock } from "./observe.js";
import { lookAtPosition } from "./look.js";

const WOODEN_DOORS = [
  "oak_door",
  "spruce_door",
  "birch_door",
  "jungle_door",
  "acacia_door",
  "dark_oak_door",
  "mangrove_door",
  "cherry_door",
  "bamboo_door",
  "pale_oak_door",
];

const FENCE_GATES = [
  "oak_fence_gate",
  "spruce_fence_gate",
  "birch_fence_gate",
  "jungle_fence_gate",
  "acacia_fence_gate",
  "dark_oak_fence_gate",
  "mangrove_fence_gate",
  "cherry_fence_gate",
  "bamboo_fence_gate",
  "pale_oak_fence_gate",
];

export async function openDoor(
  ctx: SkillContext,
  position?: Vec3,
): Promise<ActionResult<{ position: Vec3; opened: boolean; kind: string }>> {
  return activateBarrier(ctx, position, [...WOODEN_DOORS], "door");
}

export async function openFenceGate(
  ctx: SkillContext,
  position?: Vec3,
): Promise<ActionResult<{ position: Vec3; opened: boolean; kind: string }>> {
  return activateBarrier(ctx, position, FENCE_GATES, "gate");
}

async function activateBarrier(
  ctx: SkillContext,
  position: Vec3 | undefined,
  names: string[],
  kind: "door" | "gate",
): Promise<ActionResult<{ position: Vec3; opened: boolean; kind: string }>> {
  const started = Date.now();
  const knowledge = minecraftKnowledge();
  const target = position
    ? { success: true as const, data: { name: kind, position } }
    : await findBlock(ctx, names, 8);
  if (!target.success) return target;
  const moved = await navigationBackend().navigateToInteractWithBlock(ctx.bot, target.data.position, {
    timeoutMs: ctx.timeoutMs ?? 12_000,
    signal: ctx.signal,
  });
  if (!moved.success) return moved;
  const block = ctx.bot.blockAt(
    new Vec3Class(Math.floor(target.data.position.x), Math.floor(target.data.position.y), Math.floor(target.data.position.z)),
  );
  if (!block) {
    return fail("BLOCK_NOT_FOUND", `${kind} vanished`, Date.now() - started, true);
  }
  if (knowledge.isIronDoor(block.name)) {
    return fail("INVALID_ARGUMENT", "Iron doors cannot be opened by hand", Date.now() - started, false, {
      item: block.name,
    });
  }
  const matches = kind === "door" ? knowledge.isWoodenDoor(block.name) : knowledge.isFenceGate(block.name);
  if (!matches) {
    return fail("BLOCK_NOT_FOUND", `Expected a wooden ${kind}, found ${block.name}`, Date.now() - started, true);
  }
  await lookAtPosition(ctx, target.data.position);
  try {
    const props = (block as { getProperties?: () => { open?: boolean } }).getProperties?.();
    if (props?.open) return ok({ position: target.data.position, opened: true, kind: block.name }, Date.now() - started);
    await ctx.bot.activateBlock(block);
  } catch (error) {
    return fail("PLACE_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  const after = ctx.bot.blockAt(
    new Vec3Class(Math.floor(target.data.position.x), Math.floor(target.data.position.y), Math.floor(target.data.position.z)),
  );
  const opened = (after as { getProperties?: () => { open?: boolean } } | null)?.getProperties?.()?.open;
  return ok({ position: target.data.position, opened: opened !== false, kind: after?.name ?? block.name }, Date.now() - started);
}
