import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Own config so qa/ needs no edit to the repository-wide vitest config, package.json or workspace file.
// Re-uses the shared offline network guard. Workspace packages resolve to their TypeScript sources.
const src = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));
export default defineConfig({
  resolve: {
    alias: [
      { find: "@civ/cognition/routing", replacement: src("cognition/src/routing/index.ts") },
      { find: "@civ/skills/testing", replacement: src("skills/src/testing/mineflayer-craft-fixture.ts") },
      ...["agent-core", "cognition", "shared", "skills", "minecraft-adapter", "psychology", "memory"].map((name) => ({
        find: new RegExp(`^@civ/${name}$`),
        replacement: src(`${name}/src/index.ts`),
      })),
    ],
  },
  test: {
    include: ["qa/v1/test/**/*.test.ts"],
    setupFiles: ["./test-support/setup.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
