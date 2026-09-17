import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import type { Vec3 } from "@civ/shared";
import { nearbyOffsets } from "./path-recovery.js";
import { occupantNear } from "./occupancy.js";

function botBlock(bot: Bot, x: number, y: number, z: number) {
  return bot.blockAt(new Vec3Class(Math.floor(x), Math.floor(y), Math.floor(z)));
}

function isAirLike(name: string | undefined, boundingBox?: string): boolean {
  if (!name || name === "air" || name === "cave_air" || name === "void_air") return true;
  if (boundingBox === "empty") return true;
  return (
    name === "short_grass" ||
    name === "grass" ||
    name === "tall_grass" ||
    name === "fern" ||
    name === "dead_bush" ||
    name.endsWith("_carpet") ||
    name === "snow"
  );
}

function isHazardName(name: string | undefined): boolean {
  return Boolean(
    name &&
      (name === "lava" ||
        name === "fire" ||
        name === "soul_fire" ||
        name === "magma_block" ||
        name === "cactus" ||
        name === "campfire" ||
        name === "soul_campfire"),
  );
}

export function canOccupyFeet(bot: Bot, pos: Vec3): boolean {
  const feet = botBlock(bot, pos.x, pos.y, pos.z);
  if (!feet) return true;
  if (isHazardName(feet.name)) return false;
  if (isAirLike(feet.name, feet.boundingBox)) return true;
  if (feet.name === "water" || feet.name.endsWith("_slab") || feet.name.includes("stairs")) return true;
  if (feet.name.endsWith("_door") || feet.name.endsWith("_gate") || feet.name.endsWith("_carpet")) return true;
  return feet.boundingBox !== "block";
}

export function hasHeadroom(bot: Bot, pos: Vec3): boolean {
  const head = botBlock(bot, pos.x, pos.y + 1, pos.z);
  if (!head) return true;
  if (isHazardName(head.name)) return false;
  return isAirLike(head.name, head.boundingBox) || head.boundingBox !== "block";
}

export function canStandOn(bot: Bot, pos: Vec3): boolean {
  const below = botBlock(bot, pos.x, pos.y - 1, pos.z);
  if (!below) return false;
  if (isHazardName(below.name) || below.name === "air" || below.name === "cave_air" || below.name === "water") return false;
  return below.boundingBox === "block" || below.name.endsWith("_slab") || below.name.includes("stairs");
}

export function isWalkableStanding(bot: Bot, pos: Vec3): boolean {
  return canOccupyFeet(bot, pos) && hasHeadroom(bot, pos) && canStandOn(bot, pos);
}

export function interactionCandidates(bot: Bot, block: Vec3, radius = 2): Vec3[] {
  const y = Math.floor(block.y);
  const spots: Vec3[] = [];
  for (const offset of nearbyOffsets(radius)) {
    const pos = { x: Math.floor(block.x) + offset.x, y, z: Math.floor(block.z) + offset.z };
    if (isWalkableStanding(bot, pos)) spots.push(pos);
  }
  return spots;
}

export function findReachableInteractionPosition(bot: Bot, block: Vec3, radius = 2): Vec3 | undefined {
  const origin = bot.entity?.position;
  const scored = interactionCandidates(bot, block, radius)
    .filter((pos) => !occupantNear(pos, bot.username, 0.8))
    .map((pos) => {
      const dx = origin ? pos.x - origin.x : 0;
      const dz = origin ? pos.z - origin.z : 0;
      return { pos, dist: dx * dx + dz * dz };
    })
    .sort((a, b) => a.dist - b.dist);
  return scored[0]?.pos;
}

export function findReachableMiningPosition(bot: Bot, block: Vec3): Vec3 | undefined {
  return findReachableInteractionPosition(bot, block, 2);
}

export function findReachablePlacementPosition(bot: Bot, position: Vec3): Vec3 | undefined {
  return findReachableInteractionPosition(bot, position, 3);
}
