import { defineConfig } from "vitest/config";
import { civPackageAliases } from "./civ-package-aliases.js";

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
