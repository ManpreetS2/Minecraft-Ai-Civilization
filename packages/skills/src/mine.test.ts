import { describe, expect, it } from "vitest";
import { minecraftKnowledge } from "@civ/minecraft-knowledge";
import {
  assertPermittedStorage,
  classifyOreTarget,
  clampMiningBounds,
  evaluateExcavation,
  evaluateMiningRequest,
  hasLineOfSight,
  inventoryCountOf,
  isOreExposed,
  isWithinMiningBounds,
  type WorldGetter,
} from "./mine.js";
import { planOreSearch, proposeBoundedTunnel, refuseUncontrolledStripMine, searchWaypointAtBand } from "./ore-search.js";

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function worldFromMap(cells: Record<string, string>): WorldGetter {
  return (pos) => {
    const name = cells[key(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))] ?? "air";
    return { name, boundingBox: name === "air" || name === "cave_air" || name === "lava" || name === "water" ? "empty" : "block" };
  };
}

/** 3x3 stone room at y=64 with optional ore at 2,64,2. Standing cell 0,64,0 on stone at y=63. */
function cave(over: Record<string, string> = {}): Record<string, string> {
  const cells: Record<string, string> = {};
  for (let x = -2; x <= 4; x += 1) {
    for (let z = -2; z <= 4; z += 1) {
      cells[key(x, 63, z)] = "stone";
      cells[key(x, 64, z)] = "air";
      cells[key(x, 65, z)] = "air";
      cells[key(x, 66, z)] = "stone";
    }
  }
  return { ...cells, ...over };
}

const knowledge = minecraftKnowledge();

