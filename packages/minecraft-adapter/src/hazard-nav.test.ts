import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import {
  attemptHazardBridge,
  bypassCells,
  cellIsUnsafeToEnter,
  classifyHazardName,
  evaluateHazardBridge,
  hazardAhead,
  isSafeDetour,
  pathContainsUnsafeCell,
  planHazardRecovery,
  retreatCell,
  retreatCellIfVerified,
  sameLevelWalkGraph,
  towardHazardColumn,
} from "./hazard-nav.js";
import { evaluateStepJump, releaseMovementControls } from "./step-jump.js";

function fakeBot(
  cells: Record<string, { name: string; boundingBox: string }>,
  origin = { x: 5.5, y: 64, z: 5.5 },
  extra: Partial<Bot> = {},
): Bot {
  const controls: Record<string, boolean> = {};
  return {
    username: "MechProbe",
    entity: { position: { ...origin }, onGround: true, yaw: 0, pitch: 0 },
    inventory: { items: () => [] },
    blockAt(pos: { x: number; y: number; z: number }) {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      return cells[key] ?? { name: "air", boundingBox: "empty" };
    },
    setControlState(name: string, value: boolean) {
      controls[name] = value;
    },
    getControlState(name: string) {
      return Boolean(controls[name]);
    },
    clearControlStates() {
      for (const key of Object.keys(controls)) controls[key] = false;
    },
    supportFeature: () => false,
    _controls: controls,
    ...extra,
  } as unknown as Bot;
}

function pad(): Record<string, { name: string; boundingBox: string }> {
  const cells: Record<string, { name: string; boundingBox: string }> = {};
  for (let x = 0; x <= 12; x += 1) {
    for (let z = 0; z <= 12; z += 1) {
      cells[`${x},63,${z}`] = { name: "grass_block", boundingBox: "block" };
      cells[`${x},64,${z}`] = { name: "air", boundingBox: "empty" };
      cells[`${x},65,${z}`] = { name: "air", boundingBox: "empty" };
    }
  }
  return cells;
}

