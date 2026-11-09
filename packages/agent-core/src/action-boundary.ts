import { AsyncLocalStorage } from "node:async_hooks";
import { currentCleanupPermit, fail, type ActionResult } from "@civ/shared";
import type { MinecraftBody } from "@civ/minecraft-adapter";

/**
 * Minimal action boundary. Skills keep the real bot: this does not proxy it, so fishing's client listeners and
 * terrain-memory WeakMaps stay valid. A deactivated owner cannot send another mutating packet, and run() returns
 * at the deadline even when the skill never settles. The next action may then start; the abandoned one cannot.
 */
export const MUTATING_PACKETS = new Set([
  "block_dig",
  "block_place",
  "use_item",
  "use_entity",
  "window_click",
  "held_item_slot",
  "arm_animation",
]);

const cleanupDig = (name: string, data?: Record<string, unknown>) =>
  name === "block_dig" && (data?.["status"] === 1 || data?.["status"] === 5);

export const LATE_WRITE_REFUSED = "LATE_WRITE_REFUSED";

interface Owner {
  active: boolean;
  readonly name: string;
}

const owners = new AsyncLocalStorage<Owner>();

/** Snapshot the current action owner; late continuations retain this owner. */
export function captureActionOwnership(): () => boolean {
  const owner = owners.getStore();
  return () => owner === undefined || owner.active;
}
const guarded = new WeakSet<object>();
const boundaries = new WeakMap<object, ActionBoundary>();
const emitterGeneration = new WeakMap<object, number>();

type Listener = (...args: unknown[]) => void;

interface MutableEmitter {
  on(event: string, listener: Listener): unknown;
  once?(event: string, listener: Listener): unknown;
  addListener?(event: string, listener: Listener): unknown;
  off?(event: string, listener: Listener): unknown;
  removeListener?(event: string, listener: Listener): unknown;
}

interface SavedEmitter {
  on: MutableEmitter["on"];
  once?: MutableEmitter["once"];
  addListener?: MutableEmitter["addListener"];
  off?: MutableEmitter["off"];
  removeListener?: MutableEmitter["removeListener"];
}

const emitterOriginals = new WeakMap<object, SavedEmitter>();

/**
 * Listeners registered while an action is running keep that action's owner, even when a packet or physics tick
 * emits them later with no AsyncLocalStorage frame. Listeners registered before the action stay unowned, so
 * pathfinder and other plugin hooks keep working. Restoring on/once only affects later registrations.
 */
function bindEmitter(emitter: object, owner: Owner): () => void {
  const target = emitter as MutableEmitter;
  if (typeof target.on !== "function") return () => undefined;
  let saved = emitterOriginals.get(emitter);
  if (!saved) {
    saved = {
      on: target.on,
      once: target.once,
      addListener: target.addListener,
      off: target.off,
      removeListener: target.removeListener,
    };
    emitterOriginals.set(emitter, saved);
  }
  const generation = (emitterGeneration.get(emitter) ?? 0) + 1;
  emitterGeneration.set(emitter, generation);
  const wrapped = new Map<Listener, Listener>();
  const wrap = (listener: Listener): Listener => {
    const existing = wrapped.get(listener);
    if (existing) return existing;
    const bound: Listener = (...args) => {
      owners.run(owner, () => {
        listener(...args);
      });
    };
    wrapped.set(listener, bound);
    return bound;
  };
  const unwrap = (listener: Listener) => wrapped.get(listener) ?? listener;
  target.on = (event, listener) => saved.on.call(target, event, wrap(listener));
  if (saved.once) target.once = (event, listener) => saved.once?.call(target, event, wrap(listener));
  if (saved.addListener) target.addListener = (event, listener) => saved.addListener?.call(target, event, wrap(listener));
  if (saved.off) target.off = (event, listener) => saved.off?.call(target, event, unwrap(listener));
  if (saved.removeListener) {
    target.removeListener = (event, listener) => saved.removeListener?.call(target, event, unwrap(listener));
  }
  return () => {
    if (emitterGeneration.get(emitter) !== generation) return;
    target.on = saved.on;
    if (saved.once) target.once = saved.once;
    if (saved.addListener) target.addListener = saved.addListener;
    if (saved.off) target.off = saved.off;
    if (saved.removeListener) target.removeListener = saved.removeListener;
    emitterGeneration.delete(emitter);
  };
}

export interface ClientLike {
  write(name: string, data?: Record<string, unknown>): void;
}

function isLateRefusal(error: unknown): boolean {
  return error instanceof Error && (error as { code?: string }).code === LATE_WRITE_REFUSED;
}

function refuseLateWrite(name: string, owner: Owner): never {
  throw Object.assign(new Error(`late ${name} refused: action '${owner.name}' is no longer active`), {
    name: "AbortError",
    code: LATE_WRITE_REFUSED,
  });
}

/**
 * Mineflayer arms some writes on its own timers (digging's swing interval). A refused write must not escape
 * that timer as an uncaught exception. Callbacks scheduled during an action swallow only LATE_WRITE_REFUSED;
 * every other error still propagates, and the packet is still not sent.
 */
let timerWrapDepth = 0;
let savedTimeout: typeof setTimeout | undefined;
let savedInterval: typeof setInterval | undefined;

type TimerCallback = (this: unknown, ...args: unknown[]) => unknown;

function guardTimer(fn: TimerCallback): TimerCallback {
  return function guarded(this: unknown, ...args: unknown[]) {
    try {
      return fn.apply(this, args);
    } catch (error) {
      if (isLateRefusal(error)) return undefined;
      throw error;
    }
  };
}

