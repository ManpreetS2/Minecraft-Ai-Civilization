import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConstructionEvidenceLog, inventoryDelta } from "./construction-evidence.js";

describe("construction evidence logging", () => {
  it("records intended vs observed phases without inventing liveSession", () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-evidence-"));
    try {
      const log = createConstructionEvidenceLog({
        dir,
        experimentId: "test-exp",
        liveSession: false,
      });
      log.append({
        stage: "stage1_one_block",
        phase: "intended",
        citizenId: "citizen_atlas",
        intendedPlacement: { item: "oak_planks", position: { x: 1, y: 70, z: 1 } },
        preInventory: { oak_planks: 5 },
      });
      log.append({
        stage: "stage1_one_block",
        phase: "observed",
        observedBlock: { name: "oak_planks", position: { x: 1, y: 70, z: 1 } },
        postInventory: { oak_planks: 4 },
        inventoryDelta: inventoryDelta({ oak_planks: 5 }, { oak_planks: 4 }),
        verified: { ok: true, detail: "offline fixture only" },
      });
      const lines = readFileSync(log.path, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(lines).toHaveLength(2);
      expect(lines[0].phase).toBe("intended");
      expect(lines[0].liveSession).toBe(false);
      expect(lines[1].inventoryDelta.oak_planks).toBe(-1);
      expect(lines[1].liveSession).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("inventoryDelta only reports changed keys", () => {
    expect(inventoryDelta({ a: 1, b: 2 }, { a: 1, b: 1, c: 3 })).toEqual({ b: -1, c: 3 });
  });
});
