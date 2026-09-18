import type { Vec3 } from "@civ/shared";
import { Vec3 as Vec3Class } from "vec3";

export type PlacementPurpose =
  | "shelter_blueprint"
  | "doorway"
  | "sleeping_berth"
  | "household_storage"
  | "temporary_worksite"
  | "project_workstation";

export type PlacementIntent = {
  item?: string;
  purpose: PlacementPurpose;
  projectId?: string;
  structureId?: string;
  targetRegion?: string;
  temporary?: boolean;
  cleanupPolicy?: "leave" | "pickup_when_idle";
};

export type WorldCell = {
  name: string;
  boundingBox?: string;
};

export type PlacementDecision = {
  ok: boolean;
  code?: "PURPOSELESS_PLACEMENT" | "PLACE_FAILED";
  reason?: string;
};

const REPLACEABLE = new Set([
  "air",
  "cave_air",
  "void_air",
  "short_grass",
  "grass",
  "tall_grass",
  "fern",
  "dead_bush",
  "snow",
]);

export function isFunctionalItem(name: string): boolean {
  const n = name.replace(/^minecraft:/, "");
  return (
    n.endsWith("_bed") ||
    n.endsWith("_door") ||
    n === "crafting_table" ||
    n === "furnace" ||
    n === "blast_furnace" ||
    n === "smoker" ||
    n === "chest" ||
    n === "barrel" ||
    n === "trapped_chest"
  );
}

export function isSolidCell(cell: WorldCell | undefined): boolean {
  if (!cell) return false;
  if (REPLACEABLE.has(cell.name)) return false;
  if (cell.boundingBox === "empty") return false;
  return cell.boundingBox === "block" || (!cell.boundingBox && !REPLACEABLE.has(cell.name));
}

function isReplaceableCell(cell: WorldCell | undefined): boolean {
  if (!cell) return true;
  return REPLACEABLE.has(cell.name) || cell.boundingBox === "empty";
}

function hasRoof(
  getBlock: (x: number, y: number, z: number) => WorldCell | undefined,
  x: number,
  y: number,
  z: number,
): boolean {
  return isSolidCell(getBlock(x, y + 2, z)) || isSolidCell(getBlock(x, y + 3, z));
}

function horizontalSolids(
  getBlock: (x: number, y: number, z: number) => WorldCell | undefined,
  x: number,
  y: number,
  z: number,
): number {
  return [
    getBlock(x + 1, y, z),
    getBlock(x - 1, y, z),
    getBlock(x, y, z + 1),
    getBlock(x, y, z - 1),
  ].filter(isSolidCell).length;
}

function isDoorwayOpening(
  getBlock: (x: number, y: number, z: number) => WorldCell | undefined,
  x: number,
  y: number,
  z: number,
): boolean {
  if (!isReplaceableCell(getBlock(x, y, z)) || !isReplaceableCell(getBlock(x, y + 1, z))) return false;
  if (!isSolidCell(getBlock(x, y - 1, z))) return false;
  const eastWest =
    isSolidCell(getBlock(x + 1, y, z)) &&
    isSolidCell(getBlock(x - 1, y, z)) &&
    isSolidCell(getBlock(x + 1, y + 1, z)) &&
    isSolidCell(getBlock(x - 1, y + 1, z));
  const northSouth =
    isSolidCell(getBlock(x, y, z + 1)) &&
    isSolidCell(getBlock(x, y, z - 1)) &&
    isSolidCell(getBlock(x, y + 1, z + 1)) &&
    isSolidCell(getBlock(x, y + 1, z - 1));
  if (!eastWest && !northSouth) return false;
  const approaches = eastWest
    ? [
        { x, y, z: z + 1 },
        { x, y, z: z - 1 },
      ]
    : [
        { x: x + 1, y, z },
        { x: x - 1, y, z },
      ];
  return approaches.some(
    (cell) =>
      isReplaceableCell(getBlock(cell.x, cell.y, cell.z)) &&
      isReplaceableCell(getBlock(cell.x, cell.y + 1, cell.z)) &&
      isSolidCell(getBlock(cell.x, cell.y - 1, cell.z)),
  );
}

function isInteriorish(
  getBlock: (x: number, y: number, z: number) => WorldCell | undefined,
  x: number,
  y: number,
  z: number,
): boolean {
  return hasRoof(getBlock, x, y, z) || horizontalSolids(getBlock, x, y, z) >= 2;
}

/**
 * Mechanical support is not enough. Functional blocks need a purpose and a
 * Minecraft-sensible context (doorway, roofed berth, worksite, blueprint).
 */
