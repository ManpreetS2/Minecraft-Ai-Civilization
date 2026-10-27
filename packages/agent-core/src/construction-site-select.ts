/**
 * Phase C — intelligent construction site selection (offline-safe).
 * Unknown/unloaded cells are never treated as empty buildable space.
 */
import type { Vec3 } from "@civ/shared";
import {
  evaluateBlueprintSite,
  getBlueprint,
  isProtectedFurnitureName,
  rotatedFootprint,
  type Cardinal,
  type KnownStructureRecord,
  type StructureBlueprint,
} from "@civ/minecraft-knowledge";
import { cellClaimKey } from "./claims.js";
import type { SettlementRuntime } from "./settlement-runtime.js";

export type SiteCandidate = {
  origin: Vec3;
  facing: Cardinal;
  score: number;
  ok: boolean;
  reason?: string;
};

export type SiteSelectResult =
  | { ok: true; site: SiteCandidate; alternatives: SiteCandidate[] }
  | { ok: false; reason: string; blockers: string[]; alternatives: SiteCandidate[] };

function rings(from: Vec3, radius: number): Vec3[] {
  const spots: Vec3[] = [];
  for (let ring = 4; ring <= radius; ring += 4) {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      spots.push({
        x: Math.floor(from.x + Math.cos(angle) * ring),
        y: Math.floor(from.y),
        z: Math.floor(from.z + Math.sin(angle) * ring),
      });
    }
  }
  return spots;
}

function volumeHasUnknown(
  origin: Vec3,
  size: { width: number; depth: number },
  height: number,
  getBlock: (pos: Vec3) => string | undefined,
): boolean {
  for (let dx = 0; dx < size.width; dx += 1) {
    for (let dz = 0; dz < size.depth; dz += 1) {
      for (let dy = -1; dy <= height; dy += 1) {
        if (getBlock({ x: origin.x + dx, y: origin.y + dy, z: origin.z + dz }) === undefined) return true;
      }
    }
  }
  return false;
}

function volumeHasProtected(
  origin: Vec3,
  size: { width: number; depth: number },
  height: number,
  getBlock: (pos: Vec3) => string | undefined,
): string | undefined {
  for (let dx = 0; dx < size.width; dx += 1) {
    for (let dz = 0; dz < size.depth; dz += 1) {
      for (let dy = 0; dy <= height; dy += 1) {
        const name = getBlock({ x: origin.x + dx, y: origin.y + dy, z: origin.z + dz });
        if (isProtectedFurnitureName(name)) return name;
      }
    }
  }
  return undefined;
}

/**
 * Pick a construction site. Never treats undefined blocks as air.
 */
export function selectConstructionSite(args: {
  blueprint: StructureBlueprint;
  from: Vec3;
  citizenId: string;
  runtime: SettlementRuntime;
  getBlock: (pos: Vec3) => string | undefined;
  facing?: Cardinal;
  knownStructures?: KnownStructureRecord[];
  radius?: number;
  now?: number;
}): SiteSelectResult {
  const facing = args.facing ?? "south";
  const size = rotatedFootprint(args.blueprint.footprint, facing);
  const height = args.blueprint.footprint.wallHeight + 1;
  const blockers: string[] = [];
  const scored: SiteCandidate[] = [];

  for (const origin of rings(args.from, args.radius ?? 32)) {
    if (volumeHasUnknown(origin, size, height, args.getBlock)) {
      continue; // never treat unloaded as empty
    }
    const protectedHit = volumeHasProtected(origin, size, height, args.getBlock);
    if (protectedHit) {
      scored.push({ origin, facing, score: 0, ok: false, reason: `protected ${protectedHit}` });
      continue;
    }
    const key = cellClaimKey(origin.x, origin.y, origin.z);
    const owner = args.runtime.claims.ownerOf("construction_site", key, args.now);
    if (owner && owner !== args.citizenId) {
      scored.push({ origin, facing, score: 0, ok: false, reason: `site claimed by ${owner}` });
      continue;
    }
    // Active project footprint overlap
    const active = args.runtime.project;
    if (active?.site && active.status !== "COMPLETED" && active.status !== "FAILED") {
      const other = getBlueprint(active.blueprintId);
      const otherSize = other
        ? rotatedFootprint(other.footprint, active.facing ?? "south")
        : { width: 4, depth: 4 };
      const ox = active.site.x;
      const oz = active.site.z;
      const overlap =
        origin.x < ox + otherSize.width + 1 &&
        origin.x + size.width + 1 > ox &&
        origin.z < oz + otherSize.depth + 1 &&
        origin.z + size.depth + 1 > oz;
      if (overlap && (active as { ownerCitizenId?: string }).ownerCitizenId !== args.citizenId) {
        scored.push({ origin, facing, score: 0, ok: false, reason: "overlaps active project" });
        continue;
      }
    }

    const check = evaluateBlueprintSite({
      blueprint: args.blueprint,
      origin,
      facing,
      getBlock: args.getBlock,
      knownStructures: args.knownStructures,
    });
    scored.push({
      origin,
      facing,
      score: check.score,
      ok: check.ok,
      reason: check.reason,
    });
  }

  const okSites = scored.filter((s) => s.ok).sort((a, b) => b.score - a.score);
  if (okSites.length === 0) {
    if (scored.every((s) => s.reason?.includes("claimed") || s.reason?.includes("overlaps"))) {
      blockers.push("SITE_CLAIM_CONFLICT");
    }
    blockers.push("NO_SUITABLE_SITE");
    return {
      ok: false,
      reason: "No suitable construction site in radius (unknown chunks never counted as empty)",
      blockers,
      alternatives: scored.filter((s) => !s.ok).slice(0, 5),
    };
  }
  return { ok: true, site: okSites[0]!, alternatives: okSites.slice(1, 4) };
}
