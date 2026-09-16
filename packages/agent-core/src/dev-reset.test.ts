import { describe, expect, it } from "vitest";
import { parseResetArgs, resetDevelopmentState } from "./dev-reset.js";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("dev reset safety", () => {
  it("refuses to delete anything without --yes", () => {
    const flags = parseResetArgs([]);
    expect(flags.yes).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "civ-reset-"));
    const dbPath = join(dir, "civilization.sqlite");
    writeFileSync(dbPath, "keep");
    const result = resetDevelopmentState({ yes: false, world: false, dbPath, worldDir: join(dir, "world") });
    expect(result.ok).toBe(false);
    expect(existsSync(dbPath)).toBe(true);
    expect(result.deleted).toEqual([]);
  });

  it("deletes the development database only when --yes is passed, leaving the world unless --world", () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-reset-"));
    const dbPath = join(dir, "civilization.sqlite");
    const worldDir = join(dir, "world");
    writeFileSync(dbPath, "db");
    writeFileSync(join(dir, "world-marker.txt"), "world stays");
    const result = resetDevelopmentState({ yes: true, world: false, dbPath, worldDir });
    expect(result.ok).toBe(true);
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(join(dir, "world-marker.txt"))).toBe(true);
  });
});
