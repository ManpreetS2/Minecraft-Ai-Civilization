import { defineConfig } from "vitest/config";
import { civPackageAliases } from "../test-support/civ-package-aliases.mjs";

export default defineConfig({
  resolve: {
    alias: civPackageAliases(new URL("../packages/", import.meta.url)),
  },
  test: {
    include: ["tools/**/*.test.ts"],
    setupFiles: ["./test-support/setup.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
