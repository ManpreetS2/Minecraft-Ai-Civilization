import { fail, ok, HOSTILE_MOB_NAMES, type ActionResult } from "@civ/shared";
import type { SkillContext } from "./context.js";
import { flee, moveTo } from "./movement.js";
import { pickupDroppedItem } from "./inventory-service.js";
import { equipItem } from "./inventory-service.js";

const WEAPONS = [
  "netherite_sword",
  "diamond_sword",
  "iron_sword",
  "stone_sword",
  "golden_sword",
  "wooden_sword",
  "netherite_axe",
  "diamond_axe",
  "iron_axe",
  "stone_axe",
  "wooden_axe",
];

const FORBIDDEN = new Set([
  "player",
  "villager",
  "wandering_trader",
  "iron_golem",
  "snow_golem",
  "wolf",
  "cat",
  "allay",
]);

const ANIMALS = new Set(["cow", "pig", "chicken", "sheep", "horse", "donkey", "llama", "goat", "rabbit"]);

export function entityKey(name: string | undefined): string {
  return (name ?? "").toLowerCase().replace(/^minecraft:/, "");
}

export function isAttackAllowed(name: string | undefined, kind: "hostile" | "animal"): boolean {
  const key = entityKey(name);
  if (!key) return false;
  if (FORBIDDEN.has(key)) return false;
  if (["atlas", "maya", "theo", "ava", "kai", "mechprobe", "mechprobeb"].includes(key)) return false;
  if (kind === "hostile") return HOSTILE_MOB_NAMES.has(key) && key !== "creeper";
  return ANIMALS.has(key);
}

async function equipWeapon(ctx: SkillContext): Promise<string | undefined> {
  const held = ctx.bot.heldItem?.name;
  if (held && WEAPONS.includes(held)) return held;
  for (const name of WEAPONS) {
    if (!ctx.bot.inventory.items().some((item) => item.name === name)) continue;
    const equipped = await equipItem(ctx, name);
    if (equipped.success) return name;
  }
  return held;
}

function findTarget(ctx: SkillContext, names: string[], maxDistance: number) {
  const origin = ctx.bot.entity?.position;
  if (!origin) return undefined;
  const wanted = new Set(names.map(entityKey));
  const matches = Object.values(ctx.bot.entities).filter((entity) => {
    if (!entity.position || entity === ctx.bot.entity) return false;
    const key = entityKey(entity.name);
    if (wanted.size > 0 && !wanted.has(key)) return false;
    return origin.distanceTo(entity.position) <= maxDistance;
  });
  matches.sort((a, b) => origin.distanceTo(a.position) - origin.distanceTo(b.position));
  return matches[0];
}

export async function attackHostile(
  ctx: SkillContext,
  names: string[] = ["zombie", "skeleton", "spider", "husk", "stray", "drowned"],
  options: { collect?: boolean; timeoutMs?: number } = {},
): Promise<
  ActionResult<{
    target: string;
    weapon?: string;
    hits: number;
    healthBefore: number;
    healthAfter: number;
    killed: boolean;
  }>
