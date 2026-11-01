import { afterEach, describe, expect, it } from "vitest";
import { Vec3 } from "vec3";
import { createNavigationBackend, setNavigationBackend } from "@civ/minecraft-adapter";
import { createMineflayerCraftFixture, createSharedCraftWorld } from "./testing/mineflayer-craft-fixture.js";
afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));
const bush = new Vec3(1, 64, 0);
describe("shared simulated drop conservation under inventory pressure", () => {
  it("keeps the uncollected part of a drop available to a second body", async () => {
    const shared = createSharedCraftWorld(); shared.blocks.set("1,64,0", "sweet_berry_bush");
    // Explicit full-inventory scenario input, not the empty-start demonstration.
    const a = createMineflayerCraftFixture({ sharedWorld: shared, inventory: [{ name: "sweet_berries", count: 63 }, { name: "oak_log", count: 35 * 64 }] });
    const b = createMineflayerCraftFixture({ sharedWorld: shared });
    await a.bot.dig(a.bot.blockAt(bush));
    expect(shared.dropped[0]!.item.count).toBe(2);
    await a.nav.navigateNear(a.ctx.bot, bush, 0.5);
    expect(a.count("sweet_berries")).toBe(64);
    expect(shared.dropped[0]?.item.count).toBe(1);
    const entity = shared.entities[String(shared.dropped[0]!.id)] as { getDroppedItem(): { count: number } };
    expect(entity.getDroppedItem().count).toBe(1);
    await b.nav.navigateNear(b.ctx.bot, bush, 0.5);
    expect(b.count("sweet_berries")).toBe(1);
    expect(shared.dropped).toHaveLength(0);
    expect(Object.keys(shared.entities)).toHaveLength(0);
    expect(a.count("sweet_berries") + b.count("sweet_berries") - 63).toBe(2);
  });
  it("leaves an entire drop in the world when the first body has no capacity", async () => {
    const shared = createSharedCraftWorld(); shared.blocks.set("1,64,0", "sweet_berry_bush");
    const a = createMineflayerCraftFixture({ sharedWorld: shared, inventory: [{ name: "sweet_berries", count: 64 }, { name: "oak_log", count: 35 * 64 }] });
    const b = createMineflayerCraftFixture({ sharedWorld: shared });
    await a.bot.dig(a.bot.blockAt(bush));
    await a.nav.navigateNear(a.ctx.bot, bush, 0.5);
    expect(a.count("sweet_berries")).toBe(64); expect(shared.dropped[0]!.item.count).toBe(2);
    await b.nav.navigateNear(b.ctx.bot, bush, 0.5);
    expect(b.count("sweet_berries")).toBe(2); expect(shared.dropped).toHaveLength(0);
  });
});