export function evaluateFunctionalPlacement(args: {
  item: string;
  purpose?: PlacementPurpose;
  position: Vec3;
  getBlock: (x: number, y: number, z: number) => WorldCell | undefined;
}): PlacementDecision {
  const item = args.item.replace(/^minecraft:/, "");
  if (!isFunctionalItem(item)) return { ok: true };
  const x = Math.floor(args.position.x);
  const y = Math.floor(args.position.y);
  const z = Math.floor(args.position.z);
  const purpose = args.purpose;

  if (!purpose) {
    return {
      ok: false,
      code: "PURPOSELESS_PLACEMENT",
      reason: `${item} cannot be placed just because it is in inventory.`,
    };
  }

  if (item.endsWith("_bed")) {
    if (purpose !== "sleeping_berth" && purpose !== "shelter_blueprint") {
      return { ok: false, code: "PURPOSELESS_PLACEMENT", reason: "Beds require a sleeping/housing purpose." };
    }
    if (!isSolidCell(args.getBlock(x, y - 1, z))) {
      return { ok: false, code: "PLACE_FAILED", reason: "Bed needs a solid block underneath." };
    }
    if (!hasRoof(args.getBlock, x, y, z)) {
      return { ok: false, code: "PURPOSELESS_PLACEMENT", reason: "Beds belong under a roof, not in an open field." };
    }
    const headNeighbors = [
      { x: x + 1, z },
      { x: x - 1, z },
      { x, z: z + 1 },
      { x, z: z - 1 },
    ];
    const headOk = headNeighbors.some(
      (cell) => isReplaceableCell(args.getBlock(cell.x, y, cell.z)) && isSolidCell(args.getBlock(cell.x, y - 1, cell.z)),
    );
    if (!headOk) {
      return { ok: false, code: "PLACE_FAILED", reason: "Bed needs a second support cell for the head." };
    }
    return { ok: true };
  }

  if (item.endsWith("_door")) {
    if (purpose !== "doorway" && purpose !== "shelter_blueprint") {
      return { ok: false, code: "PURPOSELESS_PLACEMENT", reason: "Doors require a real doorway or building opening." };
    }
    if (!isDoorwayOpening(args.getBlock, x, y, z)) {
      return {
        ok: false,
        code: "PURPOSELESS_PLACEMENT",
        reason: "Freestanding doors in open terrain are not valid.",
      };
    }
    return { ok: true };
  }

  if (item === "crafting_table" || item === "furnace" || item === "blast_furnace" || item === "smoker") {
    if (purpose !== "temporary_worksite" && purpose !== "shelter_blueprint" && purpose !== "project_workstation") {
      return {
        ok: false,
        code: "PURPOSELESS_PLACEMENT",
        reason: `${item} needs a worksite or building purpose, not a random path dump.`,
      };
    }
    if (!isSolidCell(args.getBlock(x, y - 1, z))) {
      return { ok: false, code: "PLACE_FAILED", reason: `${item} needs support underneath.` };
    }
    const below = args.getBlock(x, y - 1, z);
    if (below?.name === "dirt_path" || below?.name.endsWith("_path")) {
      return { ok: false, code: "PURPOSELESS_PLACEMENT", reason: `Do not dump a ${item} on a village path.` };
    }
    if (isDoorwayOpening(args.getBlock, x, y, z)) {
      return { ok: false, code: "PLACE_FAILED", reason: `Do not block a doorway with a ${item}.` };
    }
    return { ok: true };
  }

  if (item === "chest" || item === "barrel" || item === "trapped_chest") {
    if (purpose !== "household_storage" && purpose !== "shelter_blueprint" && purpose !== "project_workstation") {
      return { ok: false, code: "PURPOSELESS_PLACEMENT", reason: "Chests belong to storage, household, or a project." };
    }
    if (!isSolidCell(args.getBlock(x, y - 1, z))) {
      return { ok: false, code: "PLACE_FAILED", reason: "Chest needs support underneath." };
    }
    if (purpose !== "project_workstation" && !isInteriorish(args.getBlock, x, y, z)) {
      return { ok: false, code: "PURPOSELESS_PLACEMENT", reason: "Chests should sit in a sheltered interior." };
    }
    return { ok: true };
  }

  return { ok: true };
}

export function worldGetterFromBot(bot: {
  blockAt: (pos: Vec3Class) => { name: string; boundingBox?: string } | null;
}): (x: number, y: number, z: number) => WorldCell | undefined {
  return (x, y, z) => {
    const block = bot.blockAt(new Vec3Class(Math.floor(x), Math.floor(y), Math.floor(z)));
    return block ? { name: block.name, boundingBox: block.boundingBox } : undefined;
  };
}
