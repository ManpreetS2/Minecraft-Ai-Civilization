/**
 * Test-only loader for the @civ/skills Mineflayer craft fixture (packages/skills/src/testing).
 * @civ/skills only exports its public index, and agent-core's tsconfig rootDir is `src`, so a static relative
 * import would break typecheck (TS6059). A runtime file import keeps production package config untouched.
 * (IMPROVEMENT: a `@civ/skills/testing` subpath export would remove this shim.)
 */
import { fileURLToPath } from "node:url";
import type { SkillContext } from "@civ/skills";

export type CraftFixtureFacade = {
  ctx: SkillContext;
  nav: unknown;
  stats: {
    digs: string[];
    placed: Array<{ name: string; position: { x: number; y: number; z: number } }>;
    craftCalls: Array<{ result: string; crafts: number; withTable: boolean }>;
    windowOpens: number;
  };
  items: Array<{ name: string; count: number }>;
  count(name: string): number;
  totalItems(): number;
  blocksNamed(name: string): number;
  bot: { entity: { position: { x: number; y: number; z: number } } };
};

export async function loadCraftFixture(options: { trees: Array<{ x: number; z: number; height: number }> }): Promise<CraftFixtureFacade> {
  const path = fileURLToPath(new URL("../../../skills/src/testing/mineflayer-craft-fixture.ts", import.meta.url));
  const mod = (await import(/* @vite-ignore */ path)) as { createMineflayerCraftFixture(options: unknown): CraftFixtureFacade };
  return mod.createMineflayerCraftFixture(options);
}
