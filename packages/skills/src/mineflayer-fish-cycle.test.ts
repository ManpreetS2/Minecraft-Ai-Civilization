import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  chooseBoundBobber,
  isOwnBiteParticle,
  isOwnBobberBiting,
  rodCommandForEvent,
  runMineflayerFishCycle,
  shouldBindSpawnedBobber,
  type FishableBot,
  type Vec3Like,
} from "./mineflayer-fish-cycle.js";

const BITING_KEYS = [
  "shared_flags",
  "air_supply",
  "custom_name",
  "custom_name_visible",
  "silent",
  "no_gravity",
  "pose",
  "ticks_frozen",
  "hooked_entity",
  "biting",
];

type FakeBot = FishableBot & { activations: string[]; client: EventEmitter };

function makeBot(username: string, pos: Vec3Like, uuid: string, entityId: number): FakeBot {
  const client = new EventEmitter();
  const activations: string[] = [];
  return {
    username,
    entity: { id: entityId, uuid, position: pos },
    entities: {},
    activateItem: () => {
      activations.push(username);
    },
    supportFeature: () => true,
    registry: {
      supportFeature: () => true,
      entitiesByName: { fishing_bobber: { id: 156, metadataKeys: BITING_KEYS } },
      particlesByName: { fishing: { id: 31 }, bubble: { id: 3 } },
    },
    _client: client,
    activations,
    client,
  };
}

function putBobber(
  bot: FakeBot,
  id: number,
  pos: Vec3Like,
  owner: { uuid: string; entityId: number },
): void {
  bot.entities[id] = {
    id,
    name: "fishing_bobber",
    position: pos,
    ownerUUID: owner.uuid,
    ownerEntityId: owner.entityId,
  };
}

function spawnSeen(
  viewer: FakeBot,
  id: number,
  pos: Vec3Like,
  owner: { uuid: string; entityId: number },
): void {
  putBobber(viewer, id, pos, owner);
  viewer.client.emit("spawn_entity", {
    type: 156,
    entityId: id,
    objectData: owner.entityId,
    x: pos.x,
    y: pos.y,
    z: pos.z,
  });
}

/** Both clients see both nearby hooks, matching a crowded pond. */
function spawnCross(
  kai: FakeBot,
  atlas: FakeBot,
  id: number,
  pos: Vec3Like,
  owner: { uuid: string; entityId: number },
): void {
  spawnSeen(kai, id, pos, owner);
  spawnSeen(atlas, id, pos, owner);
}

function biteAt(bot: FakeBot, pos: Vec3Like): void {
  bot.client.emit("world_particles", {
    particle: { type: "bubble" },
    amount: 6,
    x: pos.x,
    y: pos.y,
    z: pos.z,
  });
}

describe("upstream first-bobber vs owner-aware bind", () => {
  it("refuses to bind a bobber that already existed before this bot cast", () => {
    expect(
      shouldBindSpawnedBobber({
        taskActive: true,
        alreadyBound: false,
        packetType: 156,
        bobberTypeId: 156,
        entityId: 11,
        preexistingIds: [11],
      }),
    ).toBe(false);
    expect(
      shouldBindSpawnedBobber({
        taskActive: true,
        alreadyBound: false,
        packetType: 156,
        bobberTypeId: 156,
        entityId: 12,
        preexistingIds: [11],
      }),
    ).toBe(true);
  });

  it("prefers the bobber whose thrower entity id matches this bot", () => {
    const chosen = chooseBoundBobber(
      [
        { id: 11, name: "fishing_bobber", position: { x: -1045, y: 62, z: 981 }, ownerEntityId: 2 },
        { id: 10, name: "fishing_bobber", position: { x: -1044, y: 62, z: 980 }, ownerEntityId: 1 },
      ],
      { id: 1, uuid: "kai", position: { x: -1042.5, y: 63, z: 980.5 } },
    );
    expect(chosen?.id).toBe(10);
  });

  it("does not fall back to a known-foreign hook when this bot's bobber is missing", () => {
    expect(
      chooseBoundBobber(
        [{ id: 11, name: "fishing_bobber", position: { x: -1045, y: 62, z: 981 }, ownerEntityId: 2 }],
        { id: 1, uuid: "kai", position: { x: -1042.5, y: 63, z: 980.5 } },
        { allowNearestFallback: true },
      ),
    ).toBeUndefined();
  });

  it("does not treat a particle on the other bobber as this bot's bite", () => {
    expect(
      isOwnBiteParticle({
        boundPos: { x: -1044, y: 62, z: 980 },
        boundId: 10,
        packet: { particle: { type: "bubble" }, amount: 6, x: -1045, y: 62, z: 981 },
        updatedParticlesPacket: true,
      }),
    ).toBe(false);
    expect(
      isOwnBiteParticle({
        boundPos: { x: -1045, y: 62, z: 981 },
        boundId: 11,
        packet: { particle: { type: "bubble" }, amount: 6, x: -1045, y: 62, z: 981 },
        updatedParticlesPacket: true,
      }),
    ).toBe(true);
  });

  it("treats 1.21 biting metadata as a bite only on the bound bobber", () => {
    expect(
      isOwnBobberBiting({
        boundId: 10,
        packet: { entityId: 11, metadata: [{ key: 9, value: true }] },
        metadataKeys: BITING_KEYS,
      }),
    ).toBe(false);
    expect(
      isOwnBobberBiting({
        boundId: 10,
        packet: { entityId: 10, metadata: [{ key: 9, value: true }] },
        metadataKeys: BITING_KEYS,
      }),
    ).toBe(true);
  });
});

