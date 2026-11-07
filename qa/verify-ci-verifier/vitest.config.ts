import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { civPackageAliases } from "../../tools/civ-package-aliases.js";

// Independent audit config. Overlaid UNTRACKED on a candidate checkout at <repo>/qa-independent/verify-ci-verifier. Offline only.
export default defineConfig({
  resolve: { alias: civPackageAliases(new URL("../../packages/", import.meta.url)) as never },
  test: {
    include: ["**/test/**/*.test.ts"],
    root: fileURLToPath(new URL(".", import.meta.url)),
    setupFiles: [fileURLToPath(new URL("../../test-support/setup.ts", import.meta.url))],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