describe("lava magma and falls", () => {
  it("halts toward lava and names a retreat and bypass cell", () => {
    const cells = pad();
    cells["6,64,5"] = { name: "lava", boundingBox: "empty" };
    cells["6,63,5"] = { name: "stone", boundingBox: "block" };
    const bot = fakeBot(cells);
    const hazard = hazardAhead(bot, { x: 8, y: 64, z: 5 });
    expect(hazard?.kind).toBe("lava");
    expect(hazard?.cell).toEqual({ x: 6, y: 64, z: 5 });
    expect(evaluateStepJump(bot, { x: 8, y: 64, z: 5 }).ok).toBe(false);
    const back = retreatCell({ x: 5.5, y: 64, z: 5.5 }, { dx: 1, dz: 0 });
    expect(back.x).toBe(4);
    const around = bypassCells(bot, { x: 5.5, y: 64, z: 5.5 }, { dx: 1, dz: 0 });
    expect(around.some((cell) => cell.z !== 5)).toBe(true);
  });

  it("plans a real cobble cover over lava when construction and scaffold are allowed", () => {
    const cells = pad();
    cells["6,64,5"] = { name: "lava", boundingBox: "empty" };
    cells["6,65,5"] = { name: "air", boundingBox: "empty" };
    cells["5,65,5"] = { name: "stone", boundingBox: "block" };
    const bot = fakeBot(cells, { x: 4.5, y: 64, z: 5.5 });
    const denied = evaluateHazardBridge(bot, { x: 6, y: 64, z: 5 }, { allowConstruction: false, inventory: [{ name: "cobblestone", count: 8 }] });
    expect(denied.ok).toBe(false);
    const noItem = evaluateHazardBridge(bot, { x: 6, y: 64, z: 5 }, { allowConstruction: true, inventory: [] });
    expect(noItem.ok).toBe(false);
    const plan = evaluateHazardBridge(bot, { x: 6, y: 64, z: 5 }, {
      allowConstruction: true,
      inventory: [{ name: "cobblestone", count: 8 }],
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.item).toBe("cobblestone");
      expect(plan.placeAt).toEqual({ x: 6, y: 65, z: 5 });
      expect(plan.placeAt).not.toEqual({ x: 4, y: 64, z: 5 });
    }
  });

  it("fails explicitly when lava has no safe crossing", () => {
    const cells = pad();
    for (let z = 0; z <= 12; z += 1) {
      cells[`6,64,${z}`] = { name: "lava", boundingBox: "empty" };
      cells[`7,64,${z}`] = { name: "lava", boundingBox: "empty" };
    }
    const bot = fakeBot(cells);
    const plan = evaluateHazardBridge(bot, { x: 6, y: 64, z: 5 }, {
      allowConstruction: true,
      inventory: [{ name: "cobblestone", count: 1 }],
    });
    expect(plan.ok).toBe(false);
    const around = bypassCells(bot, { x: 5.5, y: 64, z: 5.5 }, { dx: 1, dz: 0 });
    expect(around.every((cell) => cell.x < 6)).toBe(true);
    expect(isSafeDetour(bot, { x: 5.5, y: 64, z: 5.5 }, { x: 6, y: 64, z: 6 })).toBe(false);
  });

  it("treats magma as a disallowed landing and prefers another standing cell", () => {
    const cells = pad();
    cells["6,63,5"] = { name: "magma_block", boundingBox: "block" };
    cells["6,64,5"] = { name: "air", boundingBox: "empty" };
    const bot = fakeBot(cells);
    expect(classifyHazardName("magma_block")).toBe("magma");
    const hazard = hazardAhead(bot, { x: 8, y: 64, z: 5 });
    expect(hazard?.kind).toBe("magma");
    const jump = evaluateStepJump(bot, { x: 8, y: 65, z: 5 });
    expect(jump.ok).toBe(false);
  });

  it("rejects lava-pit standing cells and unverified fall landings", () => {
    const cells = pad();
    cells["6,63,5"] = { name: "lava", boundingBox: "empty" };
    cells["6,64,5"] = { name: "air", boundingBox: "empty" };
    const bot = fakeBot(cells);
    expect(cellIsUnsafeToEnter(bot, { x: 6, y: 64, z: 5 })).toBe(true);
    expect(isSafeDetour(bot, { x: 5.5, y: 64, z: 5.5 }, { x: 6, y: 64, z: 6 })).toBe(false);
    expect(isSafeDetour(bot, { x: 5.5, y: 64, z: 5.5 }, { x: 6, y: 64, z: 5 })).toBe(false);
    const around = bypassCells(bot, { x: 5.5, y: 64, z: 5.5 }, { dx: 1, dz: 0 });
    expect(around.some((cell) => cell.x === 6 && cell.z === 5)).toBe(false);
    expect(pathContainsUnsafeCell(bot, [{ x: 6, y: 64, z: 5 }], 64)).toBe(true);
    const hazard = hazardAhead(bot, { x: 8, y: 64, z: 5 });
    expect(hazard?.kind === "lava" || hazard?.kind === "fall").toBe(true);
    const back = retreatCellIfVerified(bot, { x: 5.5, y: 64, z: 5.5 }, { dx: 1, dz: 0 });
    expect(back).toEqual({ x: 4, y: 64, z: 5 });
  });

  it("does not place a bridge unless construction is authorized", async () => {
    const cells = pad();
    cells["6,64,5"] = { name: "lava", boundingBox: "empty" };
    let placed = 0;
    const bot = fakeBot(cells, { x: 4.5, y: 64, z: 5.5 }, {
      inventory: { items: () => [{ name: "cobblestone", count: 8 }] },
      equip: async () => undefined,
      lookAt: async () => undefined,
      placeBlock: async () => {
        placed += 1;
      },
    } as unknown as Partial<Bot>);
    const denied = await attemptHazardBridge(bot, { x: 6, y: 64, z: 5 }, { allowConstruction: false });
    expect(denied.success).toBe(false);
    if (!denied.success) expect(denied.code).toBe("HAZARD_BLOCKED");
    expect(placed).toBe(0);
  });

  it("releases movement controls after a cancelled hazard recovery", () => {
    const bot = fakeBot(pad());
    bot.setControlState("forward", true);
    bot.setControlState("jump", true);
    releaseMovementControls(bot);
    const controls = (bot as unknown as { _controls: Record<string, boolean> })._controls;
    expect(controls.jump).toBe(false);
    expect(controls.forward).toBe(false);
  });

  it("replans around a village rooftop drop on a verified same-Y roof, not by teleporting down", () => {
    const cells = pad();
    for (let x = 3; x <= 6; x += 1) {
      for (let z = 4; z <= 7; z += 1) {
        cells[`${x},69,${z}`] = { name: "oak_planks", boundingBox: "block" };
        cells[`${x},70,${z}`] = { name: "air", boundingBox: "empty" };
        cells[`${x},71,${z}`] = { name: "air", boundingBox: "empty" };
      }
    }
    for (let y = 64; y <= 69; y += 1) {
      cells[`7,${y},5`] = { name: "air", boundingBox: "empty" };
    }
    const bot = fakeBot(cells, { x: 5.5, y: 70, z: 5.5 });
    const hazard = hazardAhead(bot, { x: 10, y: 64, z: 5 });
    expect(hazard?.kind).toBe("fall");
    const plan = planHazardRecovery(bot, { x: 5.5, y: 70, z: 5.5 }, { x: 10, y: 64, z: 5 }, hazard!);
    expect(plan.action).toBe("bypass");
    if (plan.action === "bypass") {
      expect(plan.drop).toBe(0);
      expect(plan.cell.y).toBe(70);
      expect(plan.cell.z === 5 && plan.cell.x === 7).toBe(false);
      expect(towardHazardColumn({ x: 5.5, y: 70, z: 5.5 }, plan.cell, hazard!)).toBe(false);
      expect(cellIsUnsafeToEnter(bot, plan.cell)).toBe(false);
    }
  });

  it("walks around an L-shaped roof hole on same-Y planks instead of the drop edge", () => {
    const cells = pad();
    for (let x = 3; x <= 6; x += 1) {
      for (let z = 4; z <= 5; z += 1) {
        cells[`${x},69,${z}`] = { name: "oak_planks", boundingBox: "block" };
        cells[`${x},70,${z}`] = { name: "air", boundingBox: "empty" };
        cells[`${x},71,${z}`] = { name: "air", boundingBox: "empty" };
      }
    }
    for (let x = 3; x <= 10; x += 1) {
      for (let z = 6; z <= 8; z += 1) {
        cells[`${x},69,${z}`] = { name: "oak_planks", boundingBox: "block" };
        cells[`${x},70,${z}`] = { name: "air", boundingBox: "empty" };
        cells[`${x},71,${z}`] = { name: "air", boundingBox: "empty" };
      }
    }
    for (let y = 64; y <= 69; y += 1) {
      cells[`7,${y},5`] = { name: "air", boundingBox: "empty" };
      cells[`8,${y},5`] = { name: "air", boundingBox: "empty" };
    }
    const bot = fakeBot(cells, { x: 5.5, y: 70, z: 5.5 });
    const origin = { x: 5.5, y: 70, z: 5.5 };
    const target = { x: 10, y: 64, z: 5 };
    const hazard = hazardAhead(bot, target);
    expect(hazard?.kind).toBe("fall");
    expect(isSafeDetour(bot, origin, { x: 8, y: 70, z: 7 })).toBe(false);
    const graph = sameLevelWalkGraph(bot, origin, { avoid: hazard ? [hazard.cell] : [] });
    expect([...graph.values()].some((node) => node.cell.x >= 8 && node.cell.z >= 6)).toBe(true);
    const plan = planHazardRecovery(bot, origin, target, hazard!);
    expect(plan.action).toBe("bypass");
    if (plan.action === "bypass") {
      expect(plan.drop).toBe(0);
      expect(plan.cell).toEqual({ x: 5, y: 70, z: 6 });
      expect(plan.cell.x === 6 && plan.cell.z === 5).toBe(false);
      expect(cellIsUnsafeToEnter(bot, plan.cell)).toBe(false);
    }
  });

  it("takes a verified side drop off a 1-wide ridge instead of walking off the front", () => {
    const cells = pad();
    for (let x = 5; x <= 6; x += 1) {
      cells[`${x},69,5`] = { name: "oak_planks", boundingBox: "block" };
      cells[`${x},70,5`] = { name: "air", boundingBox: "empty" };
      cells[`${x},71,5`] = { name: "air", boundingBox: "empty" };
    }
    cells["5,67,6"] = { name: "oak_planks", boundingBox: "block" };
    cells["5,68,6"] = { name: "air", boundingBox: "empty" };
    cells["5,69,6"] = { name: "air", boundingBox: "empty" };
    for (let y = 64; y <= 69; y += 1) {
      cells[`7,${y},5`] = { name: "air", boundingBox: "empty" };
      cells[`4,${y},5`] = { name: "air", boundingBox: "empty" };
    }
    const bot = fakeBot(cells, { x: 5.5, y: 70, z: 5.5 });
    const hazard = hazardAhead(bot, { x: 10, y: 64, z: 5 });
    expect(hazard?.kind).toBe("fall");
    const plan = planHazardRecovery(bot, { x: 5.5, y: 70, z: 5.5 }, { x: 10, y: 64, z: 5 }, hazard!);
    expect(plan.action).toBe("bypass");
    if (plan.action === "bypass") {
      expect(plan.drop).toBe(2);
      expect(plan.cell).toEqual({ x: 5, y: 68, z: 6 });
      expect(plan.cell.x === 6 && plan.cell.z === 5).toBe(false);
    }
  });

  it("blocks a 1-wide ridge with no safe landing instead of teleporting down", () => {
    const cells = pad();
    for (let x = 5; x <= 6; x += 1) {
      cells[`${x},69,5`] = { name: "oak_planks", boundingBox: "block" };
      cells[`${x},70,5`] = { name: "air", boundingBox: "empty" };
      cells[`${x},71,5`] = { name: "air", boundingBox: "empty" };
    }
    for (let y = 64; y <= 69; y += 1) {
      cells[`7,${y},5`] = { name: "air", boundingBox: "empty" };
      cells[`4,${y},5`] = { name: "air", boundingBox: "empty" };
    }
    const bot = fakeBot(cells, { x: 5.5, y: 70, z: 5.5 });
    const hazard = hazardAhead(bot, { x: 10, y: 64, z: 5 });
    expect(hazard?.kind).toBe("fall");
    const plan = planHazardRecovery(bot, { x: 5.5, y: 70, z: 5.5 }, { x: 10, y: 64, z: 5 }, hazard!);
    expect(plan.action).toBe("blocked");
    if (plan.action === "blocked") expect(plan.reason).toMatch(/will not teleport or break structures/);
  });

  it("does not tunnel through a wall to invent a same-level bypass", () => {
    const cells = pad();
    cells["6,64,5"] = { name: "lava", boundingBox: "empty" };
    cells["6,63,5"] = { name: "stone", boundingBox: "block" };
    cells["5,64,6"] = { name: "cobblestone", boundingBox: "block" };
    cells["5,65,6"] = { name: "cobblestone", boundingBox: "block" };
    cells["5,64,4"] = { name: "cobblestone", boundingBox: "block" };
    cells["5,65,4"] = { name: "cobblestone", boundingBox: "block" };
    const bot = fakeBot(cells);
    const origin = { x: 5.5, y: 64, z: 5.5 };
    const hazard = hazardAhead(bot, { x: 8, y: 64, z: 5 });
    expect(hazard?.kind).toBe("lava");
    const graph = sameLevelWalkGraph(bot, origin, { avoid: hazard ? [hazard.cell] : [] });
    expect([...graph.values()].some((node) => node.cell.z === 6 && node.cell.x === 5)).toBe(false);
    const plan = planHazardRecovery(bot, origin, { x: 8, y: 64, z: 5 }, hazard!);
    if (plan.action === "bypass") {
      expect(plan.cell).toEqual({ x: 4, y: 64, z: 5 });
      expect(cells[`${plan.cell.x},${plan.cell.y},${plan.cell.z}`]?.boundingBox).not.toBe("block");
    } else {
      expect(plan.reason).toMatch(/will not teleport or break structures/);
    }
  });

  it("refuses lava with no bypass instead of inventing a crossing", () => {
    const cells = pad();
    for (let x = 0; x <= 12; x += 1) {
      for (let z = 0; z <= 12; z += 1) {
        if (x === 5 && z === 5) continue;
        cells[`${x},64,${z}`] = { name: "lava", boundingBox: "empty" };
        cells[`${x},63,${z}`] = { name: "lava", boundingBox: "empty" };
      }
    }
    const bot = fakeBot(cells);
    const hazard = hazardAhead(bot, { x: 10, y: 64, z: 5 });
    expect(hazard?.kind).toBe("lava");
    const plan = planHazardRecovery(bot, { x: 5.5, y: 64, z: 5.5 }, { x: 10, y: 64, z: 5 }, hazard!);
    expect(plan.action).toBe("blocked");
    if (plan.action === "blocked") expect(plan.reason).toMatch(/will not teleport or break structures/);
  });

  it("takes a lava side bypass when a verified same-Y cell exists", () => {
    const cells = pad();
    cells["6,64,5"] = { name: "lava", boundingBox: "empty" };
    cells["6,63,5"] = { name: "stone", boundingBox: "block" };
    const bot = fakeBot(cells);
    const hazard = hazardAhead(bot, { x: 8, y: 64, z: 5 });
    expect(hazard?.kind).toBe("lava");
    const plan = planHazardRecovery(bot, { x: 5.5, y: 64, z: 5.5 }, { x: 8, y: 64, z: 5 }, hazard!);
    expect(plan.action).toBe("bypass");
    if (plan.action === "bypass") {
      expect(plan.drop).toBe(0);
      expect(plan.cell.z).not.toBe(5);
      expect(classifyHazardName(cells[`${plan.cell.x},64,${plan.cell.z}`]?.name)).not.toBe("lava");
    }
  });

  it("does not invent a bypass by stepping through a chest or bed", () => {
    const cells = pad();
    cells["6,64,5"] = { name: "lava", boundingBox: "empty" };
    cells["6,63,5"] = { name: "stone", boundingBox: "block" };
    for (const z of [4, 6]) {
      cells[`5,64,${z}`] = { name: "chest", boundingBox: "block" };
      cells[`5,65,${z}`] = { name: "air", boundingBox: "empty" };
      cells[`6,64,${z}`] = { name: "yellow_bed", boundingBox: "block" };
      cells[`6,65,${z}`] = { name: "air", boundingBox: "empty" };
    }
    const bot = fakeBot(cells);
    const hazard = hazardAhead(bot, { x: 8, y: 64, z: 5 });
    expect(hazard?.kind).toBe("lava");
    const plan = planHazardRecovery(bot, { x: 5.5, y: 64, z: 5.5 }, { x: 8, y: 64, z: 5 }, hazard!);
    if (plan.action === "bypass") {
      const standing = cells[`${plan.cell.x},${plan.cell.y},${plan.cell.z}`];
      expect(standing?.name).not.toMatch(/chest|_bed$/);
      expect(cellIsUnsafeToEnter(bot, plan.cell)).toBe(false);
    } else {
      expect(plan.reason).toMatch(/will not teleport or break structures/);
    }
  });
});
