import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../../../packages/shared/src/index.js";
import { EventBus } from "../../../packages/shared/src/index.js";
import { MinecraftBody } from "../../../packages/minecraft-adapter/src/minecraft-body.js";
import {
  setNavigationBackend,
  navigationBackend,
  type NavigationBackend,
} from "../../../packages/minecraft-adapter/src/navigation.js";
import { ok, fail, abortedResult } from "../../../packages/shared/src/index.js";
import type { SkillContext } from "../../../packages/skills/src/context.js";

/** Minimal stand-in for prismarine's Vec3 (only what the audited code calls on the bot's own positions). */
class Vec3 {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}
  plus(o: { x: number; y: number; z: number }): Vec3 {
    return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z);
  }
  minus(o: { x: number; y: number; z: number }): Vec3 {
    return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z);
  }
  offset(x: number, y: number, z: number): Vec3 {
    return new Vec3(this.x + x, this.y + y, this.z + z);
  }
  distanceTo(o: { x: number; y: number; z: number }): number {
    return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z);
  }
  floored(): Vec3 {
    return new Vec3(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
  }
}

export interface Mutation {
  readonly kind: string;
  readonly at: number;
  readonly detail?: string;
}

type Item = { name: string; count: number; type: number; slot?: number };
const ITEM_TYPES: Record<string, number> = {
  raw_iron: 1,
  iron_ingot: 2,
  coal: 3,
  cobblestone: 4,
  crafting_table: 5,
  oak_planks: 6,
  bread: 7,
};

/**
 * A controlled offline Mineflayer-shaped bot. It implements only what the audited production functions touch, and it
 * records every world-affecting call with a timestamp so a test can ask "did anything mutate after the abort?".
 * Behaviour that mirrors a third-party library is marked with the library file it copies.
 */
export class OfflineBot extends EventEmitter {
  username: string;
  entity = {
    id: 1,
    position: new Vec3(0.5, 64, 0.5),
    onGround: true,
    yaw: 0,
    pitch: 0,
    height: 1.8,
  };
  game = { gameMode: "survival", dimension: "overworld" };
  health = 20;
  food = 10;
  quickBarSlot = 0;
  heldItem: Item | null = null;
  entities: Record<number, unknown> = {};
  currentWindow: unknown = null;
  isSleeping = false;
  readonly mutations: Mutation[] = [];
  readonly blocks = new Map<string, { name: string }>();
  readonly slots: Array<Item | null> = Array.from({ length: 46 }, () => null);
  readonly timing = { equipMs: 0, lookMs: 0 };
  /** What the server does when a window is requested. "never" = the server never sends windowOpen. */
  windowOpens: "immediately" | "never" = "immediately";
  /** Server round-trip before a window opens. */
  windowDelayMs = 0;
  furnace?: FakeFurnace;
  chest = new Map<string, number>();
  registry = {
    itemsByName: Object.fromEntries(
      Object.entries(ITEM_TYPES).map(([name, id]) => [name, { id, name }]),
    ),
    items: Object.fromEntries(Object.entries(ITEM_TYPES).map(([name, id]) => [id, { id, name }])),
    blocksByName: {},
  };
  readonly inventory: EventEmitter & {
    slots: Array<Item | null>;
    items(): Item[];
    inventoryStart: number;
    inventoryEnd: number;
  };
  readonly _client = Object.assign(new EventEmitter(), {
    writes: [] as string[],
    write(name: string, _data?: Record<string, unknown>) {
      this.writes.push(name);
    },
  });

  constructor(username: string) {
    super();
    this.username = username;
    const slots = this.slots;
    this.inventory = Object.assign(new EventEmitter(), {
      slots,
      inventoryStart: 9,
      inventoryEnd: 45,
      items: () => slots.filter((s): s is Item => s !== null),
    });
  }

  give(name: string, count: number): void {
    const slot = this.slots.findIndex((s, i) => i >= 9 && s === null);
    this.slots[slot] = { name, count, type: ITEM_TYPES[name] ?? 99, slot };
  }
  count(name: string): number {
    return this.slots.filter((s) => s?.name === name).reduce((n, s) => n + (s?.count ?? 0), 0);
  }
  /** Every world-affecting call writes its packet first, so a packet-level guard can refuse it. A refusal throws. */
  private mutate(kind: string, packet: string, detail?: string): void {
    this._client.write(packet, { kind });
    this.mutations.push({ kind, at: Date.now(), detail });
  }
  private record(kind: string, detail?: string): void {
    this.mutations.push({ kind, at: Date.now(), detail });
  }
  mutationsAfter(t: number): Mutation[] {
    return this.mutations.filter((m) => m.at > t);
  }

