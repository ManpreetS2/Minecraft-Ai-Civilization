import type { Bot } from "mineflayer";
import type { MinecraftBody } from "@civ/minecraft-adapter";
import type { EventBus } from "@civ/shared";
import type { ItemReservationBook } from "./inventory-reservations.js";

export type SkillContext = {
  body: MinecraftBody;
  bot: Bot;
  signal?: AbortSignal;
  /** Executor generation ownership; observations may outlive this permission. */
  isActionCurrent?: () => boolean;
  events?: EventBus;
  /** Authorized caller context for physical chest observations; never inferred from a model. */
  storageAccess?: "personal" | "household" | "communal";
  citizenId?: string;
  /** Trusted runtime correlation, never copied from a model plan. */
  runId?: string;
  actionId?: string;
  timeoutMs?: number;
  skipBlock?: (position: { x: number; y: number; z: number }) => boolean;
  reservations?: ItemReservationBook;
};

export function contextBot(ctx: SkillContext): Bot {
  return ctx.bot;
}
