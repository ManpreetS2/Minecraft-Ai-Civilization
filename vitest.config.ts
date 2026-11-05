import { defineConfig } from "vitest/config";
import { civPackageAliases } from "./tools/civ-package-aliases.js";

export default defineConfig({
  resolve: {
    alias: civPackageAliases(new URL("./packages/", import.meta.url)),
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "test-support/**/*.test.ts", "tools/**/*.test.ts"],
    setupFiles: ["./test-support/setup.ts"],
    environment: "node",
    reporters: ["default"],
  },
});
