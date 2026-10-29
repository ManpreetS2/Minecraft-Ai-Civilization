import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { eatFood } from "./inventory.js";
import type { SkillContext } from "./context.js";

function eatCtx(over: {
  food?: number;
  items?: Array<{ name: string; count: number }>;
  consume?: (bot: {
    food: number;
    items: Array<{ name: string; count: number }>;
    heldItem?: { name: string; count: number };
  }) => void;
}): SkillContext {
  const items = (over.items ?? [{ name: "bread", count: 2 }]).map((item, index) => ({
    ...item,
    slot: 9 + index,
  }));
  const slots: Array<{ name: string; count: number; slot: number } | null> = Array.from({ length: 46 }, () => null);
  items.forEach((item) => {
    slots[item.slot] = item;
  });
  const bot = {
    food: over.food ?? 8,
    items,
    heldItem: undefined as { name: string; count: number } | undefined,
    inventory: { items: () => items, slots, inventoryStart: 9, inventoryEnd: 44 },
    async equip(stack: { name: string; count: number }) {
      bot.heldItem = stack;
    },
    async consume() {
      if (over.consume) {
        over.consume(bot);
        return;
      }
      const held = items.find((item) => item.name === bot.heldItem?.name) ?? items[0];
      if (held && held.count > 0) held.count -= 1;
      bot.food = Math.min(20, bot.food + 5);
    },
  };
  return {
    bot: bot as unknown as Bot,
    body: { nearbyEntities: () => [] },
  } as unknown as SkillContext;
}

describe("eatFood verifies hunger recovery", () => {
  it("succeeds only when food is consumed and hunger rises", async () => {
    const ctx = eatCtx({ food: 8, items: [{ name: "bread", count: 2 }] });
    const result = await eatFood(ctx);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.item).toBe("bread");
    expect(result.data.food).toBe(13);
    expect(ctx.bot.inventory.items()[0]?.count).toBe(1);
  });

  it("fails VERIFY_FAILED when consume is a no-op", async () => {
    const ctx = eatCtx({
      food: 8,
      items: [{ name: "bread", count: 2 }],
      consume() {
        // Mineflayer returned without changing hunger or inventory
      },
    });
    const result = await eatFood(ctx);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("no-op eat should fail");
    expect(result.code).toBe("VERIFY_FAILED");
    expect(ctx.bot.inventory.items()[0]?.count).toBe(2);
    expect(ctx.bot.food).toBe(8);
  });

  it("fails NO_FOOD when inventory has no edible item", async () => {
    const result = await eatFood(eatCtx({ items: [{ name: "oak_log", count: 4 }] }));
    expect(result.success).toBe(false);
    if (result.success) throw new Error("logs are not food");
    expect(result.code).toBe("NO_FOOD");
  });

  it("fails when hunger is already full", async () => {
    const ctx = eatCtx({ food: 20, items: [{ name: "bread", count: 1 }] });
    const result = await eatFood(ctx);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("full hunger should not eat");
    expect(result.code).toBe("EAT_FAILED");
    expect(ctx.bot.inventory.items()[0]?.count).toBe(1);
  });

  it("does not begin eating when already cancelled", async () => {
    const ac = new AbortController();
    ac.abort();
    const ctx = eatCtx({ food: 8, items: [{ name: "bread", count: 2 }] });
    ctx.signal = ac.signal;
    const result = await eatFood(ctx);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("pre-cancelled eat should fail");
    expect(result.code).toBe("CANCELLED");
    expect(result.details?.inventoryPreserved).toBe(true);
    expect(ctx.bot.inventory.items()[0]?.count).toBe(2);
    expect(ctx.bot.food).toBe(8);
  });

  it("reports INTERRUPTED with inventoryPreserved false when cancel lands after consume", async () => {
    const ac = new AbortController();
    const ctx = eatCtx({
      food: 8,
      items: [{ name: "bread", count: 2 }],
      consume(bot) {
        const held = bot.items.find((item) => item.name === bot.heldItem?.name) ?? bot.items[0];
        if (held && held.count > 0) held.count -= 1;
        bot.food = Math.min(20, bot.food + 5);
        ac.abort();
      },
    });
    ctx.signal = ac.signal;
    const result = await eatFood(ctx);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("post-consume cancel must not report normal success");
    expect(result.code).toBe("INTERRUPTED");
    expect(result.details?.inventoryPreserved).toBe(false);
    expect(result.details?.consumed).toBe(true);
    expect(ctx.bot.inventory.items()[0]?.count).toBe(1);
  });
});
