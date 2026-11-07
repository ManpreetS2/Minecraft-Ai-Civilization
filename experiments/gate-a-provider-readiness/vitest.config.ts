import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { civPackageAliases } from "../../tools/civ-package-aliases.js";

const packagesRootUrl = new URL("../../packages/", import.meta.url);
const src = (p: string) => fileURLToPath(new URL(p, packagesRootUrl));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@civ/cognition/routing/claude-live", replacement: src("./cognition/src/routing/claude-sdk-transport.ts") },
      ...civPackageAliases(packagesRootUrl),
    ],
  },
  test: {
    include: ["experiments/gate-a-provider-readiness/test/**/*.test.ts"],
    setupFiles: ["./test-support/setup.ts"],
    environment: "node",
    testTimeout: 20_000,
  },
});
