import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test-support/fixtures/*.fixture.ts"],
    setupFiles: ["./test-support/setup.ts"],
    environment: "node",
  },
});
