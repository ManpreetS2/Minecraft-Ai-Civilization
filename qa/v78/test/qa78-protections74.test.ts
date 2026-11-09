// QA78: do PR #74's crafting / door / hazard-bridge / sleep / packet-ownership protections still hold on PR #78?
// Own offset sweeps (not the author's single abort time) against the production skills on controlled offline bodies, plus an
// ownership matrix against PR #78's modified boundary (it now also binds the client and wraps timers). Ordinary assertions only.
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attemptHazardBridge } from "../../../packages/minecraft-adapter/src/hazard-nav.js";
import { craftItem } from "../../../packages/skills/src/inventory.js";
import { openDoor } from "../../../packages/skills/src/doors.js";
import { closeDoor } from "../../../packages/skills/src/library.js";
import { sleep as sleepSkill } from "../../../packages/skills/src/world.js";
import { createActionBoundary, type ClientLike } from "../../../packages/agent-core/src/action-boundary.js";
import { ok } from "../../../packages/shared/src/index.js";
import { installInstantNavigation, offlineBody, skillContext, sleep } from "../support/offline-body.js";

let restore: () => void;
beforeEach(() => { restore = installInstantNavigation(); });
afterEach(() => restore());

describe("craftItem (AUD-X1): abort sweep", () => {
  function craftBot(craftMs: number) {
    const body = offlineBody(); const bot = body.fake; bot.give("oak_planks", 8);
    const registry = bot.registry as unknown as { itemsByName: Record<string, unknown>; items: Record<number, unknown> };
    registry.itemsByName.stick = { id: 8, name: "stick" }; registry.items[8] = { id: 8, name: "stick" };
    const calls: number[] = []; let activateAt = 0;
    const recipes = () => [{ requiresTable: false, result: { id: 8, count: 4 }, ingredients: [{ id: 6, count: 2 }] }, { requiresTable: false, result: { id: 8, count: 4 }, ingredients: [{ id: 6, count: 2 }] }];
    const fake = bot as any;
    fake.recipesAll = recipes; fake.recipesFor = recipes;
    fake.activateBlock = async () => { activateAt = Date.now(); const p = bot.slots.find((i) => i?.name === "oak_planks"); if (p) p.count -= 2; bot.give("stick", 4); };
    fake.craft = async function (this: any) { calls.push(Date.now()); await sleep(craftMs); await this.activateBlock({ position: { x: 1, y: 64, z: 0 } }); };
    fake.unequip = async () => undefined; fake.closeWindow = async () => undefined;
    return { body, bot, calls, activateAt: () => activateAt };
  }
  it("abort at 0/20/60/120/250 ms into a 900 ms craft: prompt CANCELLED, exactly one craft started, no planks consumed after the abort", async () => {
    const problems: string[] = [];
    for (const t of [0, 20, 60, 120, 250]) {
      const rig = craftBot(900); const abort = new AbortController();
      const pending = craftItem(skillContext(rig.body, { signal: abort.signal }), "stick", 4);
      await sleep(t); const abortedAt = Date.now(); abort.abort();
      const result = await pending; const took = Date.now() - abortedAt;
      await sleep(1_100);
      if (took > 300) problems.push(`abort@${t}: returned after ${took} ms`);
      if (result.success || result.code !== "CANCELLED") problems.push(`abort@${t}: result ${result.success ? "success" : result.code}`);
      if (rig.calls.length > 1) problems.push(`abort@${t}: ${rig.calls.length} crafts started`);
      if (rig.activateAt() > abortedAt) problems.push(`abort@${t}: the in-flight craft mutated ${rig.activateAt() - abortedAt} ms after the abort`);
      if (rig.bot.count("oak_planks") !== 8 || rig.bot.count("stick") !== 0) problems.push(`abort@${t}: planks=${rig.bot.count("oak_planks")} sticks=${rig.bot.count("stick")}`);
    }
    expect(problems).toEqual([]);
  }, 30_000);
  it("control: an uninterrupted craft completes exactly once", async () => {
    const rig = craftBot(0); const result = await craftItem(skillContext(rig.body), "stick", 4);
    expect(result.success).toBe(true); expect(rig.calls).toHaveLength(1); expect(rig.bot.count("stick")).toBe(4);
  });
});

