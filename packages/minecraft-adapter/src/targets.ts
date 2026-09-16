import type { Bot } from "mineflayer";
import type { Vec3 } from "@civ/shared";
import { findReachableInteractionPosition } from "./interaction.js";
import { probeReachability, scoreResourceTarget } from "./path-probe.js";
import { occupantNear } from "./occupancy.js";

export type ResourceCandidate = {
  name: string;
  position: Vec3;
  score: number;
  cost: number;
  interaction?: Vec3;
};

export function rankResourceTargets(
  bot: Bot,
  blocks: Array<{ name: string; position: Vec3 }>,
  options: {
    claimed?: (pos: Vec3) => boolean;
    blacklisted?: (pos: Vec3) => boolean;
    hazardsNear?: (pos: Vec3) => number;
  } = {},
): ResourceCandidate[] {
  const ranked: ResourceCandidate[] = [];
  for (const block of blocks) {
    if (options.blacklisted?.(block.position)) continue;
    const interaction = findReachableInteractionPosition(bot, block.position);
    const probe = probeReachability(bot, interaction ?? block.position);
    const origin = bot.entity?.position;
    const distance = origin
      ? Math.hypot(block.position.x - origin.x, block.position.y - origin.y, block.position.z - origin.z)
      : 99;
    const congested = occupantNear(interaction ?? block.position, bot.username, 1.1);
    const score = scoreResourceTarget({
      distance,
      probeCost: probe.cost + (congested ? 20 : 0),
      claimed: Boolean(options.claimed?.(block.position)),
      blacklisted: Boolean(options.blacklisted?.(block.position)),
      hazards: options.hazardsNear?.(block.position) ?? 0,
      interactionOk: Boolean(interaction) && probe.reachable,
    });
    ranked.push({ ...block, score, cost: probe.cost, interaction });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

export function pickBestResourceTarget(
  bot: Bot,
  blocks: Array<{ name: string; position: Vec3 }>,
  options?: Parameters<typeof rankResourceTargets>[2],
): ResourceCandidate | undefined {
  return rankResourceTargets(bot, blocks, options)[0];
}
