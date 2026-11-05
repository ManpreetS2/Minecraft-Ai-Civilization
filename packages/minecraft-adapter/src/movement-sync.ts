import type { Bot, ControlState } from "mineflayer";

type FeatureBot = Bot & {
  supportFeature?: (name: string) => boolean;
  _civModernMovement?: boolean;
};

type ClientBot = {
  _client?: { write?: (name: string, payload?: unknown) => void; state?: string; ended?: boolean };
};
const inactive = new WeakSet<Bot>();
const closedClients = new WeakSet<object>();
function clientUnavailable(client: ClientBot["_client"]): boolean {
  return Boolean(client?.ended || client && closedClients.has(client));
}
const installed = new WeakMap<Bot, { client: ClientBot["_client"]; cleanup: () => void }>();

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
  if (inactive.has(bot) || clientUnavailable(client)) return;
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
  if (inactive.has(bot) || clientUnavailable(client)) return;
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
  if (inactive.has(bot) || clientUnavailable(client)) return;
  if (typeof feature !== "function" || !feature("sendsPlayerLoadedPacket") || !client?.write) return;
  if (client.state && client.state !== "play") return;
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
  const client = clientOf(bot);
  const previous = installed.get(bot);
  if (clientUnavailable(client)) {
    inactive.add(bot);
    previous?.cleanup();
    return;
  }
  if (previous && previous.client === client) return;
  previous?.cleanup();
  inactive.delete(bot);
  tagged._civModernMovement = true;

  const rawSet = bot.setControlState;
  const originalSet = rawSet?.bind(bot);
  let inputWrites = 0;
  let wrappedSet: Bot["setControlState"] | undefined;
  if (originalSet) {
    wrappedSet = ((name: ControlState, value: boolean) => {
      if ((inactive.has(bot) || clientUnavailable(clientOf(bot))) && value) return;
      const before = inputWrites;
      originalSet(name, value);
      if (before === inputWrites) writePlayerInput(bot);
    }) as Bot["setControlState"];
    bot.setControlState = wrappedSet;
  }

  const rawWrite = client?.write;
  const originalWrite = rawWrite?.bind(client);
  let wrappedWrite: NonNullable<ClientBot["_client"]>["write"];
  if (client && originalWrite) {
    wrappedWrite = ((name: string, payload?: unknown) => {
      if ((name === "player_input" || name === "tick_end" || name === "player_loaded") &&
        (inactive.has(bot) || clientUnavailable(client) || client !== clientOf(bot) || (client.state && client.state !== "play"))) return;
      let nextPayload = payload;
      if (name === "player_input") {
        const given =
          payload && typeof payload === "object" && "inputs" in (payload as object)
            ? ((payload as { inputs?: Record<string, boolean> }).inputs ?? {})
            : {};
        nextPayload = { inputs: { ...currentPlayerInput(bot), ...given } };
      }
      const result = originalWrite(name, nextPayload);
      if (name === "player_input") inputWrites += 1;
      if ((name === "position" || name === "look" || name === "position_look") &&
        !inactive.has(bot) && !clientUnavailable(client) && client === clientOf(bot) &&
        (!client.state || client.state === "play") && bot.supportFeature?.("sendsClientTickEndPacket")) {
        try {
          originalWrite("tick_end", {});
        } catch {
          // protocol without tick_end
        }
      }
      return result;
    }) as NonNullable<ClientBot["_client"]>["write"];
    client.write = wrappedWrite;
  }

  const physics = () => writePlayerInput(bot);
  const loaded = () => writePlayerLoaded(bot);
  const spawned = () => { if (!clientUnavailable(client)) { inactive.delete(bot); writePlayerLoaded(bot); } };
  const died = () => {
    inactive.add(bot);
    try { bot.clearControlStates?.(); } catch { /* client may already be gone */ }
  };
  const cleanup = () => {
    inactive.add(bot);
    if (client) closedClients.add(client);
    bot.removeListener?.("physicsTick", physics);
    bot.removeListener?.("spawn", spawned);
    bot.removeListener?.("forcedMove", loaded);
    bot.removeListener?.("death", died);
    bot.removeListener?.("end", cleanup);
    bot.removeListener?.("kicked", cleanup);
    if (wrappedSet && bot.setControlState === wrappedSet) bot.setControlState = rawSet;
    if (client && wrappedWrite && client.write === wrappedWrite) client.write = rawWrite;
    installed.delete(bot);
    tagged._civModernMovement = false;
  };
  installed.set(bot, { client, cleanup });
  if (typeof bot.on === "function") {
    bot.on("physicsTick", physics);
    bot.on("spawn", spawned);
    bot.on("forcedMove", loaded);
    bot.on("death", died);
    bot.on("end", cleanup);
    bot.on("kicked", cleanup);
  }
}