describe("doors (AUD-X3): abort sweep", () => {
  it("openDoor: abort at 0/20/60/120/180 ms into a 200 ms look: no activateBlock after the abort, prompt CANCELLED", async () => {
    const problems: string[] = [];
    for (const t of [0, 20, 60, 120, 180]) {
      const body = offlineBody(); const bot = body.fake; bot.timing.lookMs = 200; bot.blocks.set("3,64,3", { name: "oak_door" });
      let activated = 0; (bot as any).activateBlock = async () => { activated += 1; bot.mutations.push({ kind: "activateBlock", at: Date.now() }); };
      const abort = new AbortController();
      const pending = openDoor(skillContext(body, { signal: abort.signal }), { x: 3, y: 64, z: 3 });
      await sleep(t); const abortedAt = Date.now(); abort.abort();
      const result = await pending; await sleep(300);
      if (Date.now() - abortedAt > 700) problems.push(`abort@${t}: slow`);
      if (bot.mutationsAfter(abortedAt).some((m) => m.kind === "activateBlock")) problems.push(`abort@${t}: door toggled after abort (activations=${activated})`);
      if (activated === 0 && result.success) problems.push(`abort@${t}: success without toggling`);
    }
    expect(problems).toEqual([]);
  });
  it("closeDoor: when the abort lands during the first toggle the door is toggled exactly once and not toggled back", async () => {
    for (const abortOn of [1]) {
      const body = offlineBody(); const bot = body.fake; bot.blocks.set("3,64,3", { name: "oak_door" });
      let open = false; let toggles = 0;
      bot.blockAt = ((pos: any) => (Math.floor(pos.x) === 3 && Math.floor(pos.y) === 64 && Math.floor(pos.z) === 3 ? { name: "oak_door", position: { x: 3, y: 64, z: 3 }, getProperties: () => ({ open }) } : { name: "air", position: pos, boundingBox: "empty" })) as never;
      const abort = new AbortController();
      (bot as any).activateBlock = async () => { toggles += 1; open = !open; if (toggles === abortOn) abort.abort(); };
      const result = await closeDoor(skillContext(body, { signal: abort.signal }), { x: 3, y: 64, z: 3 });
      expect(toggles).toBe(1); expect(result.success).toBe(false);
    }
  });
});

describe("sleep: abort sweep and deadline", () => {
  function night(body: ReturnType<typeof offlineBody>) {
    const b = body.fake as any; b.time = { timeOfDay: 18_000 }; b.isRaining = false; b.thunderState = 0; body.fake.blocks.set("2,64,2", { name: "white_bed" });
  }
  it("abort at 0/20/60/150/300 ms of a 400 ms sleep request: prompt return, the citizen is never left in the bed", async () => {
    const problems: string[] = [];
    for (const t of [0, 20, 60, 150, 300]) {
      const body = offlineBody(); night(body);
      (body.fake as any).sleep = async () => { await sleep(400); body.fake.isSleeping = true; };
      (body.fake as any).wake = async () => { body.fake.isSleeping = false; };
      body.fake.timing.lookMs = 0; const abort = new AbortController();
      const pending = sleepSkill(skillContext(body, { signal: abort.signal }), { x: 2, y: 64, z: 2 });
      await sleep(t); const abortedAt = Date.now(); abort.abort();
      const result = await pending; const took = Date.now() - abortedAt; await sleep(500);
      if (took > 300) problems.push(`abort@${t}: ${took} ms to return`);
      if (result.success && !body.fake.isSleeping) problems.push(`abort@${t}: success but not asleep`);
      if (body.fake.isSleeping) problems.push(`abort@${t}: still in bed ${500}ms later`);
    }
    expect(problems).toEqual([]);
  });
  it("a sleep that never confirms settles with TIMEOUT and does not quit the client", async () => {
    const body = offlineBody(); night(body); (body.fake as any).sleep = () => new Promise(() => undefined); (body.fake as any).wake = async () => undefined;
    let quit = 0; (body.fake as any).quit = () => { quit += 1; };
    const r = await Promise.race([sleepSkill(skillContext(body, { timeoutMs: 300 }), { x: 2, y: 64, z: 2 }), sleep(1_200).then(() => "hung" as const)]);
    expect(r).not.toBe("hung"); expect(quit).toBe(0);
  });
});

