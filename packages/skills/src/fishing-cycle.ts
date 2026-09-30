/**
 * Owner-aware fishing cycle (unit-testable concurrency model).
 *
 * Do NOT replace with stock bot.fish() for multi-bot concurrency unless live-proven.
 * Status: IMPLEMENTED / LIVE UNVERIFIED in this public cloud branch.
 */

export type Vec3 = { x: number; y: number; z: number };

export type FishingBotId = string;

export type BobberEntity = {
  id: number;
  ownerBotId: FishingBotId;
  position: Vec3;
};

export type ParticleEvent = {
  name: string;
  position: Vec3;
  /** If present, particle is attributed to a bobber entity id. */
  entityId?: number;
};

export type BiteMetadata = {
  entityId: number;
  /** Bot that owns the bobber entity. */
  ownerBotId?: FishingBotId;
};

export type CatchRecord = {
  botId: FishingBotId;
  itemName: string;
  count: number;
  /** Chest contents before deposit — used so old chest items are not counted as new catch. */
  chestBefore?: Array<{ name: string; count: number }>;
  chestAfter?: Array<{ name: string; count: number }>;
};

export type FishingBotState = {
  botId: FishingBotId;
  casting: boolean;
  bobber?: BobberEntity;
  rodEquipped: boolean;
  lastCastAt?: number;
  timedOut: boolean;
  cancelled: boolean;
  catches: CatchRecord[];
};

export class FishingCycleCoordinator {
  private readonly bots = new Map<FishingBotId, FishingBotState>();
  private readonly bobbers = new Map<number, BobberEntity>();

  ensure(botId: FishingBotId): FishingBotState {
    let state = this.bots.get(botId);
    if (!state) {
      state = {
        botId,
        casting: false,
        rodEquipped: false,
        timedOut: false,
        cancelled: false,
        catches: [],
      };
      this.bots.set(botId, state);
    }
    return state;
  }

  get(botId: FishingBotId): FishingBotState | undefined {
    return this.bots.get(botId);
  }

  /** Cast: equipping/casting must not toggle another bot's rod. */
  cast(botId: FishingBotId, bobber: BobberEntity, now = Date.now()): { ok: true } | { ok: false; reason: string } {
    const state = this.ensure(botId);
    if (state.cancelled) return { ok: false, reason: "cancelled" };
    if (state.casting && state.bobber) {
      // Duplicate cast must NOT toggle/reel the existing rod.
      return { ok: false, reason: "already_casting" };
    }
    if (bobber.ownerBotId !== botId) {
      return { ok: false, reason: "bobber_owner_mismatch" };
    }
    state.casting = true;
    state.rodEquipped = true;
    state.bobber = bobber;
    state.lastCastAt = now;
    state.timedOut = false;
    this.bobbers.set(bobber.id, bobber);
    return { ok: true };
  }

  /** Particle belonging to a foreign bobber must be ignored. */
  shouldRespondToParticle(botId: FishingBotId, particle: ParticleEvent): boolean {
    const state = this.bots.get(botId);
    if (!state?.bobber || state.cancelled || state.timedOut) return false;
    if (particle.entityId !== undefined) {
      return particle.entityId === state.bobber.id;
    }
    // Without entity id, require proximity to own bobber only.
    const dx = particle.position.x - state.bobber.position.x;
    const dy = particle.position.y - state.bobber.position.y;
    const dz = particle.position.z - state.bobber.position.z;
    return Math.hypot(dx, dy, dz) <= 1.5;
  }

  /** Foreign biting metadata must be ignored. */
  shouldRespondToBite(botId: FishingBotId, bite: BiteMetadata): boolean {
    const state = this.bots.get(botId);
    if (!state?.bobber || state.cancelled || state.timedOut) return false;
    if (bite.ownerBotId && bite.ownerBotId !== botId) return false;
    return bite.entityId === state.bobber.id;
  }

  reel(botId: FishingBotId, catchItem?: { name: string; count: number }): CatchRecord | undefined {
    const state = this.bots.get(botId);
    if (!state?.casting || !state.bobber) return undefined;
    if (state.bobber) this.bobbers.delete(state.bobber.id);
    state.casting = false;
    state.bobber = undefined;
    if (!catchItem) return undefined;
    const record: CatchRecord = { botId, itemName: catchItem.name, count: catchItem.count };
    state.catches.push(record);
    return record;
  }

  /** Timeout affects only that bot. */
  timeout(botId: FishingBotId): void {
    const state = this.bots.get(botId);
    if (!state) return;
    state.timedOut = true;
    if (state.bobber) this.bobbers.delete(state.bobber.id);
    state.casting = false;
    state.bobber = undefined;
  }

  /** Cancel affects only that bot. */
  cancel(botId: FishingBotId): void {
    const state = this.bots.get(botId);
    if (!state) return;
    state.cancelled = true;
    if (state.bobber) this.bobbers.delete(state.bobber.id);
    state.casting = false;
    state.bobber = undefined;
  }

  /**
   * Storage isolation: only count items that increased vs chestBefore.
   * Old chest contents are not counted as a new catch.
   */
  countNewCatchFromChest(record: CatchRecord): number {
    const before = new Map((record.chestBefore ?? []).map((i) => [i.name, i.count]));
    const after = record.chestAfter ?? [];
    let gained = 0;
    for (const item of after) {
      if (item.name !== record.itemName) continue;
      const prev = before.get(item.name) ?? 0;
      gained += Math.max(0, item.count - prev);
    }
    return gained;
  }

  activeBobberIds(): number[] {
    return [...this.bobbers.keys()];
  }
}
