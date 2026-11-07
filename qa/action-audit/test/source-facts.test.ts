import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { MUTATING_PACKETS } from "../src/native-boundary.js";

/** Source-backed facts the report relies on. Each is a literal pattern in a named file at the audited SHA. */
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("facts about the audited tree", () => {
  it("the combined candidate retains the QA57-M1 bounded lookAt recovery fix", () => {
    const src = read("packages/minecraft-adapter/src/obstacle-detour.ts");
    expect(src).toMatch(
      /try \{\s*await bot\.lookAt\(new Vec3Class\(tx, start\.y \+ 1, tz\), true\);\s*\} catch/,
    );
    expect(src).toMatch(/const facing = await movementOperationOutcome/);
    expect(src).toContain('if (facing !== "complete" || signal?.aborted || Date.now() >= deadline)');
  });

  it("mineflayer@4.39.0 openBlock/openContainer waits on windowOpen with no timeout", () => {
    const require = createRequire(
      new URL("../../../packages/minecraft-adapter/package.json", import.meta.url),
    );
    const plugin = readFileSync(require.resolve("mineflayer/lib/plugins/inventory.js"), "utf8");
    const body = /async function openBlock \([^)]*\) \{([\s\S]*?)\n {2}\}/.exec(plugin)?.[1] ?? "";
    expect(body).toContain("await once(bot, 'windowOpen')");
    expect(body).not.toMatch(/timeout/i);
    // consume, by contrast, is bounded:
    expect(plugin).toContain("await withTimeout(eatingTask.promise, CONSUME_TIMEOUT)");
  });

  it("the manager clears action permission in finally, and death, stop and admin override still abort and clear busy", () => {
    const manager = read("packages/agent-core/src/manager.ts");
    expect(manager).toMatch(/\.finally\(\(\) => \{\s*citizen\.actionLive = false;\s*citizen\.busy = false;/);
    expect(manager).toMatch(
      /cancelCitizenWork\(citizen\);\s*this\.cancelCognition\(citizen\.record\.id\);\s*citizen\.body\.stopPathfinding\(\);\s*citizen\.busy = false;/,
    );
    const lifecycle = read("packages/agent-core/src/lifecycle.ts");
    expect(lifecycle).toMatch(
      /input\.citizen\.abort\?\.abort\(\);\s*input\.citizen\.busy = false;/,
    );
  });

  it("disconnect and kick abort the physical action as well as cognition", () => {
    const manager = read("packages/agent-core/src/manager.ts");
    expect(manager).toContain('if (event.type === "CitizenDisconnected" || event.type === "CitizenKicked")');
    expect(manager).toContain("if (disconnected) cancelCitizenWork(disconnected);");
    const cancelCognition = /private cancelCognition\([\s\S]*?\n {2}\}/.exec(manager)?.[0] ?? "";
    expect(cancelCognition).not.toContain(".disconnect(");
    expect(cancelCognition).not.toContain(".quit(");
  });

  it("executePlan runs inside a bounded action boundary", () => {
    const manager = read("packages/agent-core/src/manager.ts");
    const taskWork = /const taskWork = actionBoundaryFor\([\s\S]*?void this\.ops\.track\(taskWork\);/.exec(manager)?.[0] ?? "";
    expect(taskWork.length).toBeGreaterThan(200);
    expect(taskWork).toContain("timeoutMs: ctx.timeoutMs ?? 22_000");
    expect(taskWork).toContain("executePlan(ctx, plan, this.store, this.events, this.runtime)");
  });

  it("bodyContext is created in exactly one production place, and the skill sees the boundary signal", () => {
    const manager = read("packages/agent-core/src/manager.ts");
    expect(manager.match(/bodyContext\(/g)).toHaveLength(1);
    expect(manager).toContain("ctx.signal = signal;");
  });

  it("transferItemToCitizen (the only skill that drives a second citizen's body) is reached only from operator live scripts", () => {
    const callers = [
      "packages/agent-core/src/executor.ts",
      "packages/agent-core/src/manager.ts",
      "apps/orchestrator/src/independent-offline-runtime.ts",
      "apps/orchestrator/src/index.ts",
    ];
    for (const file of callers) expect(read(file), file).not.toContain("transferItemToCitizen");
    expect(read("apps/orchestrator/src/live-mechanics-test.ts")).toContain("transferItemToCitizen");
  });

  it("the share path used in production (shareFoodNearby) drops from one body only", () => {
    const executor = read("packages/agent-core/src/executor.ts");
    const share = /async function shareFoodNearby[\s\S]*?\n\}/.exec(executor)?.[0] ?? "";
    expect(share).toContain("dropItem(ctx,");
    expect(share).not.toContain("transferItemToCitizen");
  });

  it("smeltItem checks the signal before taking furnace output", () => {
    const furnace = read("packages/skills/src/furnace.ts");
    const smelt = furnace.slice(furnace.indexOf("export async function smeltItem"));
    expect(smelt).toContain("Math.min(ctx.timeoutMs ?? 30_000, 25_000)");
    expect(smelt).toContain("smelting cancelled before taking output");
    expect(smelt.match(/ctx\.signal/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it("huntAnimal checks the signal before each attack", () => {
    const combat = read("packages/skills/src/combat.ts");
    const hunt = combat.slice(combat.indexOf("export async function huntAnimal"));
    expect(hunt).toContain("hunt cancelled before the next attack");
    expect(hunt).toMatch(/ctx\.signal\?\.aborted/);
  });

  it("deposit and withdraw check the signal immediately before the chest transfer", () => {
    const service = read("packages/skills/src/inventory-service.ts");
    const chest = service.slice(
      service.indexOf("export async function depositItem"),
      service.indexOf("export async function transferItemToCitizen"),
    );
    expect(chest).toContain("deposit cancelled before moving items");
    expect(chest).toContain("withdraw cancelled before moving items");
    const resolve = service.slice(
      service.indexOf("async function resolveContainer"),
      service.indexOf("function containerCounts"),
    );
    expect(resolve.match(/signal: ctx\.signal/g)).toHaveLength(2);
  });

  it("every packet name in the guard list exists in the serverbound protocol for the configured Minecraft version (1.21.11)", () => {
    const require = createRequire(
      new URL("../../../packages/minecraft-adapter/package.json", import.meta.url),
    );
    const protocolFile =
      require.resolve("minecraft-data/minecraft-data/data/pc/1.21.11/protocol.json");
    const protocol = JSON.parse(readFileSync(protocolFile, "utf8")) as {
      play: {
        toServer: {
          types: {
            packet: [string, Array<{ type: [string, { mappings: Record<string, string> }] }>];
          };
        };
      };
    };
    const names = new Set(
      Object.values(protocol.play.toServer.types.packet[1][0]!.type[1].mappings),
    );
    for (const name of MUTATING_PACKETS) expect(names.has(name), name).toBe(true);
    // Attack gets its own packet only from protocol 26.1 on, so it is not a gap for 1.21.11:
    expect(names.has("attack")).toBe(false);
    expect(read("packages/shared/src/config.ts")).toContain(
      'MINECRAFT_VERSION: z.string().default("1.21.11")',
    );
  });
});
