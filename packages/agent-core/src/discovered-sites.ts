import type { Vec3 } from "@civ/shared";
import { FISHING_RADIUS_CAP, findShoreCasts, type ShoreCast, type WorldGetter } from "@civ/skills";
import type { CivilizationStore } from "./store.js";

export type DiscoveredSiteKind = "shore" | "ore" | "farm";

export type DiscoveredSite = {
  kind: DiscoveredSiteKind;
  origin: Vec3;
  stand?: Vec3;
  citizenId: string;
  seenAt: string;
};

export const DISCOVERED_SITES_META_KEY = "discovered_resource_sites";
/** Optional work farther than this is not treated as reachable this tick. */
export const SITE_REACH_BLOCKS = 96;

const META_KEY = DISCOVERED_SITES_META_KEY;

function floor(pos: Vec3): Vec3 {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
}

function sameCell(a: Vec3, b: Vec3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

export function siteDistance(from: Vec3, site: Vec3): number {
  return Math.hypot(from.x - site.x, from.y - site.y, from.z - site.z);
}

export function siteIsReachable(from: Vec3 | undefined, site: Vec3, maxBlocks = SITE_REACH_BLOCKS): boolean {
  if (!from) return false;
  return siteDistance(from, site) <= maxBlocks;
}

export function parseDiscoveredSites(raw: string | undefined): DiscoveredSite[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is DiscoveredSite => {
      if (!entry || typeof entry !== "object") return false;
      const site = entry as DiscoveredSite;
      return (
        (site.kind === "shore" || site.kind === "ore" || site.kind === "farm") &&
        typeof site.citizenId === "string" && site.citizenId.length > 0 &&
        typeof site.seenAt === "string" && Number.isFinite(Date.parse(site.seenAt)) &&
        site.origin && [site.origin.x, site.origin.y, site.origin.z].every(Number.isFinite) &&
        (!site.stand || [site.stand.x, site.stand.y, site.stand.z].every(Number.isFinite))
      );
    });
  } catch {
    return [];
  }
}

export function listDiscoveredSites(store: CivilizationStore): DiscoveredSite[] {
  return parseDiscoveredSites(store.getMeta(META_KEY));
}

export function rememberDiscoveredSite(store: CivilizationStore, site: DiscoveredSite): DiscoveredSite[] {
  if (parseDiscoveredSites(JSON.stringify([site])).length !== 1) throw new Error("invalid discovered site");
  const origin = floor(site.origin);
  const current = listDiscoveredSites(store);
  const next = current.filter((entry) => !(entry.citizenId === site.citizenId && entry.kind === site.kind && sameCell(entry.origin, origin)));
  next.push({ ...site, origin, stand: site.stand ? floor(site.stand) : undefined });
  store.setMeta(META_KEY, JSON.stringify(next));
  return next;
}

export function visibleShoresFromWorld(origin: Vec3, getBlock: WorldGetter, radius = FISHING_RADIUS_CAP): ShoreCast[] {
  return findShoreCasts(origin, Math.min(FISHING_RADIUS_CAP, Math.max(1, radius)), getBlock);
}

export function nearestReachableSite(
  from: Vec3 | undefined,
  sites: readonly DiscoveredSite[],
  kind: DiscoveredSiteKind,
): DiscoveredSite | undefined {
  const matches = sites.filter((site) => site.kind === kind && siteIsReachable(from, site.stand ?? site.origin));
  if (!from || matches.length === 0) return undefined;
  return [...matches].sort((a, b) => siteDistance(from, a.stand ?? a.origin) - siteDistance(from, b.stand ?? b.origin))[0];
}
