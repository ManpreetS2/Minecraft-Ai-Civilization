import { describe, expect, it } from "vitest";
import { ReservationBook } from "./claims.js";
import { deriveSettlementInventory, containerDelta } from "./inventory-view.js";

describe("settlement inventory view", () => {
  it("aggregates citizen and storage contents without double-counting reservations", () => {
    const book = new ReservationBook();
    book.reserve("citizen_atlas", "construction", "oak_planks", 10);
    const view = deriveSettlementInventory(
      [[{ name: "oak_log", count: 8 }, { name: "oak_planks", count: 6 }]],
      { oak_planks: 12, stick: 4, bread: 2 },
      book,
    );
    expect(view.logs).toBe(8);
    expect(view.planks).toBe(18);
    expect(view.sticks).toBe(4);
    expect(view.food).toBe(2);
    expect(view.availablePlanks).toBe(8);
  });

  it("accounts for real container deposits and withdrawals without inventing stock", () => {
    const delta = containerDelta({ oak_log: 2 }, { oak_log: 5, bread: 1 });
    expect(delta.deposited).toEqual({ oak_log: 3, bread: 1 });
    expect(delta.withdrawn).toEqual({});
    const out = containerDelta({ oak_log: 5, bread: 1 }, { oak_log: 4 });
    expect(out.withdrawn).toEqual({ oak_log: 1, bread: 1 });
  });
});
