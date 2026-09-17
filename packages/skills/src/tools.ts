import { fail, ok, type ActionResult } from "@civ/shared";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import { equipItem } from "./inventory.js";
import type { SkillContext } from "./context.js";

export async function equipForBlock(ctx: SkillContext, blockName: string): Promise<ActionResult<{ item?: string }>> {
  const started = Date.now();
  const knowledge = minecraftKnowledge();
  const inventory = ctx.bot.inventory.items().map((item) => ({ name: item.name, count: item.count }));
  const held = knowledge.preferredToolForInventory(blockName, inventory);
  if (!held) {
    if (!knowledge.canHarvest(blockName, undefined)) {
      return fail("MISSING_TOOL", `Need a suitable tool to harvest ${blockName}`, Date.now() - started, true);
    }
    return ok({ item: undefined }, Date.now() - started);
  }
  const equipped = await equipItem(ctx, held);
  if (!equipped.success) return equipped;
  return ok({ item: held }, Date.now() - started);
}
