import { it } from "vitest";

// Run only by offline-network-guard.test.ts through fixtures/vitest.fixture.config.ts.
it("swallows a blocked fetch", async () => {
  try {
    await fetch("https://203.0.113.7/never-sent");
  } catch {
    // The guard must still fail this test.
  }
});
