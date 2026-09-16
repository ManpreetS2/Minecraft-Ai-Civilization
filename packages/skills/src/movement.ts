import { followPlayer, moveToPosition, startFollowing } from "@civ/minecraft-adapter";
import { fail, ok, type ActionResult, type Vec3 } from "@civ/shared";
import type { SkillContext } from "./context.js";

export async function moveTo(
  ctx: SkillContext,
  target: Vec3,
  range = 1.5,
): Promise<ActionResult<{ position: Vec3; distance: number }>> {
  return moveToPosition(ctx.bot, target, {
    range,
    timeoutMs: ctx.timeoutMs ?? 22_000,
    signal: ctx.signal,
  });
}

export async function followEntity(
  ctx: SkillContext,
  username: string,
): Promise<ActionResult<{ username: string; position: Vec3 }>> {
  return followPlayer(ctx.bot, username, {
    timeoutMs: ctx.timeoutMs ?? 45_000,
    signal: ctx.signal,
  });
}

export function followEntityLive(
  ctx: SkillContext,
  username: string,
): ActionResult<{ username: string }> {
  return startFollowing(ctx.bot, username);
}

export async function flee(
  ctx: SkillContext,
  from: Vec3,
  distanceBlocks = 16,
): Promise<ActionResult<{ position: Vec3 }>> {
  const pos = ctx.bot.entity?.position;
  if (!pos) {
    return fail("NOT_CONNECTED", "Cannot flee without a body", 0);
  }
  const dx = pos.x - from.x;
  const dz = pos.z - from.z;
  const mag = Math.hypot(dx, dz) || 1;
  const target = {
    x: pos.x + (dx / mag) * distanceBlocks,
    y: pos.y,
    z: pos.z + (dz / mag) * distanceBlocks,
  };
  const result = await moveTo(ctx, target, 2);
  if (!result.success) {
    return fail(result.code, result.error, result.durationMs, result.retryable);
  }
  return ok({ position: result.data.position }, result.durationMs);
}

export async function wander(
  ctx: SkillContext,
  distanceBlocks = 24,
): Promise<ActionResult<{ position: Vec3 }>> {
  const pos = ctx.bot.entity?.position;
  if (!pos) {
    return fail("NOT_CONNECTED", "Cannot wander without a body", 0);
  }
  const angle = Math.random() * Math.PI * 2;
  const target = {
    x: pos.x + Math.cos(angle) * distanceBlocks,
    y: pos.y,
    z: pos.z + Math.sin(angle) * distanceBlocks,
  };
  const result = await moveTo(ctx, target, 3);
  if (!result.success) {
    return fail(result.code, result.error, result.durationMs, result.retryable);
  }
  return ok({ position: result.data.position }, result.durationMs);
}
