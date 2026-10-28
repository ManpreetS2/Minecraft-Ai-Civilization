/**
 * One-cast fishing cycle adapted from mineflayer@4.39.0 `lib/plugins/fishing.js`
 * (MIT, PrismarineJS / Andrew Kelley). See THIRD_PARTY_NOTICES.md.
 *
 * Stock `bot.fish()` binds `lastBobber` to the first `spawn_entity` of type
 * fishing_bobber while that bot's fishing task is active. Each client also
 * receives nearby other players' bobbers, so two shore casters can bind the
 * wrong hook. This adapter keeps the upstream particle reel
 * (fishing/bubble ×6 within 1.23 of the bound bobber) and 1.21 `biting`
 * metadata on the bound hook, but only binds a bobber that spawned after
 * THIS bot's own cast and matches this bot's spawn `objectData` entity id
 * when present.
 *
 * Do not call stock `bot.fish()` for concurrent Kai+Atlas fishing.
 */

function isBobberName(name: string): boolean {
  const text = name.toLowerCase();
  return text.includes("fishing_bobber") || text.includes("fishing hook") || text.trim() === "bobber";
}

export const MF_FISH_PARTICLE_DISTANCE = 1.23;
export const MF_FISH_PARTICLE_AMOUNT = 6;
export const MF_FISH_BOBBER_BIND_MS = 2_000;
/** Wait for sibling hooks before falling back to nearest unlabeled bobber. */
export const MF_FISH_COLLECT_MS = 250;

export type FishCyclePhase = "IDLE" | "CAST" | "WAIT_FOR_OWN_BITE" | "REEL" | "VERIFY_OWN_CATCH";
export type FishRodAction = "none" | "cast" | "reel";
export type Vec3Like = { x: number; y: number; z: number };

export type FishRodLog = {
  t: number;
  ownerId: string;
  attemptId: string;
  phase: FishCyclePhase;
  action: string;
  detail: string;
};

export type BobberEntity = {
  id: number;
  name?: string;
  displayName?: string;
  uuid?: string;
  position?: Vec3Like;
  owner?: { uuid?: string } | string;
  ownerUUID?: string;
  /** 1.21 spawn_entity `objectData`: thrower entity id when > 0. */
  ownerEntityId?: number;
};

export type ParticlePacket = {
  particle?: { type?: string };
  particleId?: number;
  amount?: number;
  particles?: number;
  x: number;
  y?: number;
  z: number;
};

export type FishClient = {
  on(event: string, fn: (...args: unknown[]) => void): void;
  off?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
};

export type FishableBot = {
  username?: string;
  entity?: { id?: number; uuid?: string; position?: Vec3Like };
  entities: Record<string | number, BobberEntity | undefined>;
  activateItem: (offHand?: boolean) => void;
  supportFeature?: (name: string) => boolean;
  registry?: {
    supportFeature?: (name: string) => boolean;
    entitiesByName?: Record<string, { id: number; metadataKeys?: string[] }>;
    particlesByName?: Record<string, { id: number }>;
  };
  _client: FishClient;
};

export type FishCycleEvent =
  | "cast-requested"
  | "own-bite"
  | "other-bite"
  | "timeout"
  | "cancel"
  | "duplicate-cast"
  | "bobber-lost"
  | "bound";

const inflight = new WeakMap<object, { cancel: (reason: string) => void; phase: FishCyclePhase }>();

