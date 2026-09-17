import type { Bot } from "mineflayer";
import type { Vec3 } from "@civ/shared";
import { configureMovements } from "./pathing.js";
import { findReachableInteractionPosition } from "./interaction.js";

export function probeReachability(
  bot: Bot,
  target: Vec3,
): { reachable: boolean; cost: number; reason?: string } {
  const origin = bot.entity?.position;
  if (!origin) return { reachable: false, cost: Number.POSITIVE_INFINITY, reason: "not spawned" };
  const standing = findReachableInteractionPosition(bot, target) ?? target;
  const dx = standing.x - origin.x;
  const dy = standing.y - origin.y;
  const dz = standing.z - origin.z;
  const euclid = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (Math.abs(dy) > 10) {
    return { reachable: false, cost: euclid + 80, reason: "vertical gap" };
  }

  try {
    const api = configureMovements(bot);
    if (typeof api.getPathTo !== "function") {
      return { reachable: true, cost: euclid };
    }
    const goal = {
      x: Math.floor(standing.x),
      y: Math.floor(standing.y),
      z: Math.floor(standing.z),
    };
    const path = api.getPathTo(undefined as never, goal, 40);
    const status = path?.status ?? "success";
    if (status === "noPath" || status === "timeout") {
      return { reachable: false, cost: euclid + 60, reason: status };
    }
    return { reachable: true, cost: typeof path?.cost === "number" ? path.cost : euclid };
  } catch {
    return { reachable: euclid < 48, cost: euclid + 20, reason: "path probe fallback" };
  }
}

export function scoreResourceTarget(input: {
  distance: number;
  probeCost: number;
  claimed: boolean;
  blacklisted: boolean;
  hazards: number;
  interactionOk: boolean;
}): number {
  if (input.blacklisted) return -1000;
  if (!input.interactionOk) return -400;
  if (input.claimed) return -200;
  return 200 - input.probeCost * 1.4 - input.distance * 0.6 - input.hazards * 25;
}
