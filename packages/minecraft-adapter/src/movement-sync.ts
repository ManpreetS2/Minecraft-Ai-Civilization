import type { Bot } from "mineflayer";

type FeatureBot = Bot & {
  supportFeature?: (name: string) => boolean;
  _civModernMovement?: boolean;
};

type ClientBot = {
  _client?: { write?: (name: string, payload?: unknown) => void; state?: string };
};

function clientOf(bot: Bot): ClientBot["_client"] {
  return (bot as unknown as ClientBot)._client;
}

function control(bot: Bot, name: "forward" | "back" | "left" | "right" | "jump" | "sprint" | "sneak"): boolean {
  try {
    return Boolean(bot.getControlState?.(name) ?? bot.controlState?.[name]);
  } catch {
    return false;
  }
}

export function currentPlayerInput(bot: Bot): Record<string, boolean> {
  return {
    forward: control(bot, "forward"),
    backward: control(bot, "back"),
    left: control(bot, "left"),
    right: control(bot, "right"),
    jump: control(bot, "jump"),
    shift: control(bot, "sneak"),
    sprint: control(bot, "sprint"),
  };
}

/** Full 1.21+ player_input. Partial {shift} packets clear jump/forward on Paper. */
export function writePlayerInput(bot: Bot, inputs?: Record<string, boolean>): void {
  const feature = (bot as FeatureBot).supportFeature;
  const client = clientOf(bot);
  if (typeof feature !== "function" || !feature("newPlayerInputPacket") || !client?.write) return;
  if (client.state && client.state !== "play") return;
  try {
    client.write("player_input", { inputs: inputs ?? currentPlayerInput(bot) });
  } catch {
    // protocol without this packet
  }
}

export function writeTickEnd(bot: Bot): void {
  const feature = (bot as FeatureBot).supportFeature;
  const client = clientOf(bot);
  if (typeof feature !== "function" || !feature("sendsClientTickEndPacket") || !client?.write) return;
  if (client.state && client.state !== "play") return;
  try {
    client.write("tick_end", {});
  } catch {
    // older protocol
  }
}

export function writePlayerLoaded(bot: Bot): void {
  const feature = (bot as FeatureBot).supportFeature;
  const client = clientOf(bot);
  if (typeof feature !== "function" || !feature("sendsPlayerLoadedPacket") || !client?.write) return;
  try {
    client.write("player_loaded");
  } catch {
    // older protocol
  }
}

/**
 * Mineflayer 4.39 does not send complete player_input, tick_end, or player_loaded.
 * Paper 1.21.11 needs those for jump/sprint to match client-predicted movement.
 * Mineflayer also writes a sneak-only player_input that clears jump/forward bits.
 */
export function installModernMovement(bot: Bot): void {
  const tagged = bot as FeatureBot;
  if (tagged._civModernMovement) return;
  tagged._civModernMovement = true;

  const originalSet = bot.setControlState?.bind(bot);
  if (originalSet) {
    bot.setControlState = ((name: string, value: boolean) => {
      originalSet(name, value);
      writePlayerInput(bot);
    }) as Bot["setControlState"];
  }

  const client = clientOf(bot);
  const originalWrite = client?.write?.bind(client);
  if (client && originalWrite) {
    client.write = ((name: string, payload?: unknown) => {
      let nextPayload = payload;
      if (name === "player_input") {
        const given =
          payload && typeof payload === "object" && "inputs" in (payload as object)
            ? ((payload as { inputs?: Record<string, boolean> }).inputs ?? {})
            : {};
        nextPayload = { inputs: { ...currentPlayerInput(bot), ...given } };
      }
      const result = originalWrite(name, nextPayload);
      if (name === "position" || name === "look" || name === "position_look") {
        try {
          originalWrite("tick_end", {});
        } catch {
          // protocol without tick_end
        }
      }
      return result;
    }) as NonNullable<ClientBot["_client"]>["write"];
  }

  if (typeof bot.on === "function") {
    bot.on("physicsTick", () => {
      writePlayerInput(bot);
    });
    bot.on("spawn", () => writePlayerLoaded(bot));
    bot.on("forcedMove", () => writePlayerLoaded(bot));
  }
}
