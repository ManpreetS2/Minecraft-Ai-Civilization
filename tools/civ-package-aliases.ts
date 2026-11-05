import { fileURLToPath } from "node:url";

export type CivAlias = { find: string | RegExp; replacement: string };

/**
 * Shared `@civ/*` resolve aliases for root and tools Vitest configs.
 * Keep one definition so tools tests load under `pnpm test` and `pnpm test:v1`.
 */
export function civPackageAliases(packagesRootUrl: URL): CivAlias[] {
  const src = (p: string) => fileURLToPath(new URL(p, packagesRootUrl));
  return [
    { find: "@civ/cognition/routing", replacement: src("./cognition/src/routing/index.ts") },
    { find: "@civ/skills/testing", replacement: src("./skills/src/testing/mineflayer-craft-fixture.ts") },
    ...[
      "agent-core",
      "cognition",
      "shared",
      "skills",
      "minecraft-adapter",
      "psychology",
      "memory",
      "society",
      "minecraft-knowledge",
      "session-isolation",
    ].map((name) => ({
      find: new RegExp(`^@civ/${name}$`),
      replacement: src(`./${name}/src/index.ts`),
    })),
  ];
}