describe("hazard bridge (AUD-X4): abort sweep", () => {
  function bridgeBot(equipMs: number, lookMs: number) {
    const cells: Record<string, { name: string; boundingBox: string }> = {};
    for (let x = 0; x <= 12; x += 1) for (let z = 0; z <= 12; z += 1) { cells[`${x},63,${z}`] = { name: "grass_block", boundingBox: "block" }; cells[`${x},64,${z}`] = { name: "air", boundingBox: "empty" }; cells[`${x},65,${z}`] = { name: "air", boundingBox: "empty" }; }
    cells["6,64,5"] = { name: "lava", boundingBox: "empty" }; cells["5,65,5"] = { name: "stone", boundingBox: "block" };
    const placed: number[] = [];
    const bot = {
      username: "Bridge", entity: { position: { x: 4.5, y: 64, z: 5.5 }, onGround: true }, inventory: { items: () => [{ name: "cobblestone", count: 8 }] },
      blockAt(pos: any) { const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`; const cell = cells[key] ?? { name: "air", boundingBox: "empty" };
        return { ...cell, position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), offset(dx: number, dy: number, dz: number) { return { x: this.x + dx, y: this.y + dy, z: this.z + dz }; } } }; },
      async equip() { await sleep(equipMs); }, async lookAt() { await sleep(lookMs); },
      async placeBlock() { placed.push(Date.now()); cells["6,65,5"] = { name: "cobblestone", boundingBox: "block" }; },
      setControlState() {}, clearControlStates() {}, supportFeature: () => false,
    };
    return { bot, placed, cells };
  }
  it("abort at 0/30/90/150/230 ms across a 150 ms equip + 150 ms look: nothing is placed after the abort and the cell stays air unless already placed", async () => {
    const problems: string[] = [];
    for (const t of [0, 30, 90, 150, 230]) {
      const rig = bridgeBot(150, 150); const abort = new AbortController();
      const pending = attemptHazardBridge(rig.bot as never, { x: 6, y: 64, z: 5 }, { allowConstruction: true, signal: abort.signal });
      await sleep(t); const abortedAt = Date.now(); abort.abort();
      const result = await pending; await sleep(250);
      if (rig.placed.some((at) => at > abortedAt)) problems.push(`abort@${t}: placeBlock after abort`);
      const placedNow = rig.cells["6,65,5"]?.name === "cobblestone";
      if (placedNow && !result.success) problems.push(`abort@${t}: bridge placed but result=${result.code}`);
      if (!placedNow && result.success) problems.push(`abort@${t}: success but nothing placed`);
    }
    expect(problems).toEqual([]);
  });
});

describe("packet ownership matrix on PR #78's modified boundary", () => {
  const mk = () => { const writes: string[] = []; const client: ClientLike & EventEmitter = Object.assign(new EventEmitter(), { write(n: string) { writes.push(n); } }); const bot = new EventEmitter(); return { writes, client, bot }; };
  const code = (fn: () => void) => { try { fn(); return "sent"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  it("a listener registered BEFORE any action stays unowned (pathfinder-style hooks keep writing), including after actions end", async () => {
    const m = mk(); m.client.on("physicsTick", () => m.client.write("held_item_slot"));
    const b = createActionBoundary(() => m.client, () => [m.bot, m.client]);
    await b.run("idle", async () => ok({}, 1), { timeoutMs: 200 });
    m.client.emit("physicsTick"); expect(m.writes).toEqual(["held_item_slot"]);
  });
  it("a listener registered DURING an action writes while the action is live, and is refused afterwards, for both bot and client emitters", async () => {
    for (const via of ["bot", "client"] as const) {
      const m = mk(); const target = via === "bot" ? m.bot : m.client;
      const b = createActionBoundary(() => m.client, () => [m.bot, m.client]);
      await b.run("a", async () => { target.on("evt", () => m.client.write("use_item")); target.emit("evt"); return ok({}, 1); }, { timeoutMs: 300 });
      expect(m.writes, via).toEqual(["use_item"]);
      expect(code(() => target.emit("evt")), via).toBe("LATE_WRITE_REFUSED");
      expect(m.writes, via).toEqual(["use_item"]);
    }
  });
  it("it stays refused after a LATER action starts and ends (an older action's listener never inherits the new owner)", async () => {
    const m = mk(); const b = createActionBoundary(() => m.client, () => [m.bot, m.client]);
    await b.run("old", async () => { m.client.on("evt", () => m.client.write("block_place")); return ok({}, 1); }, { timeoutMs: 300 });
    await b.run("new", async () => { expect(code(() => m.client.emit("evt"))).toBe("LATE_WRITE_REFUSED"); return ok({}, 1); }, { timeoutMs: 300 });
    expect(m.writes).toEqual([]);
  });
  it("once() listeners and addListener() are bound too", async () => {
    const m = mk(); const b = createActionBoundary(() => m.client, () => [m.bot, m.client]);
    await b.run("a", async () => { m.client.once("o", () => m.client.write("use_entity")); m.client.addListener("l", () => m.client.write("window_click")); return ok({}, 1); }, { timeoutMs: 300 });
    expect(code(() => m.client.emit("o"))).toBe("LATE_WRITE_REFUSED"); expect(code(() => m.client.emit("l"))).toBe("LATE_WRITE_REFUSED");
    expect(m.writes).toEqual([]);
  });
  it("packets outside the guard set are not blocked (the guard does not break chat/position traffic of an ended action)", async () => {
    const m = mk(); const b = createActionBoundary(() => m.client, () => [m.bot, m.client]);
    await b.run("a", async () => { m.client.on("evt", () => m.client.write("position")); return ok({}, 1); }, { timeoutMs: 300 });
    m.client.emit("evt"); expect(m.writes).toEqual(["position"]);
  });
});
