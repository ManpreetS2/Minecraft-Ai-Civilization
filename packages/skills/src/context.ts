import type { Bot } from "mineflayer";
import type { MinecraftBody } from "@civ/minecraft-adapter";
import type { ActionTracer, EventBus } from "@civ/shared";
import type { PropertyRegistry } from "./property.js";

export type SkillContext = {
  body: MinecraftBody;
  bot: Bot;
  signal?: AbortSignal;
  events?: EventBus;
  citizenId?: string;
  timeoutMs?: number;
  /** Optional property registry — when present, dig/deposit respect ownership. */
  propertyRegistry?: PropertyRegistry;
  /** Optional action tracer for DECISION→…→MEMORY spans. */
  tracer?: ActionTracer;
};

export function contextBot(ctx: SkillContext): Bot {
  return ctx.bot;
}