  blockAt(p: Vec3): { name: string; position: Vec3; boundingBox: string } | null {
    const b = this.blocks.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`);
    return {
      name: b?.name ?? "air",
      position: p,
      boundingBox: b && b.name !== "air" ? "block" : "empty",
    };
  }
  async lookAt(): Promise<void> {
    await new Promise((r) => setTimeout(r, this.timing.lookMs));
  }
  async look(): Promise<void> {}
  async equip(item: Item): Promise<void> {
    await new Promise((r) => setTimeout(r, this.timing.equipMs));
    this._client.write("held_item_slot", { kind: "equip" });
    this.heldItem = item;
    this.record("equip", item.name);
  }
  async unequip(): Promise<void> {
    this.heldItem = null;
  }
  async placeBlock(ref: { position: Vec3 }, face: Vec3): Promise<void> {
    const at = ref.position.plus(face);
    this.mutate("placeBlock", "block_place", `${at.x},${at.y},${at.z}`);
    this.blocks.set(`${at.x},${at.y},${at.z}`, { name: this.heldItem?.name ?? "cobblestone" });
  }
  /** Mirrors mineflayer@4.39.0 lib/plugins/inventory.js:405-410: activateBlock, then an unbounded once(bot,'windowOpen'). */
  async openBlock(): Promise<unknown> {
    this.mutate("activateBlock", "block_place");
    if (this.windowOpens === "never") return new Promise(() => undefined);
    await new Promise((r) => setTimeout(r, this.windowDelayMs));
    return this.chestWindow();
  }
  openContainer = (): Promise<unknown> => this.openBlock();
  async openFurnace(): Promise<unknown> {
    this.mutate("activateBlock", "block_place", "furnace");
    if (this.windowOpens === "never") return new Promise(() => undefined);
    await new Promise((r) => setTimeout(r, this.windowDelayMs));
    return this.furnace;
  }
  private chestWindow() {
    return {
      containerItems: () =>
        [...this.chest].map(([name, count]) => ({ name, count, type: ITEM_TYPES[name] ?? 99 })),
      deposit: async (type: number, _m: null, count: number) => {
        const name = Object.keys(ITEM_TYPES).find((k) => ITEM_TYPES[k] === type)!;
        this.mutate("chest.deposit", "window_click", `${name}x${count}`);
        for (const s of this.slots)
          if (s?.name === name) {
            s.count -= count;
            break;
          }
        this.chest.set(name, (this.chest.get(name) ?? 0) + count);
      },
      withdraw: async () => {},
      close: () => {},
    };
  }
  async tossStack(): Promise<void> {
    this.mutate("toss", "window_click");
  }
  attack(entity: { id: number }): void {
    this.mutate("attack", "use_entity", String(entity.id));
  }
  setControlState(): void {}
  getControlState(): boolean {
    return false;
  }
  clearControlStates(): void {}
  setQuickBarSlot(): void {}
  stopDigging(): void {}
  supportFeature(): boolean {
    return false;
  }
  respawn(): void {
    setTimeout(() => this.emit("spawn"), 5);
  }
  chat(): void {}
  whisper(): void {}
  quit(reason?: string): void {
    this.end(reason);
  }
  end(reason?: string): void {
    this.emit("end", reason ?? "quit");
  }
}

export class FakeFurnace {
  readonly operations: Mutation[] = [];
  private readonly t0 = Date.now();
  constructor(
    private readonly producesAfterMs: number,
    private readonly bot: OfflineBot,
  ) {}
  private record(kind: string): void {
    this.bot._client.write("window_click", { kind });
    const m = { kind, at: Date.now() };
    this.operations.push(m);
    this.bot.mutations.push(m);
  }
  fuelItem(): Item | null {
    return this.fueled ? { name: "coal", count: 1, type: 3 } : null;
  }
  private fueled = false;
  private input = false;
  inputItem(): Item | null {
    return this.input ? { name: "raw_iron", count: 1, type: 1 } : null;
  }
  outputItem(): Item | null {
    return Date.now() - this.t0 >= this.producesAfterMs && this.input
      ? { name: "iron_ingot", count: 1, type: 2 }
      : null;
  }
  async putInput(): Promise<void> {
    this.input = true;
    this.record("furnace.putInput");
  }
  async putFuel(): Promise<void> {
    this.fueled = true;
    this.record("furnace.putFuel");
  }
  async takeOutput(): Promise<void> {
    this.record("furnace.takeOutput");
    this.bot.give("iron_ingot", 1);
  }
  close(): void {}
}

export class OfflineBody extends MinecraftBody {
  readonly bus = new EventBus();
  constructor(
    readonly fake: OfflineBot,
    citizenId: string,
  ) {
    super({
      username: fake.username,
      citizenId,
      config: {} as AppConfig,
      lockDir: mkdtempSync(join(tmpdir(), "audit-lock-")),
      allowRespawn: true,
      reconnect: false,
      events: new EventBus(),
    });
    const internals = this as unknown as { bot: unknown; bindBot(b: unknown): void };
    internals.bot = fake;
    internals.bindBot(fake);
  }
}

export function offlineBody(username = "Atlas", citizenId = "citizen_atlas"): OfflineBody {
  return new OfflineBody(new OfflineBot(username), citizenId);
}

export function skillContext(
  body: OfflineBody,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): SkillContext {
  return {
    body,
    bot: body.fake as unknown as SkillContext["bot"],
    signal: options.signal,
    citizenId: "citizen_atlas",
    timeoutMs: options.timeoutMs ?? 22_000,
  };
}

/** Navigation that succeeds immediately, UNLESS the signal is already aborted (what the real backend does at entry). */
export function installInstantNavigation(): () => void {
  const previous = navigationBackend();
  const result = (signal?: AbortSignal) =>
    signal?.aborted ? abortedResult(0) : ok({ position: { x: 0, y: 64, z: 0 }, distance: 0 }, 0);
  const stub = Object.assign(Object.create(previous) as NavigationBackend, {
    name: "audit-instant",
    navigateToPosition: (async (_b, _t, o) =>
      result(o?.signal)) as NavigationBackend["navigateToPosition"],
    navigateNear: (async (_b, _t, _r, o) => result(o?.signal)) as NavigationBackend["navigateNear"],
    navigateToInteractWithBlock: (async (_b, _t, o) =>
      result(o?.signal)) as NavigationBackend["navigateToInteractWithBlock"],
    navigateToPlaceBlock: (async (_b, _t, o) =>
      result(o?.signal)) as NavigationBackend["navigateToPlaceBlock"],
    followEntity: async () => fail("UNSUPPORTED_ACTION", "not used", 0),
  });
  setNavigationBackend(stub);
  return () => setNavigationBackend(previous);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
