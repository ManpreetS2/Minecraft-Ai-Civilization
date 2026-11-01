/**
 * Mission 005 — controlled fake Mineflayer surface for production-path tests.
 * Distinguishes placement *requests* from confirmed world updates.
 * Never treat harness success as physical Minecraft proof.
 */
import { fail, ok, type Vec3 } from "@civ/shared";
import type { SkillContext } from "@civ/skills";
import { Vec3 as Vec3Class } from "vec3";

export type HarnessBlock = {
  name: string;
  position: Vec3;
  properties?: Record<string, string>;
};

export type ProductionHarnessOptions = {
  origin?: Vec3;
  inventory?: Array<{ name: string; count: number }>;
  /** When true, bot.placeBlock resolves but does not mutate world. */
  silentPlace?: boolean;
  /** When true, equip throws. */
  equipFails?: boolean;
  /** Force no solid neighbors for place attempts. */
  noNeighbors?: boolean;
};

export type ProductionHarness = {
  ctx: SkillContext;
  world: Map<string, HarnessBlock>;
  placeRequests: Array<{ ref: string; face: string; dest: string }>;
  equipRequests: string[];
  setBlock: (pos: Vec3, name: string, properties?: Record<string, string>) => void;
  getBlock: (pos: Vec3) => string | undefined;
  getBlockProperties: (pos: Vec3) => Record<string, string> | undefined;
  seedPad: (origin: Vec3, width: number, depth: number, y?: number) => void;
};

function key(pos: { x: number; y: number; z: number }): string {
  return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

export function createProductionHarness(opts: ProductionHarnessOptions = {}): ProductionHarness {
  const origin = opts.origin ?? { x: 100, y: 70, z: 100 };
  const world = new Map<string, HarnessBlock>();
  const placeRequests: Array<{ ref: string; face: string; dest: string }> = [];
  const equipRequests: string[] = [];
  const inventory = [...(opts.inventory ?? [])];

  const setBlock = (pos: Vec3, name: string, properties?: Record<string, string>) => {
    world.set(key(pos), {
      name,
      position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
      properties,
    });
  };

  const getBlock = (pos: Vec3) => world.get(key(pos))?.name;
  const getBlockProperties = (pos: Vec3) => world.get(key(pos))?.properties;

  const seedPad = (padOrigin: Vec3, width: number, depth: number, y = padOrigin.y) => {
    for (let dx = -2; dx < width + 2; dx += 1) {
      for (let dz = -2; dz < depth + 2; dz += 1) {
        setBlock({ x: padOrigin.x + dx, y: y - 1, z: padOrigin.z + dz }, "grass_block");
        for (let dy = 0; dy <= 5; dy += 1) {
          setBlock({ x: padOrigin.x + dx, y: y + dy, z: padOrigin.z + dz }, "air");
        }
      }
    }
  };

  seedPad(origin, 12, 12);

  const bot = {
    entity: { position: { x: origin.x + 0.5, y: origin.y, z: origin.z + 0.5 } },
    registry: {
      blocksByName: {
        oak_door: { id: 64 },
        spruce_door: { id: 65 },
        birch_door: { id: 66 },
      },
    },
    inventory: {
      items: () => inventory.map((i) => ({ ...i })),
    },
    blockAt(pos: { x: number; y: number; z: number }) {
      const found = world.get(key(pos));
      if (!found) return null;
      return {
        name: found.name,
        position: new Vec3Class(found.position.x, found.position.y, found.position.z),
        getProperties: () => found.properties ?? {},
      };
    },
    findBlocks: () => [] as Array<{ x: number; y: number; z: number }>,
    lookAt: async () => undefined,
    async equip(item: { name: string }, _dest: string) {
      equipRequests.push(item.name);
      if (opts.equipFails) throw new Error("equip_failed");
    },
    async placeBlock(ref: { name: string; position: { x: number; y: number; z: number } }, faceVector: { x: number; y: number; z: number }) {
      const dest = {
        x: Math.floor(ref.position.x + faceVector.x),
        y: Math.floor(ref.position.y + faceVector.y),
        z: Math.floor(ref.position.z + faceVector.z),
      };
      placeRequests.push({
        ref: `${ref.name}@${key(ref.position)}`,
        face: `${faceVector.x},${faceVector.y},${faceVector.z}`,
        dest: key(dest),
      });
      if (opts.silentPlace) return; // request recorded, world unchanged
      if (opts.noNeighbors) throw new Error("no supporting neighbor");

      // Consume one inventory item matching held name (approximate).
      const held = equipRequests[equipRequests.length - 1];
      const slot = inventory.find((i) => i.name === held && i.count > 0);
      if (!slot) throw new Error("ITEM_NOT_FOUND");
      slot.count -= 1;

      setBlock(dest, held!);
      if (held?.endsWith("_door")) {
        setBlock(
          { x: dest.x, y: dest.y + 1, z: dest.z },
          held,
          { facing: "south", half: "upper", hinge: "left", open: "false", powered: "false" },
        );
        world.get(key(dest))!.properties = {
          facing: "south",
          half: "lower",
          hinge: "left",
          open: "false",
          powered: "false",
        };
      }
      if (held?.endsWith("_bed")) {
        setBlock({ x: dest.x - 1, y: dest.y, z: dest.z }, held, { facing: "west", part: "head", occupied: "false" });
        world.get(key(dest))!.properties = { facing: "west", part: "foot", occupied: "false" };
      }
    },
    async dig() {
      return undefined;
    },
  };

  const ctx = {
    citizenId: "citizen_atlas",
    bot,
    body: {
      position: () => ({ x: origin.x, y: origin.y, z: origin.z }),
      nearbyEntities: () => [],
    },
  } as unknown as SkillContext;

  return { ctx, world, placeRequests, equipRequests, setBlock, getBlock, getBlockProperties, seedPad };
}

export function stubNavOk(): Record<string, unknown> {
  const done = (target: Vec3) => Promise.resolve(ok({ position: target, distance: 1 }, 1));
  return {
    name: "mission005-test-nav",
    navigateToPosition: (_b: unknown, target: Vec3) => done(target),
    navigateNear: (_b: unknown, target: Vec3) => done(target),
    navigateToInteractWithBlock: (_b: unknown, block: Vec3) => done(block),
    navigateToPlaceBlock: (_b: unknown, target: Vec3) => done(target),
    followEntity: async () => ok({ username: "x", position: { x: 0, y: 0, z: 0 } }, 1),
    escapeFrom: async (_b: unknown, from: Vec3) => ok({ position: from, distance: 1 }, 1),
    probeReachability: () => ({ reachable: true, cost: 1 }),
    stop: () => undefined,
  };
}

export function stubNavFail(code = "PATH_BLOCKED"): Record<string, unknown> {
  const bad = () => Promise.resolve(fail(code as "PATH_BLOCKED", "nav failed in harness", 1, true));
  return {
    ...stubNavOk(),
    navigateToPosition: bad,
    navigateNear: bad,
    navigateToInteractWithBlock: bad,
    navigateToPlaceBlock: bad,
  };
}
