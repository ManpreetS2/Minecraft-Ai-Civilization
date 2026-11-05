import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["experiments/evidence-validator/test/**/*.test.ts"],
    setupFiles: ["./test-support/setup.ts"],
    environment: "node",
  },
});
