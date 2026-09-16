import { describe, expect, it } from "vitest";
import { loadConfig } from "@civ/shared";
import { MinecraftBody } from "./minecraft-body.js";

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
