import { defineConfig } from "vitest/config";
import { civPackageAliases } from "../../tools/civ-package-aliases.js";

export default defineConfig({
  resolve: { alias: civPackageAliases(new URL("../../packages/", import.meta.url)) },
  test: {
    include: ["qa/action-audit/test/**/*.test.ts"],
    setupFiles: ["./test-support/setup.ts"],
    environment: "node",
  },
});
