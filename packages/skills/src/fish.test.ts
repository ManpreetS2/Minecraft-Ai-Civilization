import { describe, expect, it } from "vitest";
import {
  adjacentWater,
  clampFishingBounds,
  evaluateFishingRequest,
  findShoreCasts,
  fishingCatchCount,
  fishingHomeStop,
  isFishingBiteSound,
  isStandingInLiquid,
  isWalkableShoreCell,
  pickNearestBobber,
  type WorldGetter,
} from "./fish.js";

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function worldFromMap(cells: Record<string, string>): WorldGetter {
  return (pos) => {
    const name = cells[key(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))] ?? "air";
    return { name, boundingBox: name === "air" || name === "water" || name === "lava" ? "empty" : "block" };
  };
}

/** Grass bank at z=0, water at z=1, stand 0,64,0 on grass at y=63. */
function shore(over: Record<string, string> = {}): Record<string, string> {
  const cells: Record<string, string> = {};
  for (let x = -2; x <= 2; x += 1) {
    cells[key(x, 63, 0)] = "grass_block";
    cells[key(x, 64, 0)] = "air";
    cells[key(x, 65, 0)] = "air";
    cells[key(x, 63, 1)] = "water";
    cells[key(x, 64, 1)] = "air";
  }
  return { ...cells, ...over };
}

describe("fishing bounds and loot counts", () => {
  it("caps radius, casts, and timeout", () => {
    const bounds = clampFishingBounds({
      searchOrigin: { x: 0, y: 64, z: 0 },
      searchRadius: 99,
      casts: 99,
      timeoutMs: 999_999,
    });
    expect(bounds.radius).toBe(16);
    expect(bounds.casts).toBe(4);
    expect(bounds.timeoutMs).toBe(90_000);
  });

  it("counts fish, junk, and treasure but not cobblestone", () => {
    expect(
      fishingCatchCount([
        { name: "cod", count: 2 },
        { name: "lily_pad", count: 1 },
        { name: "cobblestone", count: 8 },
      ]),
    ).toBe(3);
  });
});

