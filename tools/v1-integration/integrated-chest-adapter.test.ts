import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail } from "@civ/shared";
import { withdrawItems } from "@civ/skills";
import { runChestRegressions } from "./regressions.js";
import { createIntegratedChestAdapter } from "./integrated-chest-adapter.js";

vi.mock("@civ/skills", async (original) => ({
  ...(await original<typeof import("@civ/skills")>()),
  depositItems: vi.fn(),
  withdrawItems: vi.fn(),
}));

describe("integrated chest regression adapter (real store/executor)", () => {
  beforeEach(() => {
    vi.mocked(withdrawItems).mockReset();
  });

  it("passes former-owner, former-grantee, and failed-withdrawal on the integrated candidate", async () => {
    const adapter = createIntegratedChestAdapter({
      stubEmptyWithdraw: () => {
        vi.mocked(withdrawItems).mockResolvedValue(fail("VERIFY_FAILED", "chest holds no bread", 1, true));
      },
    });
    const results = await runChestRegressions(adapter);
    expect(results).toEqual([
      { id: "former-owner", verdict: "PASS", detail: "Adapter assertions satisfied" },
      { id: "former-grantee", verdict: "PASS", detail: "Adapter assertions satisfied" },
      { id: "failed-withdrawal", verdict: "PASS", detail: "Adapter assertions satisfied" },
    ]);
  });
});
