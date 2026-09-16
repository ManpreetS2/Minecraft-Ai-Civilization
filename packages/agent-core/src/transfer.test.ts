import { describe, expect, it } from "vitest";
import { confirmTransfer } from "@civ/shared";

describe("verified item transfer", () => {
  it("requires both inventories to change", () => {
    expect(
      confirmTransfer({
        item: "bread",
        count: 1,
        giverBefore: 3,
        giverAfter: 2,
        receiverBefore: 0,
        receiverAfter: 1,
      }),
    ).toBe(true);
    expect(
      confirmTransfer({
        item: "bread",
        count: 1,
        giverBefore: 3,
        giverAfter: 3,
        receiverBefore: 0,
        receiverAfter: 1,
      }),
    ).toBe(false);
  });
});
