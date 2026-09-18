import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { navigationBackend } from "@civ/minecraft-adapter";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlock } from "./observe.js";
import { countItem } from "./inventory-service.js";
import { lookAtPosition } from "./look.js";

const FURNACES = ["furnace", "smoker", "blast_furnace"];
const FUELS = ["coal", "charcoal", "oak_planks", "spruce_planks", "birch_planks", "stick"];

type FurnaceWindow = {
  fuelItem: () => { name: string; count: number; type: number } | null;
  inputItem: () => { name: string; count: number; type: number } | null;
  outputItem: () => { name: string; count: number; type: number } | null;
  putInput: (type: number, metadata: number | null, count: number) => Promise<unknown>;
  putFuel: (type: number, metadata: number | null, count: number) => Promise<unknown>;
  takeOutput: () => Promise<unknown>;
  close: () => void;
};

export function preferredFuel(ctx: SkillContext): string | undefined {
  return FUELS.find((name) => countItem(ctx, name) > 0);
}

function itemType(ctx: SkillContext, name: string): number | undefined {
  return ctx.bot.registry.itemsByName[name]?.id ?? ctx.bot.inventory.items().find((item) => item.name === name)?.type;
}

export async function smeltItem(
  ctx: SkillContext,
  input: string,
  output: string,
  count = 1,
  preferred?: Vec3,
): Promise<ActionResult<{ input: string; output: string; produced: number; workstation: string }>> {
  const started = Date.now();
  const knowledge = minecraftKnowledge();
  const inName = knowledge.normalizeItemName(input) || input;
  const outName = knowledge.normalizeItemName(output) || output;
  if (countItem(ctx, inName) < count) {
    return fail("MISSING_INGREDIENT", `Need ${count} ${inName}`, Date.now() - started, true, { item: inName });
  }
  const fuel = preferredFuel(ctx);
  if (!fuel) {
    return fail("MISSING_FUEL", "No coal/charcoal/planks/sticks for smelting", Date.now() - started, true);
  }
  const found = preferred
    ? { success: true as const, data: { name: "furnace", position: preferred } }
    : await findBlock(ctx, FURNACES, 24);
  if (!found.success) {
    return fail("WORKSTATION_UNAVAILABLE", "No furnace/smoker reachable", Date.now() - started, true);
  }
  const move = await navigationBackend().navigateToInteractWithBlock(ctx.bot, found.data.position, {
    timeoutMs: ctx.timeoutMs ?? 12_000,
    signal: ctx.signal,
  });
  if (!move.success) return move;
  const block = ctx.bot.blockAt(
    new Vec3Class(Math.floor(found.data.position.x), Math.floor(found.data.position.y), Math.floor(found.data.position.z)),
  );
  if (!block || !FURNACES.includes(block.name)) {
    return fail("WORKSTATION_UNAVAILABLE", `Expected furnace, found ${block?.name ?? "none"}`, Date.now() - started, true);
  }
  await lookAtPosition(ctx, found.data.position);
  const before = countItem(ctx, outName);
  const inType = itemType(ctx, inName);
  const fuelType = itemType(ctx, fuel);
  if (inType === undefined || fuelType === undefined) {
    return fail("UNKNOWN_ITEM", "Missing item ids for smelt", Date.now() - started, true);
  }
  let furnace: FurnaceWindow | undefined;
  try {
    furnace = (await ctx.bot.openFurnace(block)) as unknown as FurnaceWindow;
    await furnace.putInput(inType, null, count);
    if (!furnace.fuelItem()) {
      await furnace.putFuel(fuelType, null, Math.min(count, countItem(ctx, fuel)));
    }
    const deadline = Date.now() + Math.min(ctx.timeoutMs ?? 30_000, 25_000);
    while (Date.now() < deadline) {
      const out = furnace.outputItem();
      if (out && out.count >= 1) break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const produced = furnace.outputItem();
    if (!produced || produced.count < 1) {
      furnace.close();
      return fail("SMELT_FAILED", `${inName} did not produce ${outName} in time`, Date.now() - started, true);
    }
    await furnace.takeOutput();
    furnace.close();
  } catch (error) {
    try {
      furnace?.close();
    } catch {
      // ignore
    }
    return fail("SMELT_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const gained = countItem(ctx, outName) - before;
  if (gained < 1) {
    return fail("VERIFY_FAILED", `Smelt finished but ${outName} inventory did not increase`, Date.now() - started, true);
  }
  return ok({ input: inName, output: outName, produced: gained, workstation: block.name }, Date.now() - started);
}
