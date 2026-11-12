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


describe("container acquisition identities", () => {
  it("releases the cancelled acquisition and lets another citizen acquire immediately", () => {
    const board = new ClaimBoard();
    const token = board.acquire("container", "chest", "old", 30_000, 0)!;
    expect(board.releaseAcquisition("container", "chest", "old", token)).toBe(true);
    expect(board.acquire("container", "chest", "other", 30_000, 1)).toBeDefined();
  });
  it("never releases a same-owner refresh, a newer generation, or a different owner", () => {
    for (const replacement of ["same", "different"]) {
      const board = new ClaimBoard();
      const old = board.acquire("container", "chest", "same", 10, 0)!;
      const next = board.acquire("container", "chest", replacement, 100, replacement === "same" ? 1 : 11)!;
      expect(next).not.toBe(old);
      expect(board.releaseAcquisition("container", "chest", "same", old)).toBe(false);
      expect(board.ownerOf("container", "chest", 12)).toBe(replacement);
      expect(board.releaseAcquisition("container", "chest", replacement, next)).toBe(true);
    }
  });
  it("also invalidates tokens when legacy tryClaim refreshes the same owner", () => {
    const board = new ClaimBoard();
    const old = board.acquire("container", "chest", "same", 100, 0)!;
    board.tryClaim("container", "chest", "same", 100, 1);
    expect(board.releaseAcquisition("container", "chest", "same", old)).toBe(false);
    expect(board.releaseAcquisition("container", "chest", "other", old)).toBe(false);
  });
});
