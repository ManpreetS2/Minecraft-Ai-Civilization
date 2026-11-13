 
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { civPackageAliases } from "../../tools/civ-package-aliases.js";

// Own config; repository configs / package.json untouched. Overlayed at <worktree>/qa-indep/round5 (same depth as qa/repair-reviews).
export default defineConfig({
  resolve: { alias: civPackageAliases(new URL("../../packages/", import.meta.url)) },
  test: {
    include: ["**/test/**/*.test.ts"],
    root: fileURLToPath(new URL(".", import.meta.url)),
    setupFiles: [fileURLToPath(new URL("../../test-support/setup.ts", import.meta.url))],
    environment: "node",
    testTimeout: 120_000,
  },
});
