import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { civPackageAliases } from "../../tools/civ-package-aliases.js";

// Own config; the repository's vitest configs / package.json are untouched. Reuses the offline network guard.
export default defineConfig({
  resolve: { alias: civPackageAliases(new URL("../../packages/", import.meta.url)) },
  test: {
    include: ["contracts.test.ts"],
    root: fileURLToPath(new URL(".", import.meta.url)),
    setupFiles: [fileURLToPath(new URL("../../test-support/setup.ts", import.meta.url))],
    environment: "node",
    testTimeout: 60_000,
  },
});
