export type ReservationPurpose = "construction" | "tool_crafting" | "food_emergency" | "workstation_creation";

export type ResourceReservation = {
  id: string;
  ownerId: string;
  purpose: ReservationPurpose;
  item: string;
  quantity: number;
  createdAt: number;
  expiresAt: number;
};

export type TaskClaim = {
  id: string;
  kind: string;
  key: string;
  ownerId: string;
  createdAt: number;
  expiresAt: number;
};

export class ReservationBook {
  private readonly holds = new Map<string, ResourceReservation>();

  reserve(
    ownerId: string,
    purpose: ReservationPurpose,
    item: string,
    quantity: number,
    ttlMs = 180_000,
    now = Date.now(),
  ): ResourceReservation {
    this.expire(now);
    const hold: ResourceReservation = {
      id: crypto.randomUUID(),
      ownerId,
      purpose,
      item,
      quantity,
      createdAt: now,
      expiresAt: now + ttlMs,
    };
    this.holds.set(hold.id, hold);
    return hold;
  }

  reservedOf(item: string, now = Date.now()): number {
    this.expire(now);
    return [...this.holds.values()].filter((hold) => hold.item === item).reduce((sum, hold) => sum + hold.quantity, 0);
  }

  available(item: string, physical: number, now = Date.now()): number {
    return Math.max(0, physical - this.reservedOf(item, now));
  }

  release(id: string): boolean {
    return this.holds.delete(id);
  }

  releaseOwner(ownerId: string): number {
    let count = 0;
    for (const [id, hold] of this.holds) {
      if (hold.ownerId === ownerId) {
        this.holds.delete(id);
        count += 1;
      }
    }
    return count;
  }

  releasePurpose(purpose: ReservationPurpose): number {
    let count = 0;
    for (const [id, hold] of this.holds) {
      if (hold.purpose === purpose) {
        this.holds.delete(id);
        count += 1;
      }
    }
    return count;
  }

  list(now = Date.now()): ResourceReservation[] {
    this.expire(now);
    return [...this.holds.values()];
  }

  expire(now = Date.now()): number {
    let count = 0;
    for (const [id, hold] of this.holds) {
      if (hold.expiresAt <= now) {
        this.holds.delete(id);
        count += 1;
      }
    }
    return count;
  }
}

export class ClaimBoard {
  private readonly claims = new Map<string, TaskClaim>();
  private readonly acquisitionIds = new WeakMap<TaskClaim, string>();

  tryClaim(kind: string, key: string, ownerId: string, ttlMs = 90_000, now = Date.now()): boolean {
    this.expire(now);
    const id = claimId(kind, key);
    const existing = this.claims.get(id);
    if (existing && existing.ownerId !== ownerId) return false;
    const claim = { id, kind, key, ownerId, createdAt: existing?.createdAt ?? now, expiresAt: now + ttlMs };
    this.acquisitionIds.set(claim, crypto.randomUUID());
    this.claims.set(id, claim);
    return true;
  }

  /** Every acquisition, including a same-owner refresh, gets a new identity. */
  acquire(kind: string, key: string, ownerId: string, ttlMs = 90_000, now = Date.now()): string | undefined {
    if (!this.tryClaim(kind, key, ownerId, ttlMs, now)) return undefined;
    return this.acquisitionIds.get(this.claims.get(claimId(kind, key))!);
  }

  releaseAcquisition(kind: string, key: string, ownerId: string, acquisitionId: string): boolean {
    const id = claimId(kind, key);
    const current = this.claims.get(id);
    if (!current || current.ownerId !== ownerId || this.acquisitionIds.get(current) !== acquisitionId) return false;
    this.claims.delete(id);
    return true;
  }

  ownerOf(kind: string, key: string, now = Date.now()): string | undefined {
    this.expire(now);
    return this.claims.get(claimId(kind, key))?.ownerId;
  }

  /**
   * The owner argument is required: a claim can only be released by the citizen that holds it (use releaseOwner to
   * drop all of one citizen's claims). `undefined` is accepted only so callers can pass an optional `ctx.citizenId`
   * straight through; it matches no claim (claims always have an owner), so it can never free someone else's claim.
   */
  release(kind: string, key: string, ownerId: string | undefined): boolean {
    const id = claimId(kind, key);
    const existing = this.claims.get(id);
    if (!existing) return false;
    if (ownerId === undefined || existing.ownerId !== ownerId) return false;
    this.claims.delete(id);
    return true;
  }

  releaseOwner(ownerId: string): number {
    let count = 0;
    for (const [id, claim] of this.claims) {
      if (claim.ownerId === ownerId) {
        this.claims.delete(id);
        count += 1;
      }
    }
    return count;
  }

  expire(now = Date.now()): number {
    let count = 0;
    for (const [id, claim] of this.claims) {
      if (claim.expiresAt <= now) {
        this.claims.delete(id);
        count += 1;
      }
    }
    return count;
  }
}

export function cellClaimKey(x: number, y: number, z: number): string {
  return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
}

function claimId(kind: string, key: string): string {
  return `${kind}:${key}`;
}
