import type { Vec3 } from "@civ/shared";
import { starterHutSize } from "./blueprint.js";

export type ShelterQuality = "none" | "known" | "reachable" | "usable" | "safe";

export function interiorStandingCells(origin: Vec3): Vec3[] {
  const { width, depth } = starterHutSize();
  const cells: Vec3[] = [];
  for (let dx = 1; dx < width - 1; dx += 1) {
    for (let dz = 1; dz < depth - 1; dz += 1) {
      cells.push({ x: origin.x + dx, y: origin.y + 1, z: origin.z + dz });
    }
  }
  if (cells.length === 0) {
    cells.push({ x: origin.x + 1, y: origin.y + 1, z: origin.z + 1 });
  }
  return cells;
}

export function isInsideShelter(position: Vec3 | undefined, origin: Vec3 | undefined): boolean {
  if (!position || !origin) return false;
  const { width, depth, wallHeight } = starterHutSize();
  return (
    position.x >= origin.x + 0.2 &&
    position.x <= origin.x + width - 0.2 &&
    position.z >= origin.z + 0.2 &&
    position.z <= origin.z + depth - 0.2 &&
    position.y >= origin.y &&
    position.y <= origin.y + wallHeight + 1
  );
}

export function classifyShelter(args: {
  origin?: Vec3;
  position?: Vec3;
  reachable?: boolean;
  hostilesNearby?: boolean;
}): ShelterQuality {
  if (!args.origin) return "none";
  if (args.reachable === false) return "known";
  if (!isInsideShelter(args.position, args.origin)) return args.reachable ? "reachable" : "known";
  if (args.hostilesNearby) return "usable";
  return "safe";
}
