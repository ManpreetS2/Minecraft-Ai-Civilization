import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { attackHostile } from "./combat.js";
import type { SkillContext } from "./context.js";

function vec(x: number, y: number, z: number): Vec3 {
  return new Vec3(x, y, z);
}

function combatCtx(over: {
  entities?: Record<number, { id: number; name: string; position: Vec3; health?: number; isValid?: boolean }>;
  attack?: (entity: { id: number }) => void;
  onTrack?: () => void;
}): { ctx: SkillContext; attacks: number[]; tracked: string[] } {
  const attacks: number[] = [];
  const tracked: string[] = [];
  const origin = vec(0.5, 64, 0.5);
  const entities = over.entities ?? {};
  const bot = {
    health: 20,
    heldItem: { name: "wooden_sword" },
    entity: { position: origin },
    entities,
    inventory: { items: () => [] },
    lookAt: async () => undefined,
    attack(entity: { id: number }) {
      attacks.push(entity.id);
      over.attack?.(entity);
    },
  };
  const ctx = {
    bot: bot as unknown as Bot,
    timeoutMs: 50,
    body: {
      trackEntity: () => {
        tracked.push("track");
        over.onTrack?.();
      },
      clearTrackedEntity: () => {
        tracked.push("clear");
      },
    },
  } as unknown as SkillContext;
  return { ctx, attacks, tracked };
}

describe("combat live-entity narrowing", () => {
  it("attacks the live hostile entity and reports death without calling it out of range", async () => {
    const zombie = { id: 7, name: "zombie", position: vec(1.2, 64, 0.8), health: 8, isValid: true };
    const { ctx, attacks } = combatCtx({
      entities: { 7: zombie },
      attack() {
        zombie.health = 0;
        zombie.isValid = false;
      },
    });
    const result = await attackHostile(ctx, ["zombie"], { collect: false, timeoutMs: 50 });
    expect(attacks).toEqual([7]);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("killed zombie should succeed");
    expect(result.data.killed).toBe(true);
    expect(result.data.target).toBe("zombie");
  });

  it("fails ENTITY_REMOVED when the tracked hostile vanishes from the entity map", async () => {
    const zombie = { id: 7, name: "zombie", position: vec(1.2, 64, 0.8), health: 8, isValid: true };
    const entities: Record<number, typeof zombie> = { 7: zombie };
    const { ctx, attacks } = combatCtx({
      entities,
      onTrack() {
        delete entities[7];
      },
    });
    const result = await attackHostile(ctx, ["zombie"], { collect: false, timeoutMs: 50 });
    expect(attacks).toEqual([]);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("missing hostile should fail");
    expect(result.code).toBe("ENTITY_REMOVED");
    expect(result.error).toContain("not out of range");
  });
});
