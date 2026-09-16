import { describe, expect, it } from "vitest";
import { ClaimBoard, ReservationBook, cellClaimKey } from "./claims.js";

describe("resource reservations", () => {
  it("keeps reserved planks out of the available pool", () => {
    const book = new ReservationBook();
    book.reserve("citizen_atlas", "construction", "oak_planks", 20, 60_000, 1000);
    expect(book.reservedOf("oak_planks", 1000)).toBe(20);
    expect(book.available("oak_planks", 34, 1000)).toBe(14);
  });

  it("releases reservations on expiry, owner death, and project completion", () => {
    const book = new ReservationBook();
    const hold = book.reserve("citizen_maya", "tool_crafting", "stick", 4, 50, 0);
    expect(book.release(hold.id)).toBe(true);
    book.reserve("citizen_maya", "construction", "oak_planks", 8, 50, 0);
    expect(book.releaseOwner("citizen_maya")).toBe(1);
    book.reserve("citizen_kai", "construction", "oak_planks", 8, 50, 0);
    expect(book.releasePurpose("construction")).toBe(1);
    book.reserve("citizen_ava", "food_emergency", "bread", 2, 10, 0);
    expect(book.expire(50)).toBe(1);
  });
});

describe("task claims", () => {
  it("prevents two citizens claiming the same cell and expires stale claims", () => {
    const board = new ClaimBoard();
    const key = cellClaimKey(10.2, 64, 4.8);
    expect(board.tryClaim("tree", key, "citizen_atlas", 100, 0)).toBe(true);
    expect(board.tryClaim("tree", key, "citizen_theo", 100, 0)).toBe(false);
    expect(board.ownerOf("tree", key, 0)).toBe("citizen_atlas");
    expect(board.expire(200)).toBe(1);
    expect(board.tryClaim("tree", key, "citizen_theo", 100, 200)).toBe(true);
  });

  it("releases claims when a citizen dies", () => {
    const board = new ClaimBoard();
    board.tryClaim("block", "1,70,1", "citizen_ava", 1000, 0);
    expect(board.releaseOwner("citizen_ava")).toBe(1);
    expect(board.ownerOf("block", "1,70,1", 0)).toBeUndefined();
  });
});
