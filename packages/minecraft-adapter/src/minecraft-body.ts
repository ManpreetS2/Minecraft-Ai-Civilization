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
  classifyEntityPresence,
  entityGoneMessage,
  isEntityPresent,
  resolveFromRoot,
  type EntityPresence,
} from "@civ/shared";
import { BodyLock, DuplicateBodyError } from "./body-lock.js";
import { patchMineflayerCrafting } from "./craft-patch.js";
import { TargetBlacklist } from "./path-recovery.js";
import { navigationBodyReady, deriveConnectionHealth, emptyTelemetry, keepalivePolicy, armShutdownClient, type ConnectionTelemetry } from "./connection-health.js";
import { installModernMovement } from "./movement-sync.js";
import { loadPathfinder } from "./pathing.js";
import { declaredRootCommands, sanitizeWhisperText, VALID_USERNAME, WHISPER_COMMAND } from "./server-commands.js";

type DeclaredCommandSource = { _client?: { on(event: string, listener: (packet: unknown) => void): void } };

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
  eventLoopLag?: () => number;
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
  private declaredCommands: ReadonlySet<string> | undefined;
  private shuttingDown = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private spawned = false;
  private lastKick?: string;
  private cancelConnection: (() => void) | undefined;
  private connecting = false;
  private connectingPromise: Promise<ActionResult<{ username: string }>> | null = null;
  private awaitingRespawn = false;
  private reconnecting = false;
  private telemetry: ConnectionTelemetry = emptyTelemetry();
  private readonly telemetryClients = new WeakSet<object>();
  private readonly telemetryBots = new WeakSet<Bot>();
  private readonly eventLoopLag?: () => number;
  private activeTarget: { id: number; name?: string; username?: string; kind: string } | null = null;
  perceptionEpoch = 0;
  lastEntityResult?: { code: EntityPresence | string; id?: number; name?: string };

  constructor(options: MinecraftBodyOptions) {
    super();
    this.username = options.username;
    this.citizenId = options.citizenId;
    this.config = options.config;
    this.events = options.events;
    this.shouldReconnect = options.reconnect ?? true;
    this.allowRespawn = options.allowRespawn ?? false;
    this.eventLoopLag = options.eventLoopLag;
    this.lock = new BodyLock(options.username, options.lockDir ?? resolveFromRoot("./data/locks"));
  }

  isAwaitingRespawn(): boolean {
    return this.awaitingRespawn;
  }

  connectionTelemetry(): ConnectionTelemetry {
    return {
      ...this.telemetry,
      health: deriveConnectionHealth({
        connected: this.connected,
        spawned: this.spawned,
        reconnecting: this.reconnecting,
        deceased: this.deceased,
        lastPacketRxAt: this.telemetry.lastPacketRxAt,
        lastPhysicsAt: this.telemetry.lastPhysicsAt,
        eventLoopLagMs: this.eventLoopLag?.(),
      }),
    };
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
    return Boolean(this.spawned && !this.awaitingRespawn && !this.shuttingDown && !this.deceased && this.bot && navigationBodyReady(this.bot));
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
    this.connecting = true;
    this.connectingPromise = this.connectInternal();
    try {
      return await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
      this.connecting = false;
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
    if (existing && existing !== this && (existing.connecting || existing.connected || existing.reconnecting)) {
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
      hideErrors: true,
      checkTimeoutInterval: 180_000,
    };

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result: ActionResult<{ username: string }>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.cancelConnection = undefined;
        resolve(result);
      };
      this.cancelConnection = () => finish(fail("CANCELLED", `Connect cancelled for ${this.username}`, Date.now() - started));
      const timeout = setTimeout(() => {
        if (settled) return;
        finish(fail("TIMEOUT", `Connect timed out for ${this.username}`, Date.now() - started, true));
        this.teardownBot("timeout");
        this.scheduleReconnect();
      }, 45_000);

      let bot: Bot;
      try {
        bot = mineflayer.createBot(options);
        this.bot = bot;
        patchMineflayerCrafting(bot);
        this.bindClientTelemetry(bot);
        this.bindBot(bot);
      } catch (error) {
        finish(fail("UNKNOWN", error instanceof Error ? error.message : String(error), Date.now() - started, true));
        this.teardownBot("connect-failed");
        this.lock.release();
        if (activeBodies.get(this.username.toLowerCase()) === this) activeBodies.delete(this.username.toLowerCase());
        return;
      }

      bot.once("spawn", () => {
        if (this.shuttingDown || this.deceased) {
          this.teardownBot("shutdown-during-connect");
          finish(fail("CANCELLED", `Connect cancelled for ${this.username}`, Date.now() - started));
          return;
        }
        this.spawned = true;
        this.reconnectAttempt = 0;
        this.bindClientTelemetry(bot);
        patchMineflayerCrafting(bot);
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
    this.reconnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.teardownBot(reason);
    if (activeBodies.get(this.username.toLowerCase()) === this) {
      this.lock.release();
      activeBodies.delete(this.username.toLowerCase());
    }
  }

  private bindClientTelemetry(bot: Bot): void {
    const client = asRecord((bot as unknown as { _client?: unknown })._client);
    if (!client || this.telemetryClients.has(client)) return;
    this.telemetryClients.add(client);
    const onError = (error: unknown) => {
      const policy = keepalivePolicy({ shuttingDown: this.shuttingDown, error });
      if (policy === "swallow_shutdown") {
        this.telemetry.keepaliveTimeouts += 1;
        this.telemetry.reconnectReason = error instanceof Error ? error.message : String(error);
        return;
      }
      if (policy === "fail_active_task") {
        this.telemetry.keepaliveTimeouts += 1;
        this.telemetry.reconnectReason = error instanceof Error ? error.message : String(error);
        this.spawned = false;
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : "";
        try {
          bot.emit(
            "end",
            /ECONNRESET/i.test(`${code} ${message}`) ? "transport-reset" : "keepalive-timeout",
          );
        } catch {
          // ignore
        }
        return;
      }
    };
    const onPacket = () => {
      this.telemetry.lastPacketRxAt = Date.now();
    };
    if (typeof client["on"] === "function") {
      (client["on"] as (event: string, fn: (...args: unknown[]) => void) => void)("error", onError);
      (client["on"] as (event: string, fn: (...args: unknown[]) => void) => void)("packet", onPacket);
      (client["on"] as (event: string, fn: (...args: unknown[]) => void) => void)("keep_alive", () => {
        this.telemetry.lastKeepaliveAt = Date.now();
      });
    }
    if (!this.telemetryBots.has(bot)) {
      this.telemetryBots.add(bot);
      bot.on("physicsTick", () => {
        this.telemetry.lastPhysicsAt = Date.now();
      });
    }
  }

  stopPathfinding(): void {
    const bot = this.bot;
    if (!bot) return;
    const pathfinder = asRecord((bot as unknown as { pathfinder?: unknown }).pathfinder);
    const stop = pathfinder?.["stop"];
    if (typeof stop === "function") {
      try { stop.call((bot as unknown as { pathfinder: unknown }).pathfinder); } catch { /* release controls even if the plugin retired */ }
    }
    const setGoal = pathfinder?.["setGoal"];
    if (typeof setGoal === "function") {
      try { setGoal.call((bot as unknown as { pathfinder: unknown }).pathfinder, null); } catch { /* continue control cleanup */ }
    }
    try {
      bot.clearControlStates();
    } catch {
      // ignore
    }
    for (const key of ["jump", "forward", "back", "left", "right", "sprint", "sneak"] as const) {
      try {
        bot.setControlState(key, false);
      } catch {
        // ignore
      }
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
      // SEC-001: bot.players is the server-wide tab list. A player with no loaded entity has no known distance and is
      // not "nearby": counting them would reveal every online citizen and let distant citizens "hear" nearby speech.
      if (info.distance !== undefined && info.distance <= maxDistance) {
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
      if (!isEntityPresent(bot.entities, entity)) continue;
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

  trackEntity(entity: { id: number; name?: string; username?: string }, kind = "entity"): void {
    if (!entity) return;
    this.activeTarget = { id: entity.id, name: entity.name, username: entity.username, kind };
  }

  trackedEntity(): { id: number; name?: string; username?: string; kind: string } | null {
    return this.activeTarget;
  }

  clearTrackedEntity(code?: EntityPresence | string, extra: Record<string, unknown> = {}): void {
    const prev = this.activeTarget;
    this.activeTarget = null;
    if (!prev) return;
    this.perceptionEpoch += 1;
    const resolved = code || "ENTITY_REMOVED";
    this.lastEntityResult = { code: resolved, id: prev.id, name: prev.name };
    this.stopPathfinding();
    const name = prev.name || prev.username || String(prev.id);
    const message =
      resolved === "TARGET_DEAD" || resolved === "ENTITY_REMOVED"
        ? entityGoneMessage(resolved, name)
        : `${resolved}: ${name} is gone, not out of range.`;
    if (resolved === "TARGET_DEAD") {
      this.events?.emit(
        createEvent("ActionCompleted", { code: resolved, entityId: prev.id, name, ...extra }, this.citizenId),
      );
    } else {
      this.events?.emit(
        createEvent("ActionFailed", { code: resolved, error: message, entityId: prev.id, name, ...extra }, this.citizenId),
      );
    }
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

  /** SEC-001: true only when THIS server told THIS player it may run /tell. */
  canWhisper(): boolean {
    return this.declaredCommands?.has(WHISPER_COMMAND) === true;
  }

  /**
   * SEC-001: directed speech over /tell (bot.whisper), one message per recipient; never server-wide chat. Fails closed
   * when the server's declared command tree does not include the command. The server sends no delivery receipt to
   * Mineflayer here, so `sent` means transmitted, not proven received.
   */
  whisperTo(usernames: readonly string[], message: string): ActionResult<{ sent: string[] }> {
    const started = Date.now();
    try {
      const bot = this.requireBot();
      if (!this.canWhisper()) {
        return fail("COMMAND_UNAVAILABLE", `server has not declared /${WHISPER_COMMAND} for ${this.username}`, Date.now() - started);
      }
      const text = sanitizeWhisperText(message);
      if (!text) return fail("EMPTY_MESSAGE", "nothing to say", Date.now() - started);
      const sent = usernames.filter((name) => VALID_USERNAME.test(name));
      for (const name of sent) bot.whisper(name, text);
      return ok({ sent }, Date.now() - started);
    } catch (error) {
      return fail("NOT_CONNECTED", error instanceof Error ? error.message : String(error), Date.now() - started);
    }
  }

  lastKickReason(): string | undefined {
    return this.lastKick;
  }

  private bindBot(bot: Bot): void {
    this.declaredCommands = undefined;
    (bot as unknown as DeclaredCommandSource)._client?.on("declare_commands", (packet: unknown) => {
      this.declaredCommands = declaredRootCommands(packet);
    });
    bot.on("login", () => {
      this.emit("connected");
      this.events?.emit(createEvent("CitizenConnected", { username: this.username }, this.citizenId));
    });

    bot.on("health", () => {
      this.emit("health");
    });

    bot.on("death", () => {
      if (this.deceased) return;
      this.stopPathfinding();
      if (!this.allowRespawn) {
        this.markDeceased();
        this.events?.emit(
          createEvent(
            "CitizenDied",
            { username: this.username, position: this.position(), terminal: true, inventory: this.inventory(), droppedByMinecraft: true },
            this.citizenId,
          ),
        );
        this.emit("death");
        void this.disconnect("citizen-deceased");
        return;
      }
      this.awaitingRespawn = true;
      this.emit("death");
      this.events?.emit(
        createEvent(
          "CitizenBodyDied",
          { username: this.username, position: this.position(), terminal: false, inventory: this.inventory(), droppedByMinecraft: true },
          this.citizenId,
        ),
      );
      try {
        bot.respawn();
      } catch {
        // respawn packet may fail if already respawning
      }
    });

    installModernMovement(bot);

    bot.on("spawn", () => {
      if (this.deceased) return;
      this.spawned = true;
      try {
        loadPathfinder(bot);
      } catch {
        // pathfinder plugin may already be loaded
      }
      if (this.awaitingRespawn) {
        this.awaitingRespawn = false;
        this.events?.emit(
          createEvent("CitizenRespawned", { username: this.username, position: this.position(), terminal: false }, this.citizenId),
        );
      }
    });

    bot.on("chat", (username, message) => {
      if (username === bot.username) return;
      this.emit("chat", username, message);
    });

    bot.on("entityGone", (entity) => {
      const tracked = this.activeTarget;
      if (!tracked || !entity || entity.id !== tracked.id) return;
      const code = classifyEntityPresence(bot.entities, entity);
      this.clearTrackedEntity(code === "PRESENT" ? "ENTITY_REMOVED" : code, { via: "entityGone" });
    });

    bot.on("kicked", (reason) => {
      this.lastKick = stringifyKick(reason);
      this.emit("kicked", this.lastKick);
      this.events?.emit(
        createEvent("CitizenKicked", { username: this.username, reason: this.lastKick }, this.citizenId),
      );
    });

    bot.on("error", (error) => {
      const policy = keepalivePolicy({ shuttingDown: this.shuttingDown, error });
      if (policy === "swallow_shutdown") {
        this.telemetry.keepaliveTimeouts += 1;
        this.telemetry.reconnectReason = error.message;
        return;
      }
      if (policy === "fail_active_task") {
        this.telemetry.keepaliveTimeouts += 1;
        this.telemetry.reconnectReason = error.message;
        this.spawned = false;
        this.events?.emit(
          createEvent(
            "ErrorOccurred",
            {
              username: this.username,
              error: error.message,
              code: (error as NodeJS.ErrnoException).code,
              handled: "fail_active_task",
            },
            this.citizenId,
          ),
        );
        try {
          // Observable disconnect — must not become an unhandled EventEmitter error.
          bot.emit("end", error.message.includes("ECONNRESET") || (error as NodeJS.ErrnoException).code === "ECONNRESET"
            ? "transport-reset"
            : "keepalive-timeout");
        } catch {
          // ignore
        }
        return;
      }
      this.events?.emit(
        createEvent("ErrorOccurred", { username: this.username, error: error.message }, this.citizenId),
      );
      // Node crashes on EventEmitter 'error' with zero listeners; keep it observable instead.
      if (this.listenerCount("error") > 0) {
        this.emit("error", error);
      } else {
        this.spawned = false;
        this.telemetry.reconnectReason = error.message;
        this.emit("disconnected", error.message);
      }
    });

    bot.on("end", (reason) => {
      if (this.bot !== bot) return;
      this.spawned = false;
      this.telemetry.disconnects += 1;
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
    this.reconnecting = true;
    this.telemetry.reconnects += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnecting = false;
      void this.connect();
    }, delay);
  }

  private teardownBot(reason: string): void {
    this.cancelConnection?.();
    const bot = this.bot;
    this.spawned = false;
    if (!bot) return;
    try {
      this.stopPathfinding();
    } catch {
      // plugin may already be gone
    }
    this.bot = null;
    // Notify navigation scopes before removing their listeners. quit/end may settle later.
    try { bot.emit("end", reason); } catch { /* continue retiring the transport */ }
    const client = (
      bot as unknown as { _client?: { removeAllListeners?: () => void; on?: (event: string, listener: (error: unknown) => void) => void; end?: (r?: string) => void } }
    )._client;
    armShutdownClient(client, reason);
    try {
      bot.quit(reason);
    } catch {
      try {
        bot.end(reason);
      } catch {
        // already closed
      }
    }
    bot.removeAllListeners();
    // Retired plugin callbacks may still report errors after their transport is closed.
    bot.on("error", () => undefined);
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
