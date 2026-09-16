import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import type { Vec3 } from "@civ/shared";
import { nearbyOffsets } from "./path-recovery.js";
import { occupantNear } from "./occupancy.js";

function botBlock(bot: Bot, x: number, y: number, z: number): string | undefined {
  return bot.blockAt(new Vec3Class(Math.floor(x), Math.floor(y), Math.floor(z)))?.name;
}

export function isWalkableStanding(bot: Bot, pos: Vec3): boolean {
  const feet = botBlock(bot, pos.x, pos.y, pos.z);
  const head = botBlock(bot, pos.x, pos.y + 1, pos.z);
  const below = botBlock(bot, pos.x, pos.y - 1, pos.z);
  const open = !feet || feet === "air" || feet === "cave_air" || feet === "short_grass" || feet === "grass";
  const headOpen = !head || head === "air" || head === "cave_air";
  const solid = Boolean(below && below !== "air" && below !== "cave_air" && below !== "water" && below !== "lava");
  return open && headOpen && solid;
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