export function hypotXZ(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function listBobberIds(entities: FishableBot["entities"]): number[] {
  const ids: number[] = [];
  for (const entity of Object.values(entities)) {
    if (!entity) continue;
    const label = `${entity.name ?? ""} ${entity.displayName ?? ""}`;
    if (isBobberName(label)) ids.push(entity.id);
  }
  return ids;
}

export function bobberOwnerUuid(entity: BobberEntity): string | undefined {
  if (typeof entity.owner === "string") return entity.owner;
  if (entity.owner && typeof entity.owner === "object" && entity.owner.uuid) return entity.owner.uuid;
  if (entity.ownerUUID) return entity.ownerUUID;
  return undefined;
}

export function normalizeUuid(value: string | undefined): string | undefined {
  return value?.replace(/-/g, "").toLowerCase();
}

export function shouldBindSpawnedBobber(input: {
  taskActive: boolean;
  alreadyBound: boolean;
  packetType: number | string;
  bobberTypeId: number;
  entityId: number;
  preexistingIds: readonly number[];
}): boolean {
  if (!input.taskActive || input.alreadyBound) return false;
  const typeOk =
    input.packetType === input.bobberTypeId ||
    input.packetType === "fishing_bobber" ||
    input.packetType === "fishing_hook";
  if (!typeOk) return false;
  if (input.preexistingIds.includes(input.entityId)) return false;
  return true;
}

function nearestBobber(pool: BobberEntity[], botPos?: Vec3Like): BobberEntity | undefined {
  if (pool.length === 0) return undefined;
  if (!botPos) return pool[0];
  return [...pool].sort((a, b) => {
    const da = a.position ? hypotXZ(a.position, botPos) : 99;
    const db = b.position ? hypotXZ(b.position, botPos) : 99;
    return da - db;
  })[0];
}

export function spawnOwnerEntityId(packet: { objectData?: number; data?: number }): number | undefined {
  const value = packet.objectData ?? packet.data;
  return typeof value === "number" && value > 0 ? value : undefined;
}

/**
 * Bind this bot's hook among bobbers that appeared after its own cast.
 * Known-foreign hooks (other thrower's entity id / uuid) are never selected.
 * Nearest-unlabeled fallback is opt-in so the first observed unlabeled spawn
 * is not treated as `lastBobber` the way stock `bot.fish()` does.
 */
export function chooseBoundBobber(
  spawned: BobberEntity[],
  bot: { uuid?: string; id?: number; position?: Vec3Like } = {},
  opts?: { allowNearestFallback?: boolean },
): BobberEntity | undefined {
  if (spawned.length === 0) return undefined;
  const myId = bot.id;
  const myUuid = normalizeUuid(bot.uuid);
  const byThrower = myId != null ? spawned.filter((entity) => entity.ownerEntityId === myId) : [];
  if (byThrower.length > 0) return nearestBobber(byThrower, bot.position);
  const byUuid = myUuid
    ? spawned.filter((entity) => normalizeUuid(bobberOwnerUuid(entity)) === myUuid)
    : [];
  if (byUuid.length > 0) return nearestBobber(byUuid, bot.position);
  const unlabeled = spawned.filter((entity) => {
    if (myId != null && entity.ownerEntityId != null && entity.ownerEntityId !== myId) return false;
    const owner = normalizeUuid(bobberOwnerUuid(entity));
    if (myUuid && owner && owner !== myUuid) return false;
    return entity.ownerEntityId == null && !bobberOwnerUuid(entity);
  });
  if (!opts?.allowNearestFallback) return undefined;
  return nearestBobber(unlabeled, bot.position);
}

export function isOwnBiteParticle(input: {
  boundPos: Vec3Like;
  boundId: number;
  packet: ParticlePacket;
  updatedParticlesPacket: boolean;
  fishingOrBubbleId?: number;
}): boolean {
  const dist = hypotXZ({ x: input.packet.x, y: input.boundPos.y, z: input.packet.z }, input.boundPos);
  if (dist > MF_FISH_PARTICLE_DISTANCE) return false;
  if (input.updatedParticlesPacket) {
    const kind = input.packet.particle?.type;
    return (kind === "fishing" || kind === "bubble") && input.packet.amount === MF_FISH_PARTICLE_AMOUNT;
  }
  return input.packet.particleId === input.fishingOrBubbleId && input.packet.particles === MF_FISH_PARTICLE_AMOUNT;
}

export function isOwnBobberBiting(input: {
  boundId: number;
  packet: { entityId?: number; metadata?: Array<{ key?: number; value?: unknown }> };
  metadataKeys?: string[];
}): boolean {
  if (input.packet.entityId !== input.boundId) return false;
  const bitingIndex = input.metadataKeys?.indexOf("biting") ?? -1;
  for (const entry of input.packet.metadata ?? []) {
    if (typeof entry.key !== "number") continue;
    if (bitingIndex >= 0 && entry.key === bitingIndex && entry.value === true) return true;
  }
  return false;
}

export function rodCommandForEvent(input: {
  phase: FishCyclePhase;
  event: FishCycleEvent;
  hasOwnBobber: boolean;
  alreadyReeled: boolean;
}): { phase: FishCyclePhase; rod: FishRodAction; reason: string } {
  if (input.alreadyReeled && input.event !== "cast-requested") {
    return { phase: input.phase, rod: "none", reason: "already-reeled" };
  }
  if (input.event === "other-bite") {
    return { phase: input.phase, rod: "none", reason: "foreign-bobber-ignored" };
  }
  if (input.event === "duplicate-cast") {
    return { phase: input.phase, rod: "none", reason: "duplicate-cast-ignored" };
  }
  switch (input.phase) {
    case "IDLE":
      if (input.event === "cast-requested") return { phase: "CAST", rod: "cast", reason: "cast" };
      return { phase: "IDLE", rod: "none", reason: "idle" };
    case "CAST":
      if (input.event === "bound" && input.hasOwnBobber) {
        return { phase: "WAIT_FOR_OWN_BITE", rod: "none", reason: "bobber-bound" };
      }
      if (input.event === "timeout" || input.event === "cancel") {
        return { phase: "VERIFY_OWN_CATCH", rod: input.hasOwnBobber ? "reel" : "none", reason: input.event };
      }
      return { phase: "CAST", rod: "none", reason: "await-bobber" };
    case "WAIT_FOR_OWN_BITE":
      if (input.event === "own-bite" && input.hasOwnBobber) {
        return { phase: "REEL", rod: "reel", reason: "own-particle-bite" };
      }
      if (input.event === "bobber-lost") {
        return { phase: "VERIFY_OWN_CATCH", rod: "none", reason: "bobber-lost-no-toggle" };
      }
      if (input.event === "timeout" || input.event === "cancel") {
        return { phase: "REEL", rod: input.hasOwnBobber ? "reel" : "none", reason: input.event };
      }
      return { phase: "WAIT_FOR_OWN_BITE", rod: "none", reason: "still-waiting" };
    case "REEL":
      return { phase: "VERIFY_OWN_CATCH", rod: "none", reason: "verify" };
    default:
      return { phase: "VERIFY_OWN_CATCH", rod: "none", reason: "done" };
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detach(client: FishClient, event: string, fn: (...args: unknown[]) => void): void {
  client.removeListener?.(event, fn);
  client.off?.(event, fn);
}

function bobberTypeId(bot: FishableBot): number {
  if (bot.supportFeature?.("fishingBobberCorrectlyNamed")) {
    return bot.registry?.entitiesByName?.fishing_bobber?.id ?? 90;
  }
  return bot.registry?.entitiesByName?.fishing_bobber?.id ?? 90;
}

function particleMode(bot: FishableBot): { updated: boolean; fishingOrBubbleId?: number } {
  const updated = Boolean(bot.registry?.supportFeature?.("updatedParticlesPacket"));
  const fishingOrBubbleId = (bot.registry?.particlesByName?.fishing ?? bot.registry?.particlesByName?.bubble)?.id;
  return { updated, fishingOrBubbleId };
}

export async function runMineflayerFishCycle(
  bot: FishableBot,
  opts: {
    timeoutMs: number;
    signal?: AbortSignal;
    ownerId?: string;
    attemptId?: string;
    now?: () => number;
    onLog?: (event: FishRodLog) => void;
  },
): Promise<{
  result: "reeled" | "timeout" | "cancelled" | "no-bobber" | "already-fishing";
  bobberId?: number;
  logs: FishRodLog[];
  activations: number;
}> {
  const ownerId = opts.ownerId ?? bot.username ?? "unknown";
  const attemptId = opts.attemptId ?? `${ownerId}-${opts.now?.() ?? Date.now()}`;
  const now = opts.now ?? Date.now;
  const logs: FishRodLog[] = [];
  const log = (phase: FishCyclePhase, action: string, detail: string) => {
    const event = { t: now(), ownerId, attemptId, phase, action, detail };
    logs.push(event);
    opts.onLog?.(event);
  };

  if (inflight.has(bot)) {
    log("IDLE", "none", "already-fishing-on-this-client");
    return { result: "already-fishing", logs, activations: 0 };
  }

  let bound: BobberEntity | undefined;
  let reeled = false;
  let activations = 0;
  let cancelReason: string | undefined;
  const preexisting = listBobberIds(bot.entities);
  const typeId = bobberTypeId(bot);
  const particles = particleMode(bot);
  const metadataKeys = bot.registry?.entitiesByName?.fishing_bobber?.metadataKeys;
  const spawnInfo = new Map<number, BobberEntity>();
  const castAt = now();

  const handle: { phase: FishCyclePhase; cancel: (reason: string) => void } = {
    phase: "IDLE",
    cancel: (reason: string) => {
      cancelReason = reason;
    },
  };
  inflight.set(bot, handle);

  const activate = (why: string, next: FishCyclePhase) => {
    bot.activateItem();
    activations += 1;
    handle.phase = next;
    log(next, next === "CAST" ? "cast" : "reel", why);
  };

  const collectFresh = (): BobberEntity[] => {
    const byId = new Map<number, BobberEntity>();
    for (const entity of Object.values(bot.entities)) {
      if (!entity) continue;
      if (!isBobberName(`${entity.name ?? ""} ${entity.displayName ?? ""}`)) continue;
      if (preexisting.includes(entity.id)) continue;
      const extra = spawnInfo.get(entity.id);
      byId.set(entity.id, {
        ...entity,
        ownerEntityId: extra?.ownerEntityId ?? entity.ownerEntityId,
        position: entity.position ?? extra?.position,
      });
    }
    for (const [id, extra] of spawnInfo) {
      if (preexisting.includes(id) || byId.has(id)) continue;
      byId.set(id, extra);
    }
    return [...byId.values()];
  };

  const tryBind = (allowNearestFallback: boolean, via: string) => {
    if (bound || reeled) return;
    const chosen = chooseBoundBobber(collectFresh(), bot.entity ?? {}, { allowNearestFallback });
    if (!chosen) return;
    bound = chosen;
    const cmd = rodCommandForEvent({
      phase: handle.phase,
      event: "bound",
      hasOwnBobber: true,
      alreadyReeled: reeled,
    });
    handle.phase = cmd.phase;
    log(handle.phase, via, `bobberId=${bound.id}`);
  };

  const reelOwnBite = (why: string) => {
    const cmd = rodCommandForEvent({
      phase: "WAIT_FOR_OWN_BITE",
      event: "own-bite",
      hasOwnBobber: true,
      alreadyReeled: reeled,
    });
    if (cmd.rod === "reel") {
      reeled = true;
      activate(why, "REEL");
    }
  };

  const onSpawn = (...args: unknown[]) => {
    const packet = args[0] as
      | {
          type?: number | string;
          entityId?: number;
          objectData?: number;
          data?: number;
          x?: number;
          y?: number;
          z?: number;
        }
      | undefined;
    if (!packet || packet.entityId == null) return;
    if (
      !shouldBindSpawnedBobber({
        taskActive: handle.phase === "CAST" || handle.phase === "WAIT_FOR_OWN_BITE",
        alreadyBound: Boolean(bound),
        packetType: packet.type ?? -1,
        bobberTypeId: typeId,
        entityId: packet.entityId,
        preexistingIds: preexisting,
      })
    ) {
      return;
    }
    const live = bot.entities[packet.entityId];
    const ownerEntityId = spawnOwnerEntityId(packet);
    spawnInfo.set(packet.entityId, {
      id: packet.entityId,
      name: live?.name ?? "fishing_bobber",
      displayName: live?.displayName,
      position:
        live?.position ??
        (packet.x != null ? { x: packet.x, y: packet.y ?? 0, z: packet.z ?? 0 } : undefined),
      ownerEntityId,
      ownerUUID: live?.ownerUUID,
      owner: live?.owner,
    });
    tryBind(false, "bind");
  };

  const onParticles = (...args: unknown[]) => {
    if (!bound || reeled || (handle.phase !== "WAIT_FOR_OWN_BITE" && handle.phase !== "CAST")) return;
    const packet = args[0] as ParticlePacket | undefined;
    const pos = bot.entities[bound.id]?.position ?? bound.position;
    if (!packet || pos == null) return;
    if (
      !isOwnBiteParticle({
        boundPos: pos,
        boundId: bound.id,
        packet,
        updatedParticlesPacket: particles.updated,
        fishingOrBubbleId: particles.fishingOrBubbleId,
      })
    ) {
      return;
    }
    reelOwnBite("own-particle-bite");
  };

  const onMetadata = (...args: unknown[]) => {
    if (!bound || reeled || (handle.phase !== "WAIT_FOR_OWN_BITE" && handle.phase !== "CAST")) return;
    const packet = args[0] as { entityId?: number; metadata?: Array<{ key?: number; value?: unknown }> } | undefined;
    if (!packet) return;
    if (!isOwnBobberBiting({ boundId: bound.id, packet, metadataKeys })) return;
    reelOwnBite("own-biting-metadata");
  };

  const onDestroy = (...args: unknown[]) => {
    if (!bound) return;
    const packet = args[0] as { entityIds?: number[] } | undefined;
    if (!packet?.entityIds?.includes(bound.id)) return;
    const cmd = rodCommandForEvent({
      phase: handle.phase,
      event: "bobber-lost",
      hasOwnBobber: false,
      alreadyReeled: reeled,
    });
    handle.phase = cmd.phase;
    bound = undefined;
    log(handle.phase, "bobber-lost", "entity_destroy of bound bobber");
  };

  bot._client.on("spawn_entity", onSpawn);
  bot._client.on("world_particles", onParticles);
  bot._client.on("entity_metadata", onMetadata);
  bot._client.on("entity_destroy", onDestroy);

  try {
    const start = rodCommandForEvent({
      phase: "IDLE",
      event: "cast-requested",
      hasOwnBobber: false,
      alreadyReeled: false,
    });
    activate("cast", start.phase);
    const bindDeadline = now() + MF_FISH_BOBBER_BIND_MS;
    while (!bound && now() < bindDeadline) {
      if (opts.signal?.aborted || cancelReason) {
        return { result: "cancelled", logs, activations, bobberId: undefined };
      }
      const elapsed = now() - castAt;
      tryBind(elapsed >= MF_FISH_COLLECT_MS || now() >= bindDeadline - 50, "bind-scan");
      if (bound) break;
      await wait(50);
    }
    if (!bound) {
      log("VERIFY_OWN_CATCH", "no-bobber", "no own fishing_bobber after own cast");
      return { result: "no-bobber", logs, activations };
    }

    const waitDeadline = now() + Math.max(1_000, opts.timeoutMs);
    while (handle.phase === "WAIT_FOR_OWN_BITE" && !reeled && now() < waitDeadline) {
      if (opts.signal?.aborted || cancelReason) break;
      const hook: BobberEntity | undefined = bound;
      if (!hook) break;
      const live: BobberEntity | undefined = bot.entities[hook.id];
      if (live?.position) bound = { ...hook, ...live };
      await wait(50);
    }

    if (opts.signal?.aborted || cancelReason) {
      if (!reeled && bound && bot.entities[bound.id]) activate("cancel-retrieve", "REEL");
      return { result: "cancelled", logs, activations, bobberId: bound?.id };
    }
    if (reeled) {
      handle.phase = "VERIFY_OWN_CATCH";
      log(handle.phase, "verify", "reeled-on-own-bite");
      return { result: "reeled", logs, activations, bobberId: bound?.id };
    }
    if (!reeled && bound && bot.entities[bound.id]) activate("timeout-retrieve", "REEL");
    handle.phase = "VERIFY_OWN_CATCH";
    log(handle.phase, "timeout", "no own bite particle or biting metadata within budget");
    return { result: "timeout", logs, activations, bobberId: bound?.id };
  } finally {
    detach(bot._client, "spawn_entity", onSpawn);
    detach(bot._client, "world_particles", onParticles);
    detach(bot._client, "entity_metadata", onMetadata);
    detach(bot._client, "entity_destroy", onDestroy);
    inflight.delete(bot);
  }
}
