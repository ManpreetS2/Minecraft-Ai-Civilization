import type { Bot } from "mineflayer";
import type { MinecraftBody } from "@civ/minecraft-adapter";
import type { EventBus } from "@civ/shared";

export type SkillContext = {
  body: MinecraftBody;
  bot: Bot;
  signal?: AbortSignal;
  events?: EventBus;
  citizenId?: string;
  timeoutMs?: number;
};

export function contextBot(ctx: SkillContext): Bot {
  return ctx.bot;
}