describe("independent rod state machine", () => {
  it("never reels because the other bot bit or cast", () => {
    expect(
      rodCommandForEvent({
        phase: "WAIT_FOR_OWN_BITE",
        event: "other-bite",
        hasOwnBobber: true,
        alreadyReeled: false,
      }),
    ).toEqual({ phase: "WAIT_FOR_OWN_BITE", rod: "none", reason: "foreign-bobber-ignored" });
    expect(
      rodCommandForEvent({
        phase: "WAIT_FOR_OWN_BITE",
        event: "duplicate-cast",
        hasOwnBobber: true,
        alreadyReeled: false,
      }),
    ).toEqual({ phase: "WAIT_FOR_OWN_BITE", rod: "none", reason: "duplicate-cast-ignored" });
  });

  it("reels once on own bite and does not toggle after bobber loss", () => {
    expect(
      rodCommandForEvent({
        phase: "WAIT_FOR_OWN_BITE",
        event: "own-bite",
        hasOwnBobber: true,
        alreadyReeled: false,
      }).rod,
    ).toBe("reel");
    expect(
      rodCommandForEvent({
        phase: "WAIT_FOR_OWN_BITE",
        event: "bobber-lost",
        hasOwnBobber: false,
        alreadyReeled: false,
      }).rod,
    ).toBe("none");
  });
});