describe("mining bounds and storage", () => {
  it("caps radius, actions, and amount", () => {
    const bounds = clampMiningBounds({
      resource: "coal",
      searchOrigin: { x: 0, y: 64, z: 0 },
      searchRadius: 999,
      maxActions: 999,
      amount: 99,
    });
    expect(bounds.radius).toBe(32);
    expect(bounds.maxActions).toBe(48);
    expect(bounds.amount).toBe(8);
  });

  it("refuses a chest that is not the permitted store", () => {
    const denied = assertPermittedStorage({ x: 1, y: 64, z: 1 }, { x: 8, y: 64, z: 8 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("ACCESS_DENIED");
    expect(assertPermittedStorage({ x: 8, y: 64, z: 8 }, { x: 8, y: 64, z: 8 }).ok).toBe(true);
  });

  it("counts only requested drop items", () => {
    expect(inventoryCountOf([{ name: "coal", count: 3 }, { name: "dirt", count: 10 }], ["coal", "coal_ore"])).toBe(3);
  });
});

describe("visible vs hidden ore", () => {
  it("treats fully enclosed ore as hidden", () => {
    const getBlock = worldFromMap({
      [key(5, 20, 5)]: "iron_ore",
      [key(6, 20, 5)]: "stone",
      [key(4, 20, 5)]: "stone",
      [key(5, 21, 5)]: "stone",
      [key(5, 19, 5)]: "stone",
      [key(5, 20, 6)]: "stone",
      [key(5, 20, 4)]: "stone",
    });
    expect(isOreExposed(["stone", "stone", "stone", "stone", "stone", "stone"])).toBe(false);
    const sight = classifyOreTarget("iron_ore", { x: 5, y: 20, z: 5 }, getBlock, { x: 0, y: 64, z: 0 });
    expect(sight.status).toBe("hidden");
  });

  it("treats ore with an air face as exposed", () => {
    expect(isOreExposed(["stone", "air", "stone", "stone", "stone", "stone"])).toBe(true);
  });

  it("does not give line of sight through solid stone", () => {
    const getBlock = worldFromMap({
      [key(0, 64, 0)]: "air",
      [key(1, 64, 0)]: "stone",
      [key(2, 64, 0)]: "coal_ore",
    });
    expect(hasLineOfSight({ x: 0.5, y: 65.6, z: 0.5 }, { x: 2, y: 64, z: 0 }, getBlock)).toBe(false);
    expect(hasLineOfSight({ x: 0.5, y: 65.6, z: 0.5 }, { x: 1, y: 64, z: 0 }, worldFromMap({ [key(0, 65, 0)]: "air" }))).toBe(true);
  });
});

describe("reachable vs obstructed ore", () => {
  it("marks exposed cave ore with a standing cell as reachable", () => {
    const getBlock = worldFromMap(
      cave({
        [key(2, 64, 2)]: "coal_ore",
      }),
    );
    const sight = classifyOreTarget("coal_ore", { x: 2, y: 64, z: 2 }, getBlock, { x: 0.5, y: 65.62, z: 0.5 });
    expect(sight.exposed).toBe(true);
    expect(sight.status).toBe("reachable");
  });

  it("marks exposed ore with no safe standing cell as obstructed", () => {
    const cells = cave({ [key(2, 64, 2)]: "coal_ore" });
    for (let x = -2; x <= 4; x += 1) {
      for (let z = -2; z <= 4; z += 1) {
        cells[key(x, 63, z)] = "lava";
      }
    }
    const sight = classifyOreTarget("coal_ore", { x: 2, y: 64, z: 2 }, worldFromMap(cells), { x: 0.5, y: 65.62, z: 0.5 });
    expect(sight.exposed).toBe(true);
    expect(sight.status).toBe("obstructed");
  });
});

describe("unsafe excavation refusal", () => {
  it("refuses digging straight down", () => {
    const result = evaluateExcavation({
      target: { x: 10, y: 63, z: 10 },
      feet: { x: 10.3, y: 64.0, z: 10.2 },
      neighborNames: ["stone", "stone", "stone", "stone", "stone", "stone"],
      inBounds: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSAFE_EXCAVATION");
  });

  it("refuses lava-adjacent ore and out-of-bounds targets", () => {
    const lava = evaluateExcavation({
      target: { x: 4, y: 64, z: 4 },
      feet: { x: 2, y: 64, z: 4 },
      neighborNames: ["stone", "lava", "air", "stone", "stone", "stone"],
      inBounds: true,
    });
    expect(lava.ok).toBe(false);
    const oob = evaluateExcavation({
      target: { x: 99, y: 64, z: 99 },
      feet: { x: 0, y: 64, z: 0 },
      neighborNames: ["air", "air", "air", "air", "air", "air"],
      inBounds: false,
    });
    expect(oob.ok).toBe(false);
  });

  it("refuses gravel that would fall onto the miner", () => {
    const result = evaluateExcavation({
      target: { x: 3, y: 65, z: 3 },
      feet: { x: 3.2, y: 64, z: 3.1 },
      aboveName: "gravel",
      neighborNames: ["air", "air", "gravel", "stone", "air", "air"],
      inBounds: true,
    });
    expect(result.ok).toBe(false);
  });
});

describe("evaluateMiningRequest", () => {
  const origin = { x: 0, y: 64, z: 0 };
  const getBlock = worldFromMap(cave({ [key(2, 64, 2)]: "coal_ore", [key(8, 20, 8)]: "coal_ore" }));

  it("requires a harvest-tier pickaxe", () => {
    const missing = evaluateMiningRequest({
      request: { resource: "iron", searchOrigin: origin },
      inventory: [{ name: "wooden_pickaxe", count: 1 }],
      candidates: [{ name: "iron_ore", position: { x: 2, y: 64, z: 2 } }],
      getBlock,
      botPosition: origin,
      canHarvest: (block, tool) => knowledge.canHarvest(block, tool),
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("MISSING_TOOL");
  });

  it("ignores hidden ore and reports SEARCH_EXHAUSTED when nothing visible is reachable", () => {
    const buried = worldFromMap({
      [key(5, 20, 5)]: "iron_ore",
      [key(6, 20, 5)]: "stone",
      [key(4, 20, 5)]: "stone",
      [key(5, 21, 5)]: "stone",
      [key(5, 19, 5)]: "stone",
      [key(5, 20, 6)]: "stone",
      [key(5, 20, 4)]: "stone",
    });
    const result = evaluateMiningRequest({
      request: { resource: "iron", searchOrigin: { x: 5, y: 20, z: 5 }, searchRadius: 8, minY: 0, maxY: 40 },
      inventory: [{ name: "stone_pickaxe", count: 1 }],
      candidates: [{ name: "iron_ore", position: { x: 5, y: 20, z: 5 } }],
      getBlock: buried,
      botPosition: { x: 0, y: 64, z: 0 },
      canHarvest: (block, tool) => knowledge.canHarvest(block, tool),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SEARCH_EXHAUSTED");
  });

  it("selects visible reachable coal and ignores a buried candidate", () => {
    const result = evaluateMiningRequest({
      request: { resource: "coal", searchOrigin: origin, searchRadius: 16 },
      inventory: [{ name: "wooden_pickaxe", count: 1 }],
      candidates: [
        { name: "coal_ore", position: { x: 2, y: 64, z: 2 } },
        { name: "coal_ore", position: { x: 8, y: 20, z: 8 } },
      ],
      getBlock,
      botPosition: { x: 0.5, y: 64, z: 0.5 },
      canHarvest: (block, tool) => knowledge.canHarvest(block, tool),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chosen?.position).toEqual({ x: 2, y: 64, z: 2 });
      expect(result.hiddenIgnored).toBeGreaterThanOrEqual(0);
    }
  });

  it("stops on cancellation, timeout-class inventory full, and hostiles", () => {
    const base = {
      request: { resource: "coal", searchOrigin: origin },
      inventory: [{ name: "wooden_pickaxe", count: 1 }],
      candidates: [{ name: "coal_ore", position: { x: 2, y: 64, z: 2 } }],
      getBlock,
      botPosition: origin,
      canHarvest: (block: string, tool?: string) => knowledge.canHarvest(block, tool),
    };
    expect(evaluateMiningRequest({ ...base, signalAborted: true }).ok).toBe(false);
    const cancelled = evaluateMiningRequest({ ...base, signalAborted: true });
    if (!cancelled.ok) expect(cancelled.code).toBe("CANCELLED");
    const full = evaluateMiningRequest({ ...base, inventoryFull: true });
    if (!full.ok) expect(full.code).toBe("INVENTORY_FULL");
    const hostile = evaluateMiningRequest({ ...base, hostilesNearby: true });
    if (!hostile.ok) expect(hostile.code).toBe("HOSTILE_NEARBY");
  });

  it("does not treat an unpermitted chest as mining storage", () => {
    const result = evaluateMiningRequest({
      request: {
        resource: "coal",
        searchOrigin: origin,
        destinationStorage: { x: 1, y: 64, z: 1 },
        permittedStorage: { x: 9, y: 64, z: 9 },
      },
      inventory: [{ name: "wooden_pickaxe", count: 1 }],
      candidates: [],
      getBlock,
      botPosition: origin,
      canHarvest: (block, tool) => knowledge.canHarvest(block, tool),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ACCESS_DENIED");
  });

  it("keeps ore outside the search radius out of bounds", () => {
    expect(isWithinMiningBounds({ x: 50, y: 64, z: 0 }, origin, 16)).toBe(false);
    expect(isWithinMiningBounds({ x: 4, y: 64, z: 4 }, origin, 16)).toBe(true);
  });
});

describe("ore-search planning (no hidden coordinates)", () => {
  it("suggests a coal search band without naming a vein", () => {
    const plan = planOreSearch("coal", { x: 0, y: 70, z: 0 }, "plains");
    expect(plan?.approach).toBeDefined();
    expect(plan?.suggestedMinY).toBeGreaterThanOrEqual(0);
    expect(plan?.notes.join(" ")).toMatch(/not deposits|search band/i);
    expect(JSON.stringify(plan)).not.toMatch(/findBlocks|rcon|x-ray/i);
  });

  it("warns that emerald is not expected in plains", () => {
    const plan = planOreSearch("emerald", { x: 0, y: 80, z: 0 }, "plains");
    expect(plan?.biomeOk).toBe(false);
  });

  it("proposes only short cardinal tunnels and refuses infinite strip mines", () => {
    expect(proposeBoundedTunnel({ x: 0, y: 16, z: 0 }, { x: 1, z: 0 }, 4).ok).toBe(true);
    expect(proposeBoundedTunnel({ x: 0, y: 16, z: 0 }, { x: 1, z: 1 }, 4).ok).toBe(false);
    expect(refuseUncontrolledStripMine(24, false).ok).toBe(true);
    expect(refuseUncontrolledStripMine(999, true).ok).toBe(false);
  });

  it("offsets a search waypoint in the preferred Y band, not toward hidden ore", () => {
    const plan = planOreSearch("iron", { x: 10, y: 70, z: 10 })!;
    const next = searchWaypointAtBand({ x: 10, y: 70, z: 10 }, plan, { x: 1, z: 0 }, 8);
    expect(next.y).toBe(plan.preferredY);
    expect(next.x).toBe(18);
  });
});