describe("shore selection", () => {
  it("accepts a dry stand next to water and refuses standing in the water", () => {
    const getBlock = worldFromMap(shore());
    expect(isWalkableShoreCell({ x: 0, y: 64, z: 0 }, getBlock)).toBe(true);
    expect(adjacentWater({ x: 0, y: 64, z: 0 }, getBlock)).toEqual({ x: 0, y: 63, z: 1 });
    expect(isStandingInLiquid({ x: 0, y: 63, z: 1 }, getBlock)).toBe(true);
    expect(isWalkableShoreCell({ x: 0, y: 63, z: 1 }, getBlock)).toBe(false);
  });

  it("finds the nearest shore cast inside the radius", () => {
    const getBlock = worldFromMap(shore());
    const casts = findShoreCasts({ x: 0, y: 64, z: 0 }, 4, getBlock);
    expect(casts[0]?.stand).toEqual({ x: 0, y: 64, z: 0 });
    expect(casts[0]?.water).toEqual({ x: 0, y: 63, z: 1 });
  });

  it("reports SEARCH_EXHAUSTED when there is no water", () => {
    const getBlock = worldFromMap({
      [key(0, 63, 0)]: "grass_block",
      [key(0, 64, 0)]: "air",
      [key(0, 65, 0)]: "air",
    });
    const decision = evaluateFishingRequest({
      request: { searchOrigin: { x: 0, y: 64, z: 0 }, searchRadius: 4 },
      inventory: [{ name: "fishing_rod", count: 1 }],
      getBlock,
      botPosition: { x: 0.5, y: 64, z: 0.5 },
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("SEARCH_EXHAUSTED");
  });
});

describe("fishing preconditions", () => {
  it("requires a fishing rod", () => {
    const decision = evaluateFishingRequest({
      request: { searchOrigin: { x: 0, y: 64, z: 0 } },
      inventory: [{ name: "stick", count: 2 }],
      getBlock: worldFromMap(shore()),
      botPosition: { x: 0.5, y: 64, z: 0.5 },
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("MISSING_TOOL");
  });

  it("refuses fishing while standing in water", () => {
    const decision = evaluateFishingRequest({
      request: { searchOrigin: { x: 0, y: 64, z: 0 } },
      inventory: [{ name: "fishing_rod", count: 1 }],
      getBlock: worldFromMap(shore()),
      botPosition: { x: 0.5, y: 63, z: 1.5 },
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("HAZARD_BLOCKED");
  });

  it("honours abort, hostiles, inventory, and designated chest", () => {
    const getBlock = worldFromMap(shore());
    const base = {
      request: { searchOrigin: { x: 0, y: 64, z: 0 } },
      inventory: [{ name: "fishing_rod", count: 1 }],
      getBlock,
      botPosition: { x: 0.5, y: 64, z: 0.5 },
    };
    const cancelled = evaluateFishingRequest({ ...base, signalAborted: true });
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.code).toBe("CANCELLED");
    const hostile = evaluateFishingRequest({ ...base, hostilesNearby: true });
    expect(hostile.ok).toBe(false);
    if (!hostile.ok) expect(hostile.code).toBe("HOSTILE_NEARBY");
    const full = evaluateFishingRequest({ ...base, inventoryFull: true });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.code).toBe("INVENTORY_FULL");
    const denied = evaluateFishingRequest({
      ...base,
      request: {
        searchOrigin: { x: 0, y: 64, z: 0 },
        destinationStorage: { x: 1, y: 64, z: 1 },
        permittedStorage: { x: 9, y: 64, z: 9 },
      },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("ACCESS_DENIED");
  });

  it("accepts a rod, dry shore, and permitted chest", () => {
    const decision = evaluateFishingRequest({
      request: {
        searchOrigin: { x: 0, y: 64, z: 0 },
        destinationStorage: { x: 2, y: 64, z: 0 },
        permittedStorage: { x: 2, y: 64, z: 0 },
      },
      inventory: [{ name: "fishing_rod", count: 1 }],
      getBlock: worldFromMap(shore()),
      botPosition: { x: 0.5, y: 64, z: 0.5 },
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.rod).toBe("fishing_rod");
      expect(decision.shore.water).toEqual({ x: 0, y: 63, z: 1 });
    }
  });
});

describe("early return-home request", () => {
  it("stops optional fishing when bedtime travel no longer fits", () => {
    const night = fishingHomeStop({
      position: { x: 0, y: 64, z: 0 },
      home: { x: 80, y: 64, z: 80 },
      timeOfDay: 12_542,
    });
    expect(night?.shouldStopOptionalWork).toBe(true);

    const noon = fishingHomeStop({
      position: { x: 0, y: 64, z: 0 },
      home: { x: 8, y: 64, z: 0 },
      timeOfDay: 1_000,
    });
    expect(noon?.shouldStopOptionalWork).toBe(false);
    expect(fishingHomeStop({ position: { x: 0, y: 64, z: 0 }, timeOfDay: 12_542 })).toBeUndefined();
  });
});

describe("two-bot bobber isolation", () => {
  it("picks the nearest bobber and ignores generic splash sounds", () => {
    expect(isFishingBiteSound("entity.generic.splash")).toBe(false);
    expect(isFishingBiteSound("splash")).toBe(false);
    expect(isFishingBiteSound("entity.fishing_bobber.throw")).toBe(false);
    expect(isFishingBiteSound("entity.fishing_bobber.retrieve")).toBe(false);
    expect(isFishingBiteSound("entity.fishing_bobber.splash")).toBe(true);
    const mine = pickNearestBobber(
      [
        { name: "fishing_bobber", position: { x: -1044, y: 62, z: 981 } },
        { name: "fishing_bobber", position: { x: -1048, y: 62, z: 980 } },
      ],
      { x: -1042.5, y: 63, z: 980.5 },
    );
    expect(mine?.position).toEqual({ x: -1044, y: 62, z: 981 });
  });
});
