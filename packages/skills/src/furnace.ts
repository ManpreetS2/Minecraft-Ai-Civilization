import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import { navigationBackend } from "@civ/minecraft-adapter";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { Vec3 as Vec3Class } from "vec3";
import type { SkillContext } from "./context.js";
import { findBlock } from "./observe.js";
import { countItem } from "./inventory-service.js";
import { lookAtPosition } from "./look.js";

const FURNACES = ["furnace", "smoker", "blast_furnace"];
const FUELS = ["lava_bucket", "coal_block", "blaze_rod", "coal", "charcoal", "dried_kelp_block", "oak_planks", "spruce_planks", "birch_planks", "stick"];

/** Vanilla smelts completed by one unit of fuel. Game table, not a copied routine. */
export function smeltsPerFuelUnit(name: string): number {
  if (name === "lava_bucket") return 100;
  if (name === "coal_block") return 80;
  if (name === "dried_kelp_block") return 20;
  if (name === "blaze_rod") return 12;
  if (name === "coal" || name === "charcoal") return 8;
  if (name === "stick") return 0.5;
  if (name.endsWith("_log") || name.endsWith("_wood") || name.endsWith("_stem") || name.endsWith("_hyphae") || name.endsWith("_planks")) {
    return 1.5;
  }
  return 0;
}

export function fuelUnitsNeeded(fuelName: string, smeltCount: number): number {
  const per = smeltsPerFuelUnit(fuelName);
  if (per <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.ceil(smeltCount / per));
}

type FurnaceWindow = {
  fuelItem: () => { name: string; count: number; type: number } | null;
  inputItem: () => { name: string; count: number; type: number } | null;
  outputItem: () => { name: string; count: number; type: number } | null;
  putInput: (type: number, metadata: number | null, count: number) => Promise<unknown>;
  putFuel: (type: number, metadata: number | null, count: number) => Promise<unknown>;
  takeOutput: () => Promise<unknown>;
  takeInput?: () => Promise<unknown>;
  takeFuel?: () => Promise<unknown>;
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
      const units = Math.min(countItem(ctx, fuel), fuelUnitsNeeded(fuel, count));
      await furnace.putFuel(fuelType, null, units);
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
    if (furnace.inputItem() && furnace.takeInput) await furnace.takeInput();
    if (furnace.fuelItem() && furnace.takeFuel) await furnace.takeFuel();
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
