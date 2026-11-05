import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "test-support/**/*.test.ts", "tools/**/*.test.ts"],
    setupFiles: ["./test-support/setup.ts"],
    environment: "node",
    reporters: ["default"],
  },
});
