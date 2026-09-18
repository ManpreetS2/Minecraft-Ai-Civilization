import { fail, ok, type ActionResult } from "@civ/shared";
import type { SkillContext } from "./context.js";
import { moveTo } from "./movement.js";
import { countItem } from "./inventory-service.js";

type VillagerTrade = {
  inputItem1?: { name?: string; count?: number };
  inputItem2?: { name?: string; count?: number };
  outputItem?: { name?: string; count?: number };
};

type VillagerWindow = {
  trades?: VillagerTrade[];
  close: () => void;
};

function entityKey(name: string | undefined): string {
  return (name ?? "").toLowerCase().replace(/^minecraft:/, "");
}

export async function tradeWithVillager(
  ctx: SkillContext,
): Promise<ActionResult<{ profession?: string; input?: string; output?: string; count: number }>> {
  const started = Date.now();
  const origin = ctx.bot.entity?.position;
  if (!origin) return fail("NOT_CONNECTED", "Not spawned", Date.now() - started);
  const villager = Object.values(ctx.bot.entities).find((entity) => {
    if (!entity.position || entity === ctx.bot.entity) return false;
    return entityKey(entity.name) === "villager" && origin.distanceTo(entity.position) < 16;
  });
  if (!villager?.position) {
    return fail("ENTITY_NOT_FOUND", "No villager nearby", Date.now() - started, true);
  }
  const moved = await moveTo(ctx, { x: villager.position.x, y: villager.position.y, z: villager.position.z }, 2.5);
  if (!moved.success) return moved;
  let window: VillagerWindow | undefined;
  try {
    window = (await ctx.bot.openVillager(villager)) as unknown as VillagerWindow;
    const trades = window.trades ?? [];
    const trade = trades.find((entry) => {
      const input = entry.inputItem1?.name;
      return Boolean(input && countItem(ctx, input) >= (entry.inputItem1?.count ?? 1));
    });
    if (!trade || !trade.inputItem1?.name || !trade.outputItem?.name) {
      window.close();
      return fail("TRADE_UNAVAILABLE", "Villager has no currently affordable trade", Date.now() - started, true);
    }
    const input = trade.inputItem1.name;
    const output = trade.outputItem.name;
    const beforeIn = countItem(ctx, input);
    const beforeOut = countItem(ctx, output);
    const index = trades.indexOf(trade);
    await ctx.bot.trade(window as never, index, 1);
    window.close();
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (countItem(ctx, input) >= beforeIn || countItem(ctx, output) <= beforeOut) {
      return fail("VERIFY_FAILED", "Trade did not change inventories", Date.now() - started, true);
    }
    return ok(
      {
        profession: (villager as { profession?: string }).profession,
        input,
        output,
        count: countItem(ctx, output) - beforeOut,
      },
      Date.now() - started,
    );
  } catch (error) {
    try {
      window?.close();
    } catch {
      // ignore
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/trade|villager|window/i.test(message)) {
      return fail("TRADE_UNAVAILABLE", message, Date.now() - started, true);
    }
    return fail("INTERACTION_FAILED", message, Date.now() - started, true);
  }
}
