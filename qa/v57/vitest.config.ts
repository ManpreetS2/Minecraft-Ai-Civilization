import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { civPackageAliases } from "../../tools/civ-package-aliases.js";

// Own config: the repository's vitest.config.ts / package.json are not edited. Reuses the offline network guard.
export default defineConfig({
  resolve: { alias: [
    { find: /^mineflayer$/, replacement: fileURLToPath(new URL("./stubs/mineflayer.ts", import.meta.url)) },
    ...(civPackageAliases(new URL("../../packages/", import.meta.url)) as never as Array<{ find: string | RegExp; replacement: string }>),
  ] },
  test: {
    include: ["**/test/**/*.test.ts"],
    root: fileURLToPath(new URL(".", import.meta.url)),
    setupFiles: [fileURLToPath(new URL("../../test-support/setup.ts", import.meta.url))],
    environment: "node",
    testTimeout: 60_000,
  },
});
