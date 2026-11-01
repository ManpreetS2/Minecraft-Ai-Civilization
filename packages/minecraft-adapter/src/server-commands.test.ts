import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@civ/shared";
import { MinecraftBody } from "./minecraft-body.js";
import { declaredRootCommands, sanitizeWhisperText } from "./server-commands.js";

const fromMineflayer = createRequire(createRequire(import.meta.url).resolve("mineflayer"));
const protocol = fromMineflayer("minecraft-protocol") as {
  createSerializer(o: { state: string; version: string; isServer: boolean }): {
    createPacketBuffer(p: { name: string; params: unknown }): Buffer;
  };
  createDeserializer(o: { state: string; version: string; isServer: boolean }): {
    parsePacketBuffer(b: Buffer): { data: { params: unknown } };
  };
};

function flags(type: number) {
  return { unused: 0, allows_restricted: 0, has_custom_suggestions: 0, has_redirect_node: 0, has_command: 0, command_node_type: type };
}

function tree(...names: string[]) {
  return {
    rootIndex: 0,
    nodes: [
      { flags: flags(0), children: names.map((_, i) => i + 1) },
      ...names.map((name) => ({ flags: flags(1), children: [], extraNodeData: { name } })),
    ],
  };
}

/** A body whose bot is a stand-in, bound through the real private bindBot so the packet listener is the real one. */
function bodyWithClient(players: Record<string, unknown> = {}) {
  const client = new EventEmitter();
  const bot = Object.assign(new EventEmitter(), {
    _client: client,
    username: "Speaker",
    players,
    entity: { position: { x: 0, y: 64, z: 0 } },
    chat: vi.fn(),
    whisper: vi.fn(),
  });
  const body = new MinecraftBody({ username: "Speaker", config: loadConfig({}), citizenId: "speaker", reconnect: false, allowRespawn: true });
  (body as unknown as { bindBot(b: unknown): void }).bindBot(bot);
  (body as unknown as { bot: unknown }).bot = bot;
  return { body, bot, client };
}

describe("SEC-001 server command contract", () => {
  // Offline evidence that the parser matches what Mineflayer's own protocol stack decodes. Whether a real Paper server
  // offers /tell to a given player is NOT shown here; that needs a live check.
  it.each(["1.21.6", "1.21.11"])("reads a real %s declare_commands packet round-tripped through minecraft-protocol", (version) => {
    const buffer = protocol
      .createSerializer({ state: "play", version, isServer: true })
      .createPacketBuffer({ name: "declare_commands", params: tree("tell", "me") });
    const decoded = protocol.createDeserializer({ state: "play", version, isServer: false }).parsePacketBuffer(buffer);
    expect([...(declaredRootCommands(decoded.data.params) ?? [])].sort()).toEqual(["me", "tell"]);
  });

  it.each([[undefined], [null], ["x"], [{}], [{ nodes: [], rootIndex: 0 }], [{ nodes: "no", rootIndex: 0 }]])(
    "an unreadable packet (%j) declares nothing",
    (packet) => {
      expect(declaredRootCommands(packet)).toBeUndefined();
    },
  );

  it("only literal root children count: an argument node named tell is not the command", () => {
    const packet = tree("me");
    packet.nodes.push({ flags: flags(2), children: [], extraNodeData: { name: "tell" } });
    (packet.nodes[0]!.children as number[]).push(2);
    expect(declaredRootCommands(packet)?.has("tell")).toBe(false);
  });

  it("neutralizes selectors and control characters; a leading slash stays an argument", () => {
    expect(sanitizeWhisperText("hello @a and @e[type=player]")).toBe("hello @ a and @ e[type=player]");
    expect(sanitizeWhisperText("line\nbreak\u0000x")).toBe("line break x");
    expect(sanitizeWhisperText("mail me@example.com")).toBe("mail me@example.com");
    expect(sanitizeWhisperText("  \n ")).toBe("");
  });
});

describe("SEC-001 MinecraftBody directed speech", () => {
  it("fails closed before the server has declared any commands", () => {
    const { body, bot } = bodyWithClient();
    const result = body.whisperTo(["Friend"], "hi");
    expect(result).toMatchObject({ success: false, code: "COMMAND_UNAVAILABLE" });
    expect(bot.whisper).not.toHaveBeenCalled();
    expect(bot.chat).not.toHaveBeenCalled();
  });

  it("fails closed when the server declares commands without /tell, and never falls back to public chat", () => {
    const { body, bot, client } = bodyWithClient();
    client.emit("declare_commands", tree("me", "help"));
    expect(body.canWhisper()).toBe(false);
    expect(body.whisperTo(["Friend"], "hi")).toMatchObject({ success: false, code: "COMMAND_UNAVAILABLE" });
    expect(bot.chat).not.toHaveBeenCalled();
  });

  it("whispers to each recipient once /tell is declared, and revokes when a later tree removes it", () => {
    const { body, bot, client } = bodyWithClient();
    client.emit("declare_commands", tree("tell"));
    expect(body.whisperTo(["Friend", "Other_2"], "hi")).toMatchObject({ success: true, data: { sent: ["Friend", "Other_2"] } });
    expect(bot.whisper.mock.calls).toEqual([["Friend", "hi"], ["Other_2", "hi"]]);
    expect(bot.chat).not.toHaveBeenCalled();
    client.emit("declare_commands", tree("me"));
    expect(body.canWhisper()).toBe(false);
  });

  it("a username that could alter the command line is not sent to", () => {
    const { body, bot, client } = bodyWithClient();
    client.emit("declare_commands", tree("tell"));
    expect(body.whisperTo(["ok_name", "bad name", "@a"], "hi")).toMatchObject({ success: true, data: { sent: ["ok_name"] } });
    expect(bot.whisper).toHaveBeenCalledTimes(1);
  });

  it("a reconnect forgets what the previous session's server declared", () => {
    const { body, client } = bodyWithClient();
    client.emit("declare_commands", tree("tell"));
    expect(body.canWhisper()).toBe(true);
    const next = Object.assign(new EventEmitter(), { _client: new EventEmitter() });
    (body as unknown as { bindBot(b: unknown): void }).bindBot(next);
    expect(body.canWhisper()).toBe(false);
  });

  it("nearbyPlayers: a tab-list player with no loaded entity is not nearby", () => {
    const { body } = bodyWithClient({
      Speaker: { uuid: "0", entity: { position: { x: 0, y: 64, z: 0 } } },
      Close: { uuid: "1", entity: { position: { x: 3, y: 64, z: 0 } } },
      TooFar: { uuid: "2", entity: { position: { x: 40, y: 64, z: 0 } } },
      FarRival: { uuid: "3" },
    });
    expect(body.nearbyPlayers(8).map((p) => p.username)).toEqual(["Close"]);
    expect(body.nearbyPlayers().map((p) => p.username)).toEqual(["Close", "TooFar"]);
  });
});
