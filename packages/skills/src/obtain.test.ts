import { describe, expect, it } from "vitest";
import type { SkillContext } from "./context.js";
import { obtainItem } from "./obtain.js";
import { craftItem } from "./inventory.js";

function ctxWith(items: Array<{ name: string; count: number }>, signal?: AbortSignal): SkillContext {
  const slots: Array<{ name: string; count: number; slot: number } | null> = Array.from({ length: 46 }, () => null);
  items.forEach((item, i) => {
    slots[9 + i] = { ...item, slot: 9 + i };
  });
  return {
    citizenId: "citizen_kai",
    signal,
    bot: {
      username: "Kai",
      inventory: {
        items: () => items,
        slots,
        inventoryStart: 9,
        inventoryEnd: 44,
      },
      registry: {
        blocksByName: { crafting_table: { id: 1 } },
        itemsByName: {},
        items: {},
      },
      findBlock: () => null,
      currentWindow: null,
      entity: { position: { x: 0, y: 64, z: 0 } },
    },
    body: {
      position: () => ({ x: 0, y: 64, z: 0 }),
    },
  } as unknown as SkillContext;
}

describe("obtainItem abort", () => {
  it("returns CANCELLED for this citizen without dropping held logs", async () => {
    const ac = new AbortController();
    ac.abort();
    const items = [{ name: "oak_log", count: 8 }];
    const result = await obtainItem(ctxWith(items, ac.signal), "wooden_pickaxe");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected cancel");
    expect(result.code).toBe("CANCELLED");
    expect(result.details?.inventoryPreserved).toBe(true);
    expect(result.details?.workComplete).toBe(false);
    expect(result.details?.count).toBe(0);
    expect(items).toEqual([{ name: "oak_log", count: 8 }]);
  });

  it("does not abort a second citizen's signal", async () => {
    const kai = new AbortController();
    const atlas = new AbortController();
    kai.abort();
    const kaiResult = await obtainItem(ctxWith([{ name: "oak_log", count: 4 }], kai.signal), "stick");
    expect(kaiResult.success).toBe(false);
    if (kaiResult.success) throw new Error("expected cancel");
    expect(kaiResult.code).toBe("CANCELLED");
    expect(atlas.signal.aborted).toBe(false);
  });

  it("returns held items when the target is already in inventory even if aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await obtainItem(ctxWith([{ name: "wooden_pickaxe", count: 1 }], ac.signal), "wooden_pickaxe");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.item).toBe("wooden_pickaxe");
    expect(result.data.count).toBe(1);
  });
});

describe("craftItem abort", () => {
  it("cancels before mutating inventory", async () => {
    const ac = new AbortController();
    ac.abort();
    const items = [{ name: "oak_planks", count: 8 }];
    const result = await craftItem(ctxWith(items, ac.signal), "stick");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected cancel");
    expect(result.code).toBe("CANCELLED");
    expect(items).toEqual([{ name: "oak_planks", count: 8 }]);
  });
});
