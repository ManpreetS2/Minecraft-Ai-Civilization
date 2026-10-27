import { describe, expect, it } from "vitest";
import type { Bot } from "mineflayer";
import {
  currentPlayerInput,
  installModernMovement,
  writePlayerInput,
  writePlayerLoaded,
  writeTickEnd,
} from "./movement-sync.js";

function fakeModernBot(): Bot & { packets: Array<{ name: string; payload?: unknown }> } {
  const controls: Record<string, boolean> = {};
  const packets: Array<{ name: string; payload?: unknown }> = [];
  const listeners: Record<string, Array<() => void>> = {};
  const bot = {
    packets,
    controlState: controls,
    supportFeature(name: string) {
      return name === "newPlayerInputPacket" || name === "sendsClientTickEndPacket" || name === "sendsPlayerLoadedPacket";
    },
    setControlState(name: string, value: boolean) {
      controls[name] = value;
    },
    getControlState(name: string) {
      return Boolean(controls[name]);
    },
    on(event: string, fn: () => void) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(fn);
      return bot;
    },
    emit(event: string) {
      for (const fn of listeners[event] ?? []) fn();
    },
    _client: {
      state: "play",
      write(name: string, payload?: unknown) {
        packets.push({ name, payload });
      },
    },
  };
  return bot as unknown as Bot & { packets: Array<{ name: string; payload?: unknown }> };
}

describe("1.21 movement packet sync", () => {
  it("writes the full player_input bitset, not shift-only", () => {
    const bot = fakeModernBot();
    bot.setControlState("jump", true);
    bot.setControlState("forward", true);
    writePlayerInput(bot);
    const last = bot.packets.at(-1);
    expect(last?.name).toBe("player_input");
    const inputs = (last?.payload as { inputs: Record<string, boolean> }).inputs;
    expect(inputs.jump).toBe(true);
    expect(inputs.forward).toBe(true);
    expect(inputs.shift).toBe(false);
  });

  it("installs per-tick player_input and tick_end after movement packets", () => {
    const bot = fakeModernBot();
    installModernMovement(bot);
    bot.setControlState("jump", true);
    (bot as unknown as { emit: (name: string) => void }).emit("physicsTick");
    expect(bot.packets.map((packet) => packet.name)).toContain("player_input");
    (bot as unknown as { _client: { write: (name: string, payload?: unknown) => void } })._client.write("position", { x: 0, y: 64, z: 0 });
    expect(bot.packets.map((packet) => packet.name)).toContain("tick_end");
    const input = bot.packets.filter((packet) => packet.name === "player_input").at(-1);
    expect((input?.payload as { inputs: { jump: boolean } }).inputs.jump).toBe(true);
  });

  it("merges sneak-only player_input so jump bits are not cleared", () => {
    const bot = fakeModernBot();
    installModernMovement(bot);
    bot.setControlState("jump", true);
    bot.setControlState("forward", true);
    (bot as unknown as { _client: { write: (name: string, payload?: unknown) => void } })._client.write("player_input", {
      inputs: { shift: true },
    });
    const last = bot.packets.filter((packet) => packet.name === "player_input").at(-1);
    const inputs = (last?.payload as { inputs: Record<string, boolean> }).inputs;
    expect(inputs.jump).toBe(true);
    expect(inputs.forward).toBe(true);
    expect(inputs.shift).toBe(true);
  });

  it("sends player_loaded after spawn", () => {
    const bot = fakeModernBot();
    installModernMovement(bot);
    (bot as unknown as { emit: (name: string) => void }).emit("spawn");
    expect(bot.packets.some((packet) => packet.name === "player_loaded")).toBe(true);
  });

  it("exposes the current control snapshot", () => {
    const bot = fakeModernBot();
    bot.setControlState("sprint", true);
    expect(currentPlayerInput(bot).sprint).toBe(true);
    writeTickEnd(bot);
    writePlayerLoaded(bot);
    expect(bot.packets.map((packet) => packet.name)).toEqual(["tick_end", "player_loaded"]);
  });
});
