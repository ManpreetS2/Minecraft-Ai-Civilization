import { fail, ok, type ActionResult, type NearbyEntity, type Vec3 } from "@civ/shared";
import type { SkillContext } from "./context.js";

export async function observeNearby(
  ctx: SkillContext,
  maxDistance = 24,
): Promise<ActionResult<{ entities: NearbyEntity[]; players: string[] }>> {
  const started = Date.now();
  try {
    const entities = ctx.body.nearbyEntities(maxDistance);
    const players = ctx.body.nearbyPlayers(64).map((p) => p.username);
    return ok({ entities, players }, Date.now() - started);
  } catch (error) {
    return fail("NOT_CONNECTED", error instanceof Error ? error.message : String(error), Date.now() - started);
  }
}

export async function findBlock(
  ctx: SkillContext,
  names: string[],
  maxDistance = 32,
): Promise<ActionResult<{ name: string; position: Vec3 }>> {
  const started = Date.now();
  const bot = ctx.bot;
  const ids = names
    .map((name) => bot.registry.blocksByName[name]?.id)
    .filter((id): id is number => typeof id === "number");
  if (ids.length === 0) {
    return fail("BLOCK_NOT_FOUND", `Unknown block names: ${names.join(", ")}`, Date.now() - started);
  }
  const block = bot.findBlock({
    matching: ids,
    maxDistance,
    count: 1,
  });
  if (!block) {
    return fail("BLOCK_NOT_FOUND", `No ${names.join("/")} within ${maxDistance} blocks`, Date.now() - started, true);
  }
  return ok(
    { name: block.name, position: { x: block.position.x, y: block.position.y, z: block.position.z } },
    Date.now() - started,
  );
}
