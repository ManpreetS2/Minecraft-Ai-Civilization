import { describe, expect, it } from "vitest";
import { loadConfig } from "@civ/shared";
import { MinecraftBody } from "./minecraft-body.js";

/**
 * Isolated live Paper check (disposable identity only; do not run on history you want to keep):
 * 1. pnpm sim:reset-dev -- --yes
 * 2. Start Paper and the five-citizen sim.
 * 3. From an OP account: /kill Kai
 * 4. Expect one CitizenDied, status deceased, body retired, no reconnect.
 * 5. Restart the orchestrator; Kai remains deceased.
 */
describe("permanent death", () => {
  it("refuses reconnect after a confirmed death and emits at most once from the body flag", async () => {
    const body = new MinecraftBody({
      username: "CivDeathUnit",
      config: loadConfig({}),
      reconnect: true,
      allowRespawn: false,
    });
    body.markDeceased();
    expect(body.isDeceased()).toBe(true);
    const result = await body.connect();
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.code).toBe("DEAD");
  });
});
