import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CivilizationStore } from "./store.js";

describe("CivilizationStore", () => {
  it("seeds five citizens and restores them", () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-"));
    const path = join(dir, "test.sqlite");
    const store = new CivilizationStore(path);
    const first = store.getCitizens();
    expect(first.map((c) => c.name)).toEqual(["Atlas", "Ava", "Kai", "Maya", "Theo"]);
    const atlas = first.find((c) => c.name === "Atlas");
    if (!atlas) throw new Error("missing Atlas");
    atlas.status = "online";
    atlas.currentGoal = "gather_wood";
    atlas.lastKnownPosition = { x: 1, y: 64, z: 2 };
    store.upsertCitizen(atlas);
    store.close();

    const restored = new CivilizationStore(path);
    const again = restored.getCitizen("citizen_atlas");
    expect(again?.status).toBe("online");
    expect(again?.currentGoal).toBe("gather_wood");
    expect(again?.lastKnownPosition).toEqual({ x: 1, y: 64, z: 2 });
    restored.close();
  });
});
