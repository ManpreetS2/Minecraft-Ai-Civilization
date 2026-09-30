import { describe, expect, it } from "vitest";
import { FishingCycleCoordinator } from "./fishing-cycle.js";

describe("owner-aware fishing concurrency regression", () => {
  it("supports two bots casting simultaneously with distinct bobber ownership", () => {
    const coord = new FishingCycleCoordinator();
    expect(coord.cast("kai", { id: 101, ownerBotId: "kai", position: { x: 1, y: 62, z: 1 } }).ok).toBe(true);
    expect(coord.cast("atlas", { id: 202, ownerBotId: "atlas", position: { x: 4, y: 62, z: 4 } }).ok).toBe(true);
    expect(coord.get("kai")?.bobber?.id).toBe(101);
    expect(coord.get("atlas")?.bobber?.id).toBe(202);
    expect(coord.activeBobberIds().sort()).toEqual([101, 202]);
  });

  it("ignores foreign particle and foreign biting metadata", () => {
    const coord = new FishingCycleCoordinator();
    coord.cast("kai", { id: 101, ownerBotId: "kai", position: { x: 1, y: 62, z: 1 } });
    coord.cast("atlas", { id: 202, ownerBotId: "atlas", position: { x: 4, y: 62, z: 4 } });

    expect(
      coord.shouldRespondToParticle("kai", {
        name: "fishing",
        position: { x: 4, y: 62, z: 4 },
        entityId: 202,
      }),
    ).toBe(false);

    expect(
      coord.shouldRespondToBite("kai", { entityId: 202, ownerBotId: "atlas" }),
    ).toBe(false);

    expect(coord.shouldRespondToBite("kai", { entityId: 101, ownerBotId: "kai" })).toBe(true);
    expect(coord.shouldRespondToParticle("atlas", { name: "fishing", position: { x: 4, y: 62, z: 4 }, entityId: 202 })).toBe(true);
  });

  it("handles staggered bites independently", () => {
    const coord = new FishingCycleCoordinator();
    coord.cast("kai", { id: 101, ownerBotId: "kai", position: { x: 1, y: 62, z: 1 } });
    coord.cast("atlas", { id: 202, ownerBotId: "atlas", position: { x: 4, y: 62, z: 4 } });

    const kaiCatch = coord.reel("kai", { name: "cod", count: 1 });
    expect(kaiCatch?.itemName).toBe("cod");
    expect(coord.get("kai")?.casting).toBe(false);
    expect(coord.get("atlas")?.casting).toBe(true);

    const atlasCatch = coord.reel("atlas", { name: "salmon", count: 1 });
    expect(atlasCatch?.itemName).toBe("salmon");
    expect(coord.get("atlas")?.casting).toBe(false);
  });

  it("duplicate cast does not toggle rod", () => {
    const coord = new FishingCycleCoordinator();
    coord.cast("kai", { id: 101, ownerBotId: "kai", position: { x: 1, y: 62, z: 1 } });
    const dup = coord.cast("kai", { id: 101, ownerBotId: "kai", position: { x: 1, y: 62, z: 1 } });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe("already_casting");
    expect(coord.get("kai")?.casting).toBe(true);
    expect(coord.get("kai")?.bobber?.id).toBe(101);
  });

  it("timeout and cancel affect only that bot", () => {
    const coord = new FishingCycleCoordinator();
    coord.cast("kai", { id: 101, ownerBotId: "kai", position: { x: 1, y: 62, z: 1 } });
    coord.cast("atlas", { id: 202, ownerBotId: "atlas", position: { x: 4, y: 62, z: 4 } });

    coord.timeout("kai");
    expect(coord.get("kai")?.timedOut).toBe(true);
    expect(coord.get("kai")?.casting).toBe(false);
    expect(coord.get("atlas")?.casting).toBe(true);

    coord.cancel("atlas");
    expect(coord.get("atlas")?.cancelled).toBe(true);
    expect(coord.get("atlas")?.casting).toBe(false);
    // kai remains timed out but atlas cancel did not clear kai state incorrectly
    expect(coord.get("kai")?.timedOut).toBe(true);
  });

  it("does not count old chest contents as new catch; keeps storage isolation", () => {
    const coord = new FishingCycleCoordinator();
    const record = {
      botId: "kai",
      itemName: "cod",
      count: 1,
      chestBefore: [
        { name: "cod", count: 3 },
        { name: "stick", count: 2 },
      ],
      chestAfter: [
        { name: "cod", count: 4 },
        { name: "stick", count: 2 },
      ],
    };
    expect(coord.countNewCatchFromChest(record)).toBe(1);

    const atlasChest = {
      botId: "atlas",
      itemName: "cod",
      count: 1,
      chestBefore: [{ name: "cod", count: 5 }],
      chestAfter: [{ name: "cod", count: 5 }],
    };
    // Atlas chest unchanged — kai's catch must not appear as atlas deposit.
    expect(coord.countNewCatchFromChest(atlasChest)).toBe(0);
  });
});
