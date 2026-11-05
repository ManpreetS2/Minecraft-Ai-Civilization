import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(`../packages/${p}`, import.meta.url));

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
    include: ["tools/**/*.test.ts"],
    setupFiles: ["./test-support/setup.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
