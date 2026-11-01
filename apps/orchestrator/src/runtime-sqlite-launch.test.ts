import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  linkSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManager, CivilizationStore } from "@civ/agent-core";
import { loadConfig } from "@civ/shared";
import { main } from "./index.js";
const tracking = vi.hoisted(() => ({ opens: [] as string[], paperCalls: 0 }));
vi.mock("better-sqlite3", async (original) => {
  const actual = await original<{ default: typeof Database }>();
  return {
    ...actual,
    default: class extends actual.default {
      constructor(...args: ConstructorParameters<typeof actual.default>) {
        tracking.opens.push(String(args[0]));
        super(...args);
      }
    },
  };
});
vi.mock("./env.js", () => ({ loadEnv: () => undefined }));
vi.mock("./paper.js", () => ({
  ensurePaper: async () => {
    tracking.paperCalls += 1;
    throw new Error("network operation reached");
  },
}));
const dirs: string[] = [];
const stores: CivilizationStore[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "t3-sqlite-launch-"));
  dirs.push(dir);
  return dir;
}
function refuse(path: string) {
  tracking.opens.length = 0;
  let manager: AgentManager | undefined;
  try {
    expect(() => {
      manager = new AgentManager(loadConfig({ DATABASE_PATH: path, LLM_ENABLED: "false" }));
    }).toThrow(/filename|containment/i);
  } finally {
    if (manager?.store.isOpen()) manager.store.close();
  }
  expect(tracking.opens).toEqual([]);
}
afterEach(() => {
  for (const s of stores.splice(0)) if (s.isOpen()) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  tracking.opens.length = 0;
  tracking.paperCalls = 0;
  vi.restoreAllMocks();
});

describe("actual runtime refuses mutable filename SQLite launch", () => {
  it("refuses before creating a missing database or any SQLite sidecar", () => {
    const dir = fixture();
    const target = join(dir, "new.sqlite");
    refuse(target);
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      expect(existsSync(target + suffix)).toBe(false);
  });
  it("refuses a replaced database before the real SQLite constructor is invoked", () => {
    const dir = fixture();
    const target = join(dir, "run.sqlite");
    const replacement = join(dir, "replacement.sqlite");
    writeFileSync(target, "original identity");
    renameSync(target, replacement);
    writeFileSync(target, "replacement identity");
    refuse(target);
    expect(readFileSync(target, "utf8")).toBe("replacement identity");
    expect(readFileSync(replacement, "utf8")).toBe("original identity");
  });
  it.each(["-wal", "-shm", "-journal"])("refuses a sidecar alias %s before any open", (suffix) => {
    const dir = fixture();
    const target = join(dir, "run.sqlite");
    const source = join(dir, "protected-fixture.sqlite");
    const raw = new Database(target);
    raw.close();
    writeFileSync(source, "protected fixture sentinel");
    linkSync(source, target + suffix);
    refuse(target);
    expect(readFileSync(source, "utf8")).toBe("protected fixture sentinel");
  });
  it("refuses a multi-linked main database and repeated launch/handoff attempts", () => {
    const dir = fixture();
    const source = join(dir, "source.sqlite");
    const target = join(dir, "alias.sqlite");
    const raw = new Database(source);
    raw.close();
    linkSync(source, target);
    const before = readFileSync(source);
    refuse(target);
    refuse(target);
    expect(readFileSync(source)).toEqual(before);
  });
  it("refuses redirected mutable parents, including a recreated protected root", () => {
    const dir = fixture();
    const original = join(dir, "original");
    const moved = join(dir, "moved");
    const alias = join(dir, "alias");
    // All roots are disposable fixtures; no production path is opened.
    const s = new CivilizationStore(join(original, "fixture.sqlite"));
    s.close();
    renameSync(original, moved);
    symlinkSync(moved, alias, process.platform === "win32" ? "junction" : "dir");
    refuse(join(alias, "fixture.sqlite"));
    refuse(join(original, "fixture.sqlite"));
  });
  it("keeps explicitly injected offline SQLite fixtures usable across close/reopen", () => {
    const dir = fixture();
    const path = join(dir, "offline.sqlite");
    const a = new CivilizationStore(path);
    a.setMeta("offline", "preserved");
    a.close();
    const b = new CivilizationStore(path);
    stores.push(b);
    expect(b.getMeta("offline")).toBe("preserved");
    const manager = new AgentManager(loadConfig({ LLM_ENABLED: "false" }), b);
    expect(manager.store).toBe(b);
  });
  it("accepts a true in-memory connection without filename or sidecars", () => {
    const manager = new AgentManager(
      loadConfig({ DATABASE_PATH: ":memory:", LLM_ENABLED: "false" }),
    );
    stores.push(manager.store);
    const databases = manager.store.db.pragma("database_list") as Array<{
      name: string;
      file: string;
    }>;
    expect(databases.find((d) => d.name === "main")?.file).toBe("");
    expect(manager.store.db.pragma("journal_mode", { simple: true })).toBe("memory");
  });
  it("refuses the actual application entrypoint before Paper, RCON or SQLite", async () => {
    tracking.opens.length = 0;
    await expect(main()).rejects.toThrow(/containment|launch disabled/i);
    expect(tracking.paperCalls).toBe(0);
    expect(tracking.opens).toEqual([]);
  });
});
