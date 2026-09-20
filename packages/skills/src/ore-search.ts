/**
 * Ore-search planning. Separate from mine-known-ore.
 *
 * Guides where a citizen may look (elevation band, cave vs cliff, biome).
 * Never returns hidden-block coordinates from server files, RCON, or a test harness.
 */
import {
  biomeSupportsOre,
  getOreProfile,
  isYInPreferredSearchBand,
  resolveOreResource,
  type OreProfile,
  type OreSearchApproach,
} from "@civ/minecraft-knowledge";
import type { Vec3 } from "@civ/shared";

export type OreSearchPlan = {
  resource: NonNullable<ReturnType<typeof resolveOreResource>>;
  profile: OreProfile;
  suggestedMinY: number;
  suggestedMaxY: number;
  preferredY: number;
  approach: OreSearchApproach;
  biomeOk: boolean;
  hazards: string[];
  notes: string[];
};

export type TunnelProposal = {
  direction: { x: number; z: number };
  length: number;
  height: 2;
  ok: boolean;
  reason?: string;
};

export const TUNNEL_LENGTH_CAP = 8;

export function planOreSearch(resource: string, origin: Vec3, biome?: string): OreSearchPlan | undefined {
  const id = resolveOreResource(resource);
  const profile = id ? getOreProfile(id) : undefined;
  if (!id || !profile) return undefined;
  const approach = profile.approaches[0] ?? "cave_explore";
  const preferredY = Math.max(
    profile.preferredSearchMinY,
    Math.min(profile.preferredSearchMaxY, Math.round((profile.preferredSearchMinY + profile.preferredSearchMaxY) / 2)),
  );
  const biomeOk = biomeSupportsOre(id, biome);
  const notes = [...profile.searchNotes];
  if (!biomeOk) notes.unshift(`${profile.displayName} is not expected in ${biome}.`);
  if (!isYInPreferredSearchBand(id, origin.y)) {
    notes.push(`Current Y=${Math.floor(origin.y)} is outside the preferred search band ${profile.preferredSearchMinY}–${profile.preferredSearchMaxY}.`);
  }
  notes.push("Search bands are not deposits. Stop when the action/time budget is exhausted.");
  return {
    resource: id,
    profile,
    suggestedMinY: profile.preferredSearchMinY,
    suggestedMaxY: profile.preferredSearchMaxY,
    preferredY,
    approach,
    biomeOk,
    hazards: profile.hazards,
    notes,
  };
}

export function searchWaypointAtBand(origin: Vec3, plan: OreSearchPlan, heading: { x: number; z: number }, step = 8): Vec3 {
  const mag = Math.hypot(heading.x, heading.z) || 1;
  return {
    x: Math.floor(origin.x + (heading.x / mag) * step),
    y: plan.preferredY,
    z: Math.floor(origin.z + (heading.z / mag) * step),
  };
}

export function proposeBoundedTunnel(
  from: Vec3,
  heading: { x: number; z: number },
  length = 4,
): TunnelProposal {
  const dx = Math.sign(heading.x);
  const dz = Math.sign(heading.z);
  if (dx !== 0 && dz !== 0) {
    return { direction: { x: dx, z: 0 }, length: 0, height: 2, ok: false, reason: "Diagonal tunnels are not approved" };
  }
  if (dx === 0 && dz === 0) {
    return { direction: { x: 0, z: 0 }, length: 0, height: 2, ok: false, reason: "Tunnel needs a cardinal heading" };
  }
  const capped = Math.min(TUNNEL_LENGTH_CAP, Math.max(1, Math.floor(length)));
  return { direction: { x: dx, z: dz }, length: capped, height: 2, ok: true };
}

export function refuseUncontrolledStripMine(maxActions: number, infinite: boolean): { ok: boolean; reason?: string } {
  if (infinite || maxActions > 48) {
    return { ok: false, reason: "Uncontrolled strip mining is not an approved search" };
  }
  return { ok: true };
}