function bindScheduledCallbacks(): () => void {
  if (timerWrapDepth === 0) {
    savedTimeout = globalThis.setTimeout;
    savedInterval = globalThis.setInterval;
    const timeout = savedTimeout;
    const interval = savedInterval;
    globalThis.setTimeout = ((fn: TimerCallback, ms?: number, ...args: unknown[]) =>
      timeout(guardTimer(fn) as never, ms as number, ...(args as []))) as typeof setTimeout;
    globalThis.setInterval = ((fn: TimerCallback, ms?: number, ...args: unknown[]) =>
      interval(guardTimer(fn) as never, ms as number, ...(args as []))) as typeof setInterval;
  }
  timerWrapDepth += 1;
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    timerWrapDepth -= 1;
    if (timerWrapDepth === 0 && savedTimeout && savedInterval) {
      globalThis.setTimeout = savedTimeout;
      globalThis.setInterval = savedInterval;
      savedTimeout = undefined;
      savedInterval = undefined;
    }
  };
}

export function installPacketGuard(client: ClientLike): void {
  if (guarded.has(client)) return;
  guarded.add(client);
  const original = client.write.bind(client);
  client.write = (name: string, data?: Record<string, unknown>) => {
    if (MUTATING_PACKETS.has(name) && !cleanupDig(name, data) && !currentCleanupPermit()?.packets.has(name)) {
      const owner = owners.getStore();
      if (owner !== undefined && !owner.active) refuseLateWrite(name, owner);
    }
    return original(name, data);
  };
}

export interface ActionRunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  /** How long a cooperating skill has to report its own result after abort or the deadline. */
  readonly graceMs?: number;
}

export interface ActionBoundary {
  run<T>(name: string, skill: (signal: AbortSignal) => Promise<ActionResult<T>>, options: ActionRunOptions): Promise<ActionResult<T>>;
  readonly orphans: () => number;
}

export function createActionBoundary(
  clientOf: () => ClientLike | undefined,
  emittersOf?: () => ReadonlyArray<object | undefined>,
): ActionBoundary {
  let tail: Promise<unknown> = Promise.resolve();
  let orphans = 0;

  async function runOne<T>(
    name: string,
    skill: (signal: AbortSignal) => Promise<ActionResult<T>>,
    options: ActionRunOptions,
  ): Promise<ActionResult<T>> {
    const client = clientOf();
    if (client) installPacketGuard(client);
    const owner: Owner = { active: true, name };
    const restoreTimers = bindScheduledCallbacks();
    const emitters: object[] = [];
    const seen = new Set<object>();
    const addEmitter = (value: object | undefined) => {
      if (!value || seen.has(value) || typeof (value as { on?: unknown }).on !== "function") return;
      seen.add(value);
      emitters.push(value);
    };
    // The guarded client is an emitter for fishing. Listeners registered on it during the action keep this owner
    // even when the test boundary was not given a separate emitters list.
    if (client && typeof client === "object") addEmitter(client);
    for (const emitter of emittersOf?.() ?? []) addEmitter(emitter);
    const restoreEmitters = emitters.map((emitter) => bindEmitter(emitter, owner));
    const started = Date.now();
    const controller = new AbortController();
    const forward = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) forward();
    else options.signal?.addEventListener("abort", forward, { once: true });
    const timer = setTimeout(() => controller.abort(Object.assign(new Error("deadline"), { code: "DEADLINE" })), options.timeoutMs);

    const work = owners.run(owner, () => skill(controller.signal));
    let settled = false;
    void work.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const aborted = new Promise<"aborted">((resolve) => {
      if (controller.signal.aborted) resolve("aborted");
      else controller.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });

    try {
      const first = await Promise.race([
        work.then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        ),
        aborted,
      ]);
      if (first === "aborted") {
        owner.active = false;
        const reported = await Promise.race([
          work.then(
            (result) => ({ result }),
            (error: unknown) => ({ error }),
          ),
          new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), options.graceMs ?? 250)),
        ]);
        const deadline = (controller.signal.reason as { code?: string } | undefined)?.code === "DEADLINE";
        if (reported !== "slow" && "result" in reported) return reported.result;
        if (reported === "slow" && !settled) orphans += 1;
        // A skill that never answers is not a transient error and must not be retried or reconnected.
        return deadline
          ? fail("TIMEOUT", `${name} exceeded ${options.timeoutMs} ms and was abandoned`, Date.now() - started, false)
          : fail("CANCELLED", `${name} cancelled`, Date.now() - started, false);
      }
      if ("error" in first) {
        return fail("UNKNOWN", first.error instanceof Error ? first.error.message : String(first.error), Date.now() - started, false);
      }
      return first.result;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", forward);
      owner.active = false;
      for (const restore of restoreEmitters) restore();
      restoreTimers();
    }
  }

  return {
    orphans: () => orphans,
    run(name, skill, options) {
      const result = tail.then(() => runOne(name, skill, options));
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

function clientOf(body: MinecraftBody): ClientLike | undefined {
  const bot = body.getBot() as { _client?: ClientLike } | null;
  return bot?._client;
}

function emittersOf(body: MinecraftBody): object[] {
  const bot = body.getBot() as { _client?: object } | null;
  if (!bot) return [];
  return bot._client ? [bot, bot._client] : [bot];
}

/** One boundary per body, so a reconnect can guard the new client without losing the serialization queue. */
export function actionBoundaryFor(body: MinecraftBody): ActionBoundary {
  const existing = boundaries.get(body);
  if (existing) return existing;
  const created = createActionBoundary(
    () => clientOf(body),
    () => emittersOf(body),
  );
  boundaries.set(body, created);
  return created;
}
