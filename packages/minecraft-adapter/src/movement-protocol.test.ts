import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";
import { installModernMovement, writePlayerLoaded } from "./movement-sync.js";

const require = createRequire(import.meta.url);
const mineflayerRequire = createRequire(require.resolve("mineflayer"));
const dataFor = mineflayerRequire("minecraft-data") as (v: string) => { supportFeature: (name: string) => boolean };
const protocol = mineflayerRequire("minecraft-protocol") as {
  createSerializer: (options: { version: string; state: string; isServer: boolean }) => { createPacketBuffer: (packet: { name: string; params: unknown }) => Buffer };
};
function fixture(version = "1.21.6") {
  const events = new EventEmitter();
  const controls: Record<string, boolean> = {};
  const packets: Array<{ name: string; payload?: unknown; encoded: Buffer }> = [];
  const serializer = protocol.createSerializer({ version, state: "play", isServer: false });
  const client = { state: "play", write: vi.fn((name: string, payload?: unknown) => {
    packets.push({ name, payload, encoded: serializer.createPacketBuffer({ name, params: payload ?? {} }) });
  }) };
  const bot = Object.assign(events, {
    health: 20, _client: client, controlState: controls,
    supportFeature: dataFor(version).supportFeature,
    setControlState: (name: string, value: boolean) => { controls[name] = value; },
    getControlState: (name: string) => Boolean(controls[name]),
    clearControlStates: () => { for (const name of Object.keys(controls)) controls[name] = false; },
  });
  return { bot: bot as unknown as Bot, events, client, packets, controls, rawWrite: client.write };
}

describe("installed protocol serialization (no live server)", () => {
  it.each(["1.21.6", "1.21.11"])("serializes full input, loaded and tick-end packets for %s", (version) => {
    const f = fixture(version);
    installModernMovement(f.bot);
    f.bot.setControlState("jump", true);
    f.bot.setControlState("forward", true);
    f.events.emit("spawn");
    f.client.write("position", { x: 0, y: 64, z: 0, flags: { onGround: true, hasHorizontalCollision: false } });
    expect(f.packets.map((p) => p.name)).toContain("player_loaded");
    expect(f.packets.filter((p) => p.name === "tick_end")).toHaveLength(1);
    expect(f.packets.every((p) => p.encoded.length > 0)).toBe(true);
    const input = f.packets.filter((p) => p.name === "player_input").at(-1);
    expect(input?.payload).toMatchObject({ inputs: { jump: true, forward: true, shift: false } });
  });
  it("does not try tick-end on a protocol without that feature", () => {
    const f = fixture("1.20.4");
    installModernMovement(f.bot);
    f.client.write("position", { x: 0, y: 64, z: 0, onGround: true });
    expect(f.rawWrite.mock.calls.map(([name]) => name)).toEqual(["position"]);
  });
  it("does not emit loaded packets outside the play state", () => {
    const f = fixture();
    f.client.state = "configuration";
    writePlayerLoaded(f.bot);
    expect(f.packets).toHaveLength(0);
  });
  it("does not send stale physics input after end", () => {
    const f = fixture();
    installModernMovement(f.bot);
    f.events.emit("end");
    f.events.emit("physicsTick");
    expect(f.packets).toHaveLength(0);
    expect(f.events.listenerCount("physicsTick")).toBe(0);
  });
  it("reinstalls the input merge for a replacement protocol client without duplicate listeners", () => {
    const f = fixture();
    installModernMovement(f.bot);
    const replacement = fixture();
    Object.assign(f.bot, { _client: replacement.client });
    installModernMovement(f.bot);
    f.controls.forward = true;
    replacement.client.write("player_input", { inputs: { shift: true } });
    expect(replacement.packets.at(-1)?.payload).toMatchObject({ inputs: { forward: true, shift: true } });
    expect(f.events.listenerCount("physicsTick")).toBe(1);
  });
  it("does not send a duplicate input when Mineflayer already emits one from setControlState", () => {
    const f = fixture();
    f.bot.setControlState = ((name: string, value: boolean) => {
      f.controls[name] = value;
      f.client.write("player_input", { inputs: { shift: value } });
    }) as Bot["setControlState"];
    installModernMovement(f.bot);
    f.bot.setControlState("sneak", true);
    expect(f.packets.filter((p) => p.name === "player_input")).toHaveLength(1);
  });
  it("does not let stale forcedMove resume input after death, but resumes after spawn", () => {
    const f = fixture();
    installModernMovement(f.bot);
    f.events.emit("death");
    f.events.emit("forcedMove");
    f.events.emit("physicsTick");
    expect(f.packets).toHaveLength(0);
    f.events.emit("spawn");
    f.events.emit("physicsTick");
    expect(f.packets.map((p) => p.name)).toEqual(["player_loaded", "player_input"]);
  });
  it("clears held controls so respawn cannot resume old movement", () => {
    const f = fixture();
    f.controls.forward = true;
    installModernMovement(f.bot);
    f.events.emit("death");
    f.events.emit("spawn");
    f.events.emit("physicsTick");
    expect(f.packets.at(-1)?.payload).toMatchObject({ inputs: { forward: false } });
  });
  it("suppresses native setter input while dead or outside play", () => {
    const f = fixture();
    f.bot.setControlState = ((name: string, value: boolean) => {
      f.controls[name] = value;
      f.client.write("player_input", { inputs: { shift: value } });
    }) as Bot["setControlState"];
    installModernMovement(f.bot);
    f.events.emit("death");
    f.bot.setControlState("sneak", true);
    expect(f.packets).toHaveLength(0);
    f.events.emit("spawn");
    f.packets.length = 0;
    f.client.state = "configuration";
    f.bot.setControlState("sneak", false);
    expect(f.packets).toHaveLength(0);
  });
  it("cannot reinstall movement on the same client after end", () => {
    const f = fixture();
    installModernMovement(f.bot);
    f.events.emit("end");
    installModernMovement(f.bot);
    f.events.emit("spawn");
    f.events.emit("physicsTick");
    expect(f.packets).toHaveLength(0);
    expect(f.events.listenerCount("physicsTick")).toBe(0);
  });
  it("stops injected modern packets when the transport is already ended", () => {
    const f = fixture();
    installModernMovement(f.bot);
    Object.assign(f.client, { ended: true });
    f.events.emit("physicsTick");
    f.bot.setControlState("forward", true);
    writePlayerLoaded(f.bot);
    f.client.write("position", { x: 0, y: 64, z: 0, flags: { onGround: true, hasHorizontalCollision: false } });
    expect(f.packets.map(packet => packet.name)).toEqual(["position"]);
    expect(Boolean(f.controls.forward)).toBe(false);
  });
  it("can install movement on a new client after the previous one ended", () => {
    const f = fixture();
    installModernMovement(f.bot);
    f.events.emit("end");
    const replacement = fixture();
    Object.assign(f.bot, { _client: replacement.client });
    installModernMovement(f.bot);
    f.events.emit("spawn");
    f.events.emit("physicsTick");
    expect(replacement.packets.map(packet => packet.name)).toEqual(["player_loaded", "player_input"]);
    expect(f.packets).toHaveLength(0);
    expect(f.events.listenerCount("physicsTick")).toBe(1);
  });

});
