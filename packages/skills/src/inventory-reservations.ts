export type InventoryHold = {
  id: string;
  item: string;
  count: number;
  purpose: string;
  ownerId?: string;
  createdAt: number;
  expiresAt: number;
};

export class ItemReservationBook {
  private readonly holds = new Map<string, InventoryHold>();

  reserve(args: {
    reservationId?: string;
    item: string;
    count: number;
    purpose: string;
    ownerId?: string;
    ttlMs?: number;
    now?: number;
  }): InventoryHold {
    const now = args.now ?? Date.now();
    this.expire(now);
    const hold: InventoryHold = {
      id: args.reservationId ?? crypto.randomUUID(),
      item: args.item,
      count: Math.max(0, Math.floor(args.count)),
      purpose: args.purpose,
      ownerId: args.ownerId,
      createdAt: now,
      expiresAt: now + (args.ttlMs ?? 180_000),
    };
    this.holds.set(hold.id, hold);
    return hold;
  }

  release(reservationId: string): boolean {
    return this.holds.delete(reservationId);
  }

  reservedOf(item: string, now = Date.now()): number {
    this.expire(now);
    return [...this.holds.values()]
      .filter((hold) => hold.item === item)
      .reduce((sum, hold) => sum + hold.count, 0);
  }

  list(now = Date.now()): InventoryHold[] {
    this.expire(now);
    return [...this.holds.values()];
  }

  clear(): void {
    this.holds.clear();
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