> {
  const started = Date.now();
  const allowed = names.filter((name) => isAttackAllowed(name, "hostile"));
  if (allowed.length === 0) {
    return fail("INVALID_ARGUMENT", "No permitted hostile types", Date.now() - started, false);
  }
  const target = findTarget(ctx, allowed, 24);
  if (!target?.position) {
    return fail("ENTITY_NOT_FOUND", `No ${allowed.join("/")} nearby`, Date.now() - started, true);
  }
  if (entityKey(target.name) === "creeper") {
    return fail("INVALID_ARGUMENT", "Creeper is flee-only unless a later intent permits combat", Date.now() - started, false);
  }
  const healthBefore = ctx.bot.health ?? 20;
  const weapon = await equipWeapon(ctx);
  const meleeRange = entityKey(target.name) === "skeleton" ? 2.6 : 3.2;
  let hits = 0;
  const deadline = Date.now() + (options.timeoutMs ?? ctx.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    if (ctx.signal?.aborted) {
      return fail("CANCELLED", "attackHostile interrupted", Date.now() - started, true);
    }
    const live = ctx.bot.entities[target.id];
    if (!live || (typeof live.health === "number" && live.health <= 0)) break;
    const pos = live.position;
    if (!pos) break;
    const here = ctx.bot.entity?.position;
    const dist = here ? here.distanceTo(pos) : 99;
    if (dist > meleeRange) {
      const moved = await moveTo(ctx, { x: pos.x, y: pos.y, z: pos.z }, meleeRange);
      if (!moved.success && dist > 6) {
        return fail("TARGET_UNREACHABLE", moved.error, Date.now() - started, true);
      }
    }
    try {
      await ctx.bot.lookAt(pos.offset(0, 1, 0), true);
      ctx.bot.attack(live);
      hits += 1;
    } catch (error) {
      return fail("ATTACK_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const still = ctx.bot.entities[target.id];
  const killed =
    !still ||
    (still as { isValid?: boolean }).isValid === false ||
    (typeof still.health === "number" && still.health <= 0) ||
    !still.position;
  if (!killed) {
    return fail("ENTITY_ESCAPED", `${target.name ?? "hostile"} still present after combat`, Date.now() - started, true, {
      hits,
      weapon,
    });
  }
  if (options.collect !== false) {
    await pickupDroppedItem(ctx, undefined, 8);
  }
  return ok(
    {
      target: entityKey(target.name) || "hostile",
      weapon,
      hits,
      healthBefore,
      healthAfter: ctx.bot.health ?? healthBefore,
      killed: true,
    },
    Date.now() - started,
  );
}

export async function fleeCreeper(ctx: SkillContext): Promise<ActionResult<{ distanceBefore: number; distanceAfter: number }>> {
  const started = Date.now();
  const origin = ctx.bot.entity?.position;
  if (!origin) return fail("NOT_CONNECTED", "Not spawned", Date.now() - started);
  const creeper = findTarget(ctx, ["creeper"], 16);
  if (!creeper?.position) {
    return fail("ENTITY_NOT_FOUND", "No creeper nearby", Date.now() - started, true);
  }
  const before = origin.distanceTo(creeper.position);
  const fled = await flee(ctx, { x: creeper.position.x, y: creeper.position.y, z: creeper.position.z }, 14);
  let afterPos = ctx.bot.entity?.position ?? origin;
  let live = ctx.bot.entities[creeper.id];
  let after = live?.position ? afterPos.distanceTo(live.position) : afterPos.distanceTo(creeper.position);
  let moved = Math.hypot(afterPos.x - origin.x, afterPos.z - origin.z);
  if (!fled.success || moved < 2 || after <= before) {
    const dx = origin.x - creeper.position.x;
    const dz = origin.z - creeper.position.z;
    try {
      await ctx.bot.look(Math.atan2(-dx, dz), 0, true);
    } catch {
      // facing away is best-effort
    }
    ctx.bot.setControlState("forward", true);
    ctx.bot.setControlState("sprint", true);
    ctx.bot.setControlState("jump", true);
    await new Promise((resolve) => setTimeout(resolve, 1_400));
    ctx.bot.clearControlStates();
    afterPos = ctx.bot.entity?.position ?? origin;
    live = ctx.bot.entities[creeper.id];
    after = live?.position ? afterPos.distanceTo(live.position) : afterPos.distanceTo(creeper.position);
    moved = Math.hypot(afterPos.x - origin.x, afterPos.z - origin.z);
  }
  if (moved < 2 || after <= before) {
    return fail("FLEE_FAILED", `creeper distance ${before.toFixed(1)} -> ${after.toFixed(1)} moved=${moved.toFixed(1)}`, Date.now() - started, true);
  }
  return ok({ distanceBefore: before, distanceAfter: after }, Date.now() - started);
}

export async function huntAnimal(
  ctx: SkillContext,
  type: "cow" | "pig" | "chicken" | "sheep",
): Promise<ActionResult<{ target: string; collected: number; killed: boolean }>> {
  const started = Date.now();
  if (!isAttackAllowed(type, "animal")) {
    return fail("INVALID_ARGUMENT", `${type} is not a huntable animal`, Date.now() - started, false);
  }
  const target = findTarget(ctx, [type], 24);
  if (!target?.position) {
    return fail("ENTITY_NOT_FOUND", `No ${type} nearby`, Date.now() - started, true);
  }
  const beforeFood = ctx.bot.inventory.items().reduce((sum, item) => sum + item.count, 0);
  await equipWeapon(ctx);
  const deadline = Date.now() + (ctx.timeoutMs ?? 16_000);
  while (Date.now() < deadline) {
    const live = ctx.bot.entities[target.id];
    if (!live) break;
    const pos = live.position;
    if (!pos) break;
    const here = ctx.bot.entity?.position;
    if (here && here.distanceTo(pos) > 3) {
      await moveTo(ctx, { x: pos.x, y: pos.y, z: pos.z }, 2.4);
    }
    try {
      await ctx.bot.lookAt(pos.offset(0, 0.6, 0), true);
      ctx.bot.attack(live);
    } catch (error) {
      return fail("ATTACK_FAILED", error instanceof Error ? error.message : String(error), Date.now() - started, true);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const killed = !ctx.bot.entities[target.id];
  if (!killed) {
    return fail("ENTITY_ESCAPED", `${type} still present`, Date.now() - started, true);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  let picked = await pickupDroppedItem(ctx, undefined, 10);
  if (!picked.success) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    picked = await pickupDroppedItem(ctx, undefined, 12);
  }
  const afterFood = ctx.bot.inventory.items().reduce((sum, item) => sum + item.count, 0);
  return ok({ target: type, collected: Math.max(0, afterFood - beforeFood), killed: true }, Date.now() - started);
}
