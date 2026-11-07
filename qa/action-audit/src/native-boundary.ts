import { AsyncLocalStorage } from "node:async_hooks";
import { fail, type ActionResult } from "../../../packages/shared/src/action-result.js";

/**
 * PROTOTYPE of a small native action boundary (not production code, not imported by anything outside this QA folder).
 *
 * It exists to answer one question with a running example: can ~100 lines we own fix the CONFIRMED defects without the
 * YC runner's proxy? It deliberately avoids the proxy, so skills keep the real bot (fishing's `bot._client`, and the
 * WeakMaps keyed by the bot, keep working).
 *
 * Three mechanisms:
 *  1. Ownership: every action runs inside an AsyncLocalStorage owner. When the action is aborted, times out or ends,
 *     its owner is deactivated at once.
 *  2. Packet guard: bot._client.write refuses world-mutating packets written by a DEACTIVATED owner. Writes with no
 *     owner (code that does not use the boundary yet) are allowed, so adoption can be incremental.
 *  3. Hard deadline and serialisation: run() returns at the deadline even if the skill never settles, and the next
 *     action may start because the orphan can no longer mutate.
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
const isCleanup = (name: string, data?: Record<string, unknown>) =>
  name === "block_dig" && (data?.["status"] === 1 || data?.["status"] === 5);

export const LATE_WRITE_REFUSED = "LATE_WRITE_REFUSED";

interface Owner {
  active: boolean;
  readonly name: string;
}
const als = new AsyncLocalStorage<Owner>();
const installed = new WeakSet<object>();

export interface ClientLike {
  write(name: string, data?: Record<string, unknown>): void;
}

export function installPacketGuard(client: ClientLike): void {
  if (installed.has(client)) return;
  installed.add(client);
  const original = client.write.bind(client);
  client.write = (name: string, data?: Record<string, unknown>) => {
    if (MUTATING_PACKETS.has(name) && !isCleanup(name, data)) {
      const owner = als.getStore();
      if (owner !== undefined && !owner.active) {
        throw Object.assign(
          new Error(`late ${name} refused: action '${owner.name}' is no longer active`),
          { name: "AbortError", code: LATE_WRITE_REFUSED },
        );
      }
    }
    return original(name, data);
  };
}

export interface NativeRunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  /** After abort/deadline, how long a cooperating skill gets to hand back its own report before we answer for it. */
  readonly graceMs?: number;
}

export interface NativeBoundary {
  run<T>(
    name: string,
    skill: (signal: AbortSignal) => Promise<ActionResult<T>>,
    options: NativeRunOptions,
  ): Promise<ActionResult<T>>;
  /** Actions that were abandoned at their deadline and have not settled (they can no longer mutate). */
  readonly orphans: () => number;
}

export function createNativeBoundary(client: ClientLike): NativeBoundary {
  installPacketGuard(client);
  let tail: Promise<unknown> = Promise.resolve();
  let orphans = 0;

  async function runOne<T>(
    name: string,
    skill: (signal: AbortSignal) => Promise<ActionResult<T>>,
    options: NativeRunOptions,
  ): Promise<ActionResult<T>> {
    const started = Date.now();
    const controller = new AbortController();
    const owner: Owner = { active: true, name };
    const forward = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) forward();
    else options.signal?.addEventListener("abort", forward, { once: true });
    const timer = setTimeout(
      () => controller.abort(Object.assign(new Error("deadline"), { code: "DEADLINE" })),
      options.timeoutMs,
    );

    const work = als.run(owner, () => skill(controller.signal));
    let workSettled = false;
    void work.then(
      () => (workSettled = true),
      () => (workSettled = true),
    );

    const aborted = new Promise<"aborted">((resolve) => {
      if (controller.signal.aborted) resolve("aborted");
      else controller.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });
    try {
      const first = await Promise.race([
        work.then(
          (r) => ({ r }),
          (e: unknown) => ({ e }),
        ),
        aborted,
      ]);
      if (first === "aborted") {
        owner.active = false; // from this instant no late packet from this action goes out
        const settled = await Promise.race([
          work.then(
            (r) => ({ r }),
            (e: unknown) => ({ e }),
          ),
          new Promise<"slow">((r) => setTimeout(() => r("slow"), options.graceMs ?? 250)),
        ]);
        const deadline =
          (controller.signal.reason as { code?: string } | undefined)?.code === "DEADLINE";
        if (settled !== "slow" && "r" in settled) return settled.r; // the skill's own INTERRUPTED/CANCELLED report
        if (settled === "slow" && !workSettled) orphans += 1;
        return deadline
          ? fail(
              "TIMEOUT",
              `${name} exceeded ${options.timeoutMs} ms and was abandoned`,
              Date.now() - started,
              true,
            )
          : fail("CANCELLED", `${name} cancelled`, Date.now() - started, false);
      }
      if ("e" in first)
        return fail(
          "UNKNOWN",
          first.e instanceof Error ? first.e.message : String(first.e),
          Date.now() - started,
          false,
        );
      return first.r;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", forward);
      owner.active = false;
    }
  }

  return {
    orphans: () => orphans,
    run(name, skill, options) {
      const result = tail.then(() => runOne(name, skill, options));
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
