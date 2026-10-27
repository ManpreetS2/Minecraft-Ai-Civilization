import type { Bot } from "mineflayer";
import { Vec3 as Vec3Class } from "vec3";
import type { Vec3 } from "@civ/shared";
import { cellKey } from "./path-recovery.js";
import { isVerifiedStanding } from "./interaction.js";

export type ObservedBlock = {
  x: number;
  y: number;
  z: number;
  name: string;
  boundingBox: string;
  open?: boolean;
  observedAt: number;
};

export type BlockedEdge = {
  from: string;
  to: string;
  reason: string;
  obstacle: string;
  until: number;
};

const MAX_OBSERVATIONS = 256;
const EDGE_TTL_MS = 20_000;
const DEFAULT_RADIUS = 4;

function sample(bot: Bot, x: number, y: number, z: number) {
  return bot.blockAt(new Vec3Class(Math.floor(x), Math.floor(y), Math.floor(z)));
}

export function edgeKey(from: Vec3, to: Vec3): string {
  return `${cellKey({ x: Math.floor(from.x), y: Math.floor(from.y), z: Math.floor(from.z) })}>${cellKey({
    x: Math.floor(to.x),
    y: Math.floor(to.y),
    z: Math.floor(to.z),
  })}`;
}

export function isTreePart(name: string | undefined): boolean {
  if (!name) return false;
  return name.endsWith("_log") || name.endsWith("_stem") || name.endsWith("_leaves") || name === "oak_wood";
}

/** Bounded map of blocks the bot has actually seen. Never filled from world files. */
export class LocalTerrainMemory {
  private readonly cells = new Map<string, ObservedBlock>();
  private readonly edges = new Map<string, BlockedEdge>();

  observeVisible(bot: Bot, radius = DEFAULT_RADIUS, now = Date.now()): ObservedBlock[] {
    const origin = bot.entity?.position;
    if (!origin) return [];
    const ox = Math.floor(origin.x);
    const oy = Math.floor(origin.y);
    const oz = Math.floor(origin.z);
    const seen: ObservedBlock[] = [];
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -1; dy <= 2; dy += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          const block = sample(bot, ox + dx, oy + dy, oz + dz);
          if (!block) continue;
          const record: ObservedBlock = {
            x: ox + dx,
            y: oy + dy,
            z: oz + dz,
            name: block.name,
            boundingBox: block.boundingBox,
            open: (block as { getProperties?: () => { open?: boolean } }).getProperties?.()?.open,
            observedAt: now,
          };
          this.record(record);
          seen.push(record);
        }
      }
    }
    this.trim(now);
    return seen;
  }

  record(block: ObservedBlock): void {
    const key = cellKey(block);
    const previous = this.cells.get(key);
    if (previous && previous.name !== block.name) {
      this.clearEdgesTouching(block);
    }
    this.cells.set(key, block);
  }

  get(pos: Vec3): ObservedBlock | undefined {
    return this.cells.get(cellKey({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }));
  }

  markEdgeBlocked(from: Vec3, to: Vec3, reason: string, obstacle: string, now = Date.now(), ttlMs = EDGE_TTL_MS): void {
    const key = edgeKey(from, to);
    this.edges.set(key, { from: cellKey(from), to: cellKey(to), reason, obstacle, until: now + ttlMs });
  }

  isEdgeBlocked(from: Vec3, to: Vec3, now = Date.now()): boolean {
    const key = edgeKey(from, to);
    const edge = this.edges.get(key);
    if (!edge) return false;
    if (edge.until <= now) {
      this.edges.delete(key);
      return false;
    }
    return true;
  }

  clearEdgesTouching(pos: Vec3): void {
    const key = cellKey({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
    for (const [edgeKeyValue, edge] of this.edges) {
      if (edge.from === key || edge.to === key) this.edges.delete(edgeKeyValue);
    }
  }

  invalidateAt(pos: Vec3): void {
    const key = cellKey({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
    this.cells.delete(key);
    this.clearEdgesTouching(pos);
  }

  blockedCount(now = Date.now()): number {
    for (const [key, edge] of this.edges) {
      if (edge.until <= now) this.edges.delete(key);
    }
    return this.edges.size;
  }

  treeCells(): ObservedBlock[] {
    return [...this.cells.values()].filter((cell) => isTreePart(cell.name));
  }

  isDestinationBlocked(pos: Vec3, now = Date.now()): boolean {
    const key = cellKey({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
    for (const [edgeKeyValue, edge] of this.edges) {
      if (edge.until <= now) {
        this.edges.delete(edgeKeyValue);
        continue;
      }
      if (edge.to === key) return true;
    }
    return false;
  }

  aroundStanding(bot: Bot, target: Vec3, radius = 3): Vec3[] {
    const origin = bot.entity?.position;
    const tx = Math.floor(target.x);
    const ty = Math.floor(target.y);
    const tz = Math.floor(target.z);
    const spots: Vec3[] = [];
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const pos = { x: tx + dx, y: ty + dy, z: tz + dz };
          const observed = this.get(pos);
          if (observed && isTreePart(observed.name)) continue;
          if (!isVerifiedStanding(bot, pos, origin ? { fromY: origin.y, maxDrop: 1 } : undefined)) continue;
          if (origin && this.isEdgeBlocked(origin, pos)) continue;
          if (this.isDestinationBlocked(pos)) continue;
          spots.push(pos);
        }
      }
    }
    spots.sort((a, b) => {
      const da = (a.x - tx) ** 2 + (a.y - ty) ** 2 + (a.z - tz) ** 2;
      const db = (b.x - tx) ** 2 + (b.y - ty) ** 2 + (b.z - tz) ** 2;
      return da - db;
    });
    return spots;
  }

  private trim(now: number): void {
    for (const [key, edge] of this.edges) {
      if (edge.until <= now) this.edges.delete(key);
    }
    if (this.cells.size <= MAX_OBSERVATIONS) return;
    const ordered = [...this.cells.entries()].sort((a, b) => a[1].observedAt - b[1].observedAt);
    for (const [key] of ordered.slice(0, this.cells.size - MAX_OBSERVATIONS)) {
      this.cells.delete(key);
    }
  }
}

const memories = new WeakMap<Bot, LocalTerrainMemory>();

export function terrainMemory(bot: Bot): LocalTerrainMemory {
  let memory = memories.get(bot);
  if (!memory) {
    memory = new LocalTerrainMemory();
    memories.set(bot, memory);
  }
  return memory;
}
