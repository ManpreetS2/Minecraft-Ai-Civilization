import { describe, expect, it } from "vitest";
import { collectItem } from "./gather.js";
import type { SkillContext } from "./context.js";

function ctxWith(items: Array<{ name: string; count: number }>, entityCount = 0): SkillContext {
  const entities: Record<string, { name: string; position: { x: number; y: number; z: number } }> = {};
  for (let i = 0; i < entityCount; i += 1) {
    entities[`drop-${i}`] = { name: "item", position: { x: 1, y: 64, z: 1 } };
  }
  return {
    citizenId: "citizen_atlas",
    bot: {
      username: "Atlas",
      inventory: { items: () => items },
      entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 1 } },
      entities,
    },
    body: {
      position: () => ({ x: 0, y: 64, z: 0 }),
    },
  } as unknown as SkillContext;
}

describe("collectItem honesty", () => {
  it("does not report collected items when inventory did not increase", async () => {
    const items = [{ name: "oak_log", count: 2 }];
    const result = await collectItem(ctxWith(items, 0));
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected miss");
    expect(result.code).toBe("ITEM_NOT_FOUND");
    expect(result.details?.collected).toBe(0);
    expect(result.details?.workComplete).toBe(false);
    expect(items).toEqual([{ name: "oak_log", count: 2 }]);
  });
});
