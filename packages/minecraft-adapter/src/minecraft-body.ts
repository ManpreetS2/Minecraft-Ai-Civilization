import { EventEmitter } from "node:events";
import mineflayer, { type Bot, type BotOptions } from "mineflayer";
import {
  createEvent,
  distance,
  fail,
  ok,
  type ActionResult,
  type AppConfig,
  type BodyObservation,
  type EventBus,
  type InventoryItem,
  type NearbyEntity,
  type PlayerInfo,
  type Vec3,
  HOSTILE_MOB_NAMES,
  resolveFromRoot,
} from "@civ/shared";
import { BodyLock, DuplicateBodyError } from "./body-lock.js";
import { TargetBlacklist } from "./path-recovery.js";

const activeBodies = new Map<string, MinecraftBody>();

export type BodyEvents = {
  spawned: [];
  connected: [];
  disconnected: [reason: string];
  kicked: [reason: string];
  error: [error: Error];
  health: [];
  death: [];
  chat: [username: string, message: string];
};

export type MinecraftBodyOptions = {
  username: string;
  config: AppConfig;
  events?: EventBus;
  citizenId?: string;
  lockDir?: string;
  reconnect?: boolean;
  allowRespawn?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

export class MinecraftBody extends EventEmitter {
  readonly username: string;
  readonly citizenId?: string;
  private readonly config: AppConfig;
  private readonly events?: EventBus;
  private readonly lock: BodyLock;
  private shouldReconnect: boolean;
  private readonly allowRespawn: boolean;
  readonly unreachable = new TargetBlacklist();
  private deceased = false;
  private bot: Bot | null = null;
  private shuttingDown = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private spawned = false;
  private lastKick?: string;
  private connectingPromise: Promise<ActionResult<{ username: string }>> | null = null;

  constructor(options: MinecraftBodyOptions) {
    super();
    this.username = options.username;
    this.citizenId = options.citizenId;
    this.config = options.config;
    this.events = options.events;
    this.shouldReconnect = options.reconnect ?? true;
    this.allowRespawn = options.allowRespawn ?? false;
    this.lock = new BodyLock(options.username, options.lockDir ?? resolveFromRoot("./data/locks"));
  }

  isDeceased(): boolean {
    return this.deceased;
  }

  markDeceased(): void {
    this.deceased = true;
    this.shouldReconnect = false;
    this.shuttingDown = true;
    this.spawned = false;
  }

  get connected(): boolean {
    return Boolean(this.bot?.entity);
  }

  getBot(): Bot | null {
    return this.bot;
  }

  requireBot(): Bot {
    if (!this.bot?.entity) {
      throw new Error(`Body ${this.username} is not spawned`);
    }
    return this.bot;
  }

  static getActive(username: string): MinecraftBody | undefined {
    return activeBodies.get(username.toLowerCase());
  }

  async connect(): Promise<ActionResult<{ username: string }>> {
    if (this.connectingPromise) {
      return this.connectingPromise;
    }
    this.connectingPromise = this.connectInternal();
    try {
      return await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  private async connectInternal(): Promise<ActionResult<{ username: string }>> {
    const started = Date.now();
    if (this.deceased) {
      return fail("DEAD", `${this.username} is deceased and cannot reconnect`, Date.now() - started);
    }
    if (this.shuttingDown) {
      return fail("CANCELLED", "Body is shutting down", Date.now() - started);
    }
    const existing = activeBodies.get(this.username.toLowerCase());
    if (existing && existing !== this && existing.connected) {
      return fail("DUPLICATE_BODY", `Body ${this.username} already connected in this process`, Date.now() - started);
    }
    try {
      this.lock.acquire();
    } catch (error) {
      if (error instanceof DuplicateBodyError) {
        return fail("DUPLICATE_BODY", error.message, Date.now() - started);
      }
      throw error;
    }
    if (this.bot) {
      this.teardownBot("reconnect");
    }
    activeBodies.set(this.username.toLowerCase(), this);
    this.spawned = false;

    const options: BotOptions = {
      host: this.config.MINECRAFT_HOST,
      port: this.config.MINECRAFT_PORT,
      username: this.username,
      auth: this.config.MINECRAFT_AUTH_MODE === "offline" ? "offline" : "microsoft",
      version: this.config.MINECRAFT_VERSION,
      hideErrors: false,
      checkTimeoutInterval: 30_000,
    };

    return await new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.teardownBot("timeout");
        resolve(fail("TIMEOUT", `Connect timed out for ${this.username}`, Date.now() - started, true));
      }, 45_000);

      const bot = mineflayer.createBot(options);
      this.bot = bot;
      this.bindBot(bot);

      const finish = (result: ActionResult<{ username: string }>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      bot.once("spawn", () => {
        this.spawned = true;
        this.reconnectAttempt = 0;
        this.emit("spawned");
        this.events?.emit(
          createEvent(
            "CitizenSpawned",
            { username: this.username, position: this.position() },
            this.citizenId,
          ),
        );
        finish(ok({ username: this.username }, Date.now() - started));
      });

      bot.once("kicked", (reason) => {
        this.lastKick = stringifyKick(reason);
        finish(fail("KICKED", this.lastKick, Date.now() - started, true));
      });

      bot.once("error", (error) => {
        finish(fail("UNKNOWN", error.message, Date.now() - started, true));
      });

      bot.once("end", (reason) => {
        if (!this.spawned) {
          finish(fail("NOT_CONNECTED", `Disconnected before spawn: ${reason}`, Date.now() - started, true));
        }
      });
    });
  }

  async disconnect(reason = "shutdown"): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.teardownBot(reason);
    this.lock.release();
    activeBodies.delete(this.username.toLowerCase());
  }

  stopPathfinding(): void {
    const bot = this.bot;
    if (!bot) return;
    const pathfinder = asRecord((bot as unknown as { pathfinder?: unknown }).pathfinder);
    const stop = pathfinder?.["stop"];
    if (typeof stop === "function") {
      stop.call((bot as unknown as { pathfinder: unknown }).pathfinder);
    }
    const setGoal = pathfinder?.["setGoal"];
    if (typeof setGoal === "function") {
      setGoal.call((bot as unknown as { pathfinder: unknown }).pathfinder, null);
    }
  }

  observe(): BodyObservation {
    const bot = this.bot;
    const entity = bot?.entity;
    return {
      username: this.username,
      connected: Boolean(entity),
      spawned: this.spawned && Boolean(entity),
      dimension: bot?.game?.dimension,
      position: this.position(),
      health: bot?.health,
      food: bot?.food,
      saturation: bot?.foodSaturation,
      oxygen: bot?.oxygenLevel,
      gameTime: bot?.time?.timeOfDay,
      isNight: isNight(bot?.time?.timeOfDay),
      raining: bot?.isRaining,
      inventory: this.inventory(),
      players: this.nearbyPlayers(),
      nearby: this.nearbyEntities(),
      heldItem: bot?.heldItem?.name,
    };
  }

  position(): Vec3 | undefined {
    const pos = this.bot?.entity?.position;
    if (!pos) return undefined;
    return { x: pos.x, y: pos.y, z: pos.z };
  }

  inventory(): InventoryItem[] {
    const items = this.bot?.inventory?.items() ?? [];
    const stacked = new Map<string, number>();
    for (const item of items) {
      stacked.set(item.name, (stacked.get(item.name) ?? 0) + item.count);
    }
    return [...stacked.entries()].map(([name, count]) => ({ name, count }));
  }

  nearbyPlayers(maxDistance = 64): PlayerInfo[] {
    const bot = this.bot;
    const origin = bot?.entity?.position;
    if (!bot || !origin) return [];
    const result: PlayerInfo[] = [];
    for (const [username, player] of Object.entries(bot.players)) {
      if (username === bot.username) continue;
      const pos = player.entity?.position;
      const info: PlayerInfo = {
        username,
        uuid: player.uuid,
      };
      if (pos) {
        info.position = { x: pos.x, y: pos.y, z: pos.z };
        info.distance = distance(
          { x: origin.x, y: origin.y, z: origin.z },
          { x: pos.x, y: pos.y, z: pos.z },
        );
      }
      if (!info.distance || info.distance <= maxDistance) {
        result.push(info);
      }
    }
    return result.sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));
  }

  nearbyEntities(maxDistance = 24): NearbyEntity[] {
    const bot = this.bot;
    const origin = bot?.entity?.position;
    if (!bot || !origin) return [];
    const result: NearbyEntity[] = [];
    for (const entity of Object.values(bot.entities)) {
      if (!entity?.position || entity === bot.entity) continue;
      const pos = { x: entity.position.x, y: entity.position.y, z: entity.position.z };
      const dist = distance({ x: origin.x, y: origin.y, z: origin.z }, pos);
      if (dist > maxDistance) continue;
      const name = entity.name ?? entity.displayName?.toString() ?? entity.type ?? "unknown";
      const key = name.toLowerCase().replace(/\s+/g, "_");
      result.push({
        id: entity.id,
        name,
        type: entity.type ?? "unknown",
        hostile: HOSTILE_MOB_NAMES.has(key),
        position: pos,
        distance: dist,
      });
    }
    return result.sort((a, b) => a.distance - b.distance);
  }

  async chat(message: string): Promise<ActionResult<{ message: string }>> {
    const started = Date.now();
    try {
      const bot = this.requireBot();
      bot.chat(message.slice(0, 256));
      return ok({ message }, Date.now() - started);
    } catch (error) {
      return fail("NOT_CONNECTED", error instanceof Error ? error.message : String(error), Date.now() - started);
    }
  }

  lastKickReason(): string | undefined {
    return this.lastKick;
  }

  private bindBot(bot: Bot): void {
    bot.on("login", () => {
      this.emit("connected");
      this.events?.emit(createEvent("CitizenConnected", { username: this.username }, this.citizenId));
    });

    bot.on("health", () => {
      this.emit("health");
    });

    bot.on("death", () => {
      if (this.deceased) return;
      if (!this.allowRespawn) {
        this.markDeceased();
        this.events?.emit(
          createEvent("CitizenDied", { username: this.username, position: this.position() }, this.citizenId),
        );
        this.emit("death");
        void this.disconnect("citizen-deceased");
        return;
      }
      this.emit("death");
      this.events?.emit(
        createEvent("CitizenDied", { username: this.username, position: this.position() }, this.citizenId),
      );
      try {
        bot.respawn();
      } catch {
        // respawn packet may fail if already respawning
      }
    });

    bot.on("spawn", () => {
      if (this.deceased) return;
      this.spawned = true;
    });

    bot.on("chat", (username, message) => {
      if (username === bot.username) return;
      this.emit("chat", username, message);
    });

    bot.on("kicked", (reason) => {
      this.lastKick = stringifyKick(reason);
      this.emit("kicked", this.lastKick);
      this.events?.emit(
        createEvent("CitizenKicked", { username: this.username, reason: this.lastKick }, this.citizenId),
      );
    });

    bot.on("error", (error) => {
      this.emit("error", error);
      this.events?.emit(
        createEvent("ErrorOccurred", { username: this.username, error: error.message }, this.citizenId),
      );
    });

    bot.on("end", (reason) => {
      this.spawned = false;
      this.emit("disconnected", String(reason));
      this.events?.emit(
        createEvent("CitizenDisconnected", { username: this.username, reason: String(reason) }, this.citizenId),
      );
      if (!this.shuttingDown && this.shouldReconnect && !this.deceased) {
        this.scheduleReconnect();
      }
    });
  }

  reconnectAttempts(): number {
    return this.reconnectAttempt;
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown || this.deceased || !this.shouldReconnect || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(60_000, 3000 * 2 ** Math.min(this.reconnectAttempt - 1, 4));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private teardownBot(reason: string): void {
    const bot = this.bot;
    this.bot = null;
    this.spawned = false;
    if (!bot) return;
    try {
      this.stopPathfinding();
    } catch {
      // plugin may already be gone
    }
    bot.removeAllListeners();
    const client = (
      bot as unknown as { _client?: { removeAllListeners?: () => void; end?: (r?: string) => void } }
    )._client;
    try {
      bot.quit(reason);
    } catch {
      try {
        bot.end(reason);
      } catch {
        // already closed
      }
    }
    try {
      client?.removeAllListeners?.();
      client?.end?.(reason);
    } catch {
      // ignore
    }
  }
}

function isNight(timeOfDay: number | undefined): boolean | undefined {
  if (timeOfDay === undefined) return undefined;
  return timeOfDay > 13_000 && timeOfDay < 23_000;
}

function stringifyKick(reason: unknown): string {
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

export { DuplicateBodyError };
