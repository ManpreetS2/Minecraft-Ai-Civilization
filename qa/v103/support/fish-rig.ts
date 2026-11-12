// Controlled fishing client for the QA78 suites. The production fish cycle (runMineflayerFishCycle) and the production
// boundary/guard run unmodified; only the Mineflayer bot and its protocol client are doubles. Nothing here is a real Paper
// server or a real fishing bobber.
import { EventEmitter } from "node:events";
import type { FishableBot } from "../../../packages/skills/src/mineflayer-fish-cycle.js";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Wire { name: string; at: number; data?: Record<string, unknown> }

export function fishBot(opts: { writeThrows?: (name: string) => Error | undefined } = {}) {
  const reached: Wire[] = [];
  const client = Object.assign(new EventEmitter(), {
    write(name: string, data?: Record<string, unknown>) {
      const err = opts.writeThrows?.(name);
      if (err) throw err;
      reached.push({ name, at: Date.now(), data });
    },
  });
  const entities: FishableBot["entities"] = {};
  const bot: FishableBot & { _client: EventEmitter & { write(n: string, d?: Record<string, unknown>): void }; activations: number } = {
    username: "Atlas",
    entity: { id: 1, position: { x: 0, y: 64, z: 0 } },
    entities,
    activations: 0,
    // mineflayer's activateItem sends use_item through bot._client
    activateItem() { bot.activations += 1; bot._client.write("use_item"); },
    registry: { entitiesByName: { fishing_bobber: { id: 90, metadataKeys: ["biting"] } } },
    _client: client,
  } as never;
  const spawnBobber = (id = 500) => {
    entities[id] = { id, name: "fishing_bobber", position: { x: 1, y: 64, z: 1 }, ownerEntityId: 1 };
    client.emit("spawn_entity", { type: 90, entityId: id, objectData: 1, x: 1, y: 64, z: 1 });
  };
  const bite = (id = 500) => client.emit("entity_metadata", { entityId: id, metadata: [{ key: 0, value: true }] });
  const splash = () => client.emit("world_particles", { particleId: 4, x: 1, y: 64, z: 1, amount: 8 });
  const useItems = () => reached.filter((w) => w.name === "use_item").length;
  return { bot, client, reached, spawnBobber, bite, splash, useItems };
}

export const CANCELLED = { success: false, code: "CANCELLED", error: "cancelled", retryable: false, durationMs: 1 } as never;