describe("two independent mineflayer clients", () => {
  const kaiPos = { x: -1042.5, y: 63, z: 980.5 };
  const atlasPos = { x: -1043.5, y: 63, z: 981.5 };
  const kaiHook = { x: -1044, y: 62, z: 980 };
  const atlasHook = { x: -1045, y: 62, z: 981 };

  it("lets overlapping casts bind separate bobbers even if the other hook arrives first", async () => {
    const kai = makeBot("Kai", kaiPos, "kai", 1);
    const atlas = makeBot("Atlas", atlasPos, "atlas", 2);
    const kaiOwner = { uuid: "kai", entityId: 1 };
    const atlasOwner = { uuid: "atlas", entityId: 2 };
    const kaiRun = runMineflayerFishCycle(kai, { timeoutMs: 1500, ownerId: "Kai", attemptId: "k1" });
    const atlasRun = runMineflayerFishCycle(atlas, { timeoutMs: 1500, ownerId: "Atlas", attemptId: "a1" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    spawnCross(kai, atlas, 11, atlasHook, atlasOwner);
    spawnCross(kai, atlas, 10, kaiHook, kaiOwner);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(kai.activations).toEqual(["Kai"]);
    expect(atlas.activations).toEqual(["Atlas"]);
    biteAt(kai, atlasHook);
    biteAt(atlas, kaiHook);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(kai.activations).toEqual(["Kai"]);
    expect(atlas.activations).toEqual(["Atlas"]);
    biteAt(kai, kaiHook);
    biteAt(atlas, atlasHook);
    const [kaiDone, atlasDone] = await Promise.all([kaiRun, atlasRun]);
    expect(kaiDone.result).toBe("reeled");
    expect(atlasDone.result).toBe("reeled");
    expect(kaiDone.bobberId).toBe(10);
    expect(atlasDone.bobberId).toBe(11);
    expect(kai.activations).toEqual(["Kai", "Kai"]);
    expect(atlas.activations).toEqual(["Atlas", "Atlas"]);
  });

  it("handles staggered bites without retracting the waiting rod", async () => {
    const kai = makeBot("Kai", kaiPos, "kai", 1);
    const atlas = makeBot("Atlas", atlasPos, "atlas", 2);
    const kaiRun = runMineflayerFishCycle(kai, { timeoutMs: 1500, ownerId: "Kai", attemptId: "k2" });
    const atlasRun = runMineflayerFishCycle(atlas, { timeoutMs: 1500, ownerId: "Atlas", attemptId: "a2" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    spawnCross(kai, atlas, 20, kaiHook, { uuid: "kai", entityId: 1 });
    spawnCross(kai, atlas, 21, atlasHook, { uuid: "atlas", entityId: 2 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    biteAt(atlas, atlasHook);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(atlas.activations).toEqual(["Atlas", "Atlas"]);
    expect(kai.activations).toEqual(["Kai"]);
    biteAt(kai, kaiHook);
    const [kaiDone, atlasDone] = await Promise.all([kaiRun, atlasRun]);
    expect(atlasDone.result).toBe("reeled");
    expect(kaiDone.result).toBe("reeled");
    expect(kai.activations).toEqual(["Kai", "Kai"]);
  });

  it("ignores a duplicate cast on the same client so an active bobber is not toggled", async () => {
    const kai = makeBot("Kai", kaiPos, "kai", 1);
    const first = runMineflayerFishCycle(kai, { timeoutMs: 800, ownerId: "Kai", attemptId: "k3" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    spawnSeen(kai, 30, kaiHook, { uuid: "kai", entityId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const second = await runMineflayerFishCycle(kai, { timeoutMs: 400, ownerId: "Kai", attemptId: "k3b" });
    expect(second.result).toBe("already-fishing");
    expect(kai.activations).toEqual(["Kai"]);
    biteAt(kai, kaiHook);
    const done = await first;
    expect(done.result).toBe("reeled");
    expect(kai.activations).toEqual(["Kai", "Kai"]);
  });

  it("times out one bot without retracting the other", async () => {
    const kai = makeBot("Kai", kaiPos, "kai", 1);
    const atlas = makeBot("Atlas", atlasPos, "atlas", 2);
    const kaiRun = runMineflayerFishCycle(kai, { timeoutMs: 250, ownerId: "Kai", attemptId: "k4" });
    const atlasRun = runMineflayerFishCycle(atlas, { timeoutMs: 1200, ownerId: "Atlas", attemptId: "a4" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    spawnCross(kai, atlas, 40, kaiHook, { uuid: "kai", entityId: 1 });
    spawnCross(kai, atlas, 41, atlasHook, { uuid: "atlas", entityId: 2 });
    const kaiDone = await kaiRun;
    expect(kaiDone.result).toBe("timeout");
    expect(kai.activations).toEqual(["Kai", "Kai"]);
    expect(atlas.activations).toEqual(["Atlas"]);
    biteAt(atlas, atlasHook);
    const atlasDone = await atlasRun;
    expect(atlasDone.result).toBe("reeled");
    expect(atlas.activations).toEqual(["Atlas", "Atlas"]);
  });

  it("cancels one bot without finishing or reeling the other", async () => {
    const kai = makeBot("Kai", kaiPos, "kai", 1);
    const atlas = makeBot("Atlas", atlasPos, "atlas", 2);
    const abort = new AbortController();
    const kaiRun = runMineflayerFishCycle(kai, {
      timeoutMs: 1500,
      ownerId: "Kai",
      attemptId: "k5",
      signal: abort.signal,
    });
    const atlasRun = runMineflayerFishCycle(atlas, { timeoutMs: 1500, ownerId: "Atlas", attemptId: "a5" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    spawnCross(kai, atlas, 50, kaiHook, { uuid: "kai", entityId: 1 });
    spawnCross(kai, atlas, 51, atlasHook, { uuid: "atlas", entityId: 2 });
    abort.abort();
    const kaiDone = await kaiRun;
    expect(kaiDone.result).toBe("cancelled");
    expect(atlas.activations).toEqual(["Atlas"]);
    biteAt(atlas, atlasHook);
    const atlasDone = await atlasRun;
    expect(atlasDone.result).toBe("reeled");
  });

  it("does not claim a catch from a late particle after timeout", async () => {
    const kai = makeBot("Kai", kaiPos, "kai", 1);
    const run = runMineflayerFishCycle(kai, { timeoutMs: 200, ownerId: "Kai", attemptId: "k6" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    spawnSeen(kai, 60, kaiHook, { uuid: "kai", entityId: 1 });
    const done = await run;
    expect(done.result).toBe("timeout");
    const after = kai.activations.length;
    biteAt(kai, kaiHook);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(kai.activations.length).toBe(after);
  });

  it("reels on own biting metadata and ignores the other bot's biting packet", async () => {
    const kai = makeBot("Kai", kaiPos, "kai", 1);
    const atlas = makeBot("Atlas", atlasPos, "atlas", 2);
    const kaiRun = runMineflayerFishCycle(kai, { timeoutMs: 1500, ownerId: "Kai", attemptId: "k7" });
    const atlasRun = runMineflayerFishCycle(atlas, { timeoutMs: 1500, ownerId: "Atlas", attemptId: "a7" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    spawnCross(kai, atlas, 70, kaiHook, { uuid: "kai", entityId: 1 });
    spawnCross(kai, atlas, 71, atlasHook, { uuid: "atlas", entityId: 2 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    kai.client.emit("entity_metadata", { entityId: 71, metadata: [{ key: 9, value: true }] });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(kai.activations).toEqual(["Kai"]);
    kai.client.emit("entity_metadata", { entityId: 70, metadata: [{ key: 9, value: true }] });
    atlas.client.emit("entity_metadata", { entityId: 71, metadata: [{ key: 9, value: true }] });
    const [kaiDone, atlasDone] = await Promise.all([kaiRun, atlasRun]);
    expect(kaiDone.result).toBe("reeled");
    expect(atlasDone.result).toBe("reeled");
    expect(kai.activations).toEqual(["Kai", "Kai"]);
    expect(atlas.activations).toEqual(["Atlas", "Atlas"]);
  });

  it("does not bind the first unlabeled foreign hook the way stock bot.fish lastBobber would", async () => {
    const kai = makeBot("Kai", kaiPos, "kai", 1);
    const atlas = makeBot("Atlas", atlasPos, "atlas", 2);
    const kaiRun = runMineflayerFishCycle(kai, { timeoutMs: 1500, ownerId: "Kai", attemptId: "k8" });
    const atlasRun = runMineflayerFishCycle(atlas, { timeoutMs: 1500, ownerId: "Atlas", attemptId: "a8" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    kai.entities[81] = { id: 81, name: "fishing_bobber", position: atlasHook };
    kai.client.emit("spawn_entity", { type: 156, entityId: 81, x: atlasHook.x, y: atlasHook.y, z: atlasHook.z });
    atlas.entities[81] = { id: 81, name: "fishing_bobber", position: atlasHook };
    atlas.client.emit("spawn_entity", {
      type: 156,
      entityId: 81,
      objectData: 2,
      x: atlasHook.x,
      y: atlasHook.y,
      z: atlasHook.z,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(kai.activations).toEqual(["Kai"]);
    kai.entities[80] = { id: 80, name: "fishing_bobber", position: kaiHook };
    kai.client.emit("spawn_entity", {
      type: 156,
      entityId: 80,
      objectData: 1,
      x: kaiHook.x,
      y: kaiHook.y,
      z: kaiHook.z,
    });
    atlas.entities[80] = { id: 80, name: "fishing_bobber", position: kaiHook };
    atlas.client.emit("spawn_entity", { type: 156, entityId: 80, x: kaiHook.x, y: kaiHook.y, z: kaiHook.z });
    await new Promise((resolve) => setTimeout(resolve, 40));
    biteAt(kai, kaiHook);
    biteAt(atlas, atlasHook);
    const [kaiDone, atlasDone] = await Promise.all([kaiRun, atlasRun]);
    expect(kaiDone.bobberId).toBe(80);
    expect(atlasDone.bobberId).toBe(81);
    expect(kaiDone.result).toBe("reeled");
    expect(atlasDone.result).toBe("reeled");
  });
});
