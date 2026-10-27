import type { Vec3 } from "@civ/shared";

function floorCell(pos: Vec3): Vec3 {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
}

export function sameStorageCell(a: Vec3, b: Vec3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

/**
 * WORLD-LAB TEST_CONTROL chests. Knowing these coordinates is not citizen permission.
 * Never treat them as settlement.storage or ordinary knownChest results.
 */
export const TEST_FIXTURE_CHESTS: readonly Vec3[] = [
  { x: -1042, y: 63, z: 980 }, // Kai / FishProbe pond chest
  { x: -1042, y: 63, z: 982 }, // Atlas pond chest
  { x: -954, y: 58, z: 944 }, // MineProbe coal chest
];

/** RED-audited village tannery. Intended WORLD-LAB communal storage when explicitly set. */
export const WORLD_LAB_COMMUNAL_CHEST: Vec3 = { x: -1038, y: 65, z: 839 };

export function isTestFixtureChest(pos: Vec3 | undefined): boolean {
  if (!pos) return false;
  const cell = floorCell(pos);
  return TEST_FIXTURE_CHESTS.some((fixture) => sameStorageCell(fixture, cell));
}

export function isDesignatedCommunalChest(pos: Vec3 | undefined): boolean {
  if (!pos) return false;
  return sameStorageCell(pos, WORLD_LAB_COMMUNAL_CHEST);
}
