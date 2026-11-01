import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonFileSessionStore } from "./store-file.js";
import { createConstantClock, createIdFactory, cfg, keyRef, makeRegistry, providerCases, settle, errorCode } from "./test-helpers.js";
import type { ProviderId, SessionSnapshot } from "./types.js";

const tmpDirs: string[] = [];
async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "civ-sess-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function threeTurnsTwoNotes(h: ReturnType<typeof makeRegistry>, id: ProviderId, sessionId = "s-a", key: "A" | "B" = "A") {
  const s = h.registry.open(cfg({ provider: id, sessionId, apiKeyRef: keyRef(key, id) }));
  s.remember("note one");
  s.remember("note two");
  for (const n of [1, 2, 3]) await s.send({ content: `turn ${n}` });
  return s;
}

describe.each(providerCases())("persistence & restore ($id)", ({ id }) => {
  it("AT-16 snapshot round-trip through a shared store deep-equals the original, integrity included", async () => {
    const h1 = makeRegistry();
    const original = await threeTurnsTwoNotes(h1, id);
    await h1.registry.persist("s-a");
    const h2 = makeRegistry({ store: h1.store }); // new adapters, same store
    const restored = await h2.registry.restore("s-a");
    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(restored.snapshot().turn).toBe(3);
    expect(restored.snapshot().memory).toEqual(["note one", "note two"]);
    expect(restored.snapshot().requestsUsed).toBe(3);
  });

  it("AT-17 behavioural fidelity: the restored session builds the byte-identical next request", async () => {
    const clock = createConstantClock();
    const h1 = makeRegistry({ clock, ids: createIdFactory() });
    const original = await threeTurnsTwoNotes(h1, id);
    await h1.registry.persist("s-a");
    const h2 = makeRegistry({ store: h1.store, clock, ids: createIdFactory(3) }); // same counter position
    const restored = await h2.registry.restore("s-a");
    const [r1, r2] = [await original.send({ content: "next" }), await restored.send({ content: "next" })];
    const originalCall = h1.adapterFor(id).calls[3];
    const restoredCall = h2.adapterFor(id).calls[0];
    expect(restoredCall).toBeDefined();
    expect(restoredCall).toEqual(originalCall);
    expect(restoredCall?.messages).toHaveLength(7);
    expect(restoredCall?.system).toBe("SYS-A\n\n[memory]\n- note one\n- note two");
    expect(r2).toEqual(r1);
  });

  it("AT-20 file store: save/load/list/delete round-trip, atomic, and no secret value on disk", async () => {
    const dir = await tmp();
    const store = createJsonFileSessionStore(dir);
    const h = makeRegistry({ store });
    await threeTurnsTwoNotes(h, id);
    await h.registry.persist("s-a");
    const saved = h.registry.get("s-a")!.snapshot();
    expect(await store.load("s-a")).toEqual(saved);
    expect(await store.list()).toEqual(["s-a"]);
    const names = await readdir(dir);
    expect(names).toEqual(["s-a.json"]);
    expect(names.some((name) => name.endsWith(".tmp"))).toBe(false);
    const raw = await readFile(join(dir, "s-a.json"), "utf8");
    expect(raw).not.toContain("sk-test-");
    expect(raw).not.toContain("sk-ant-");
    expect(raw).toContain("KEY_A_"); // the REFERENCE is stored
    await store.delete("s-a");
    expect(await store.load("s-a")).toBeUndefined();
    await expect(store.delete("s-a")).resolves.toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("AT-21 tamper and corruption are detected, and a failed restore registers nothing", async () => {
    const dir = await tmp();
    const store = createJsonFileSessionStore(dir);
    const h = makeRegistry({ store });
    await threeTurnsTwoNotes(h, id);
    await h.registry.persist("s-a");
    const file = join(dir, "s-a.json");
    const pristine = await readFile(file, "utf8");

    const attempts: Array<[string, (text: string) => string, string]> = [
      ["edited history char", (t) => t.replace("turn 1", "turn X"), "SNAPSHOT_CORRUPT"],
      ["truncated JSON", (t) => t.slice(0, Math.floor(t.length / 2)), "SNAPSHOT_CORRUPT"],
      ["schemaVersion 2", (t) => t.replace('"schemaVersion":1', '"schemaVersion":2'), "SNAPSHOT_VERSION"],
      ["edited memory note", (t) => t.replace("note one", "note 0ne"), "SNAPSHOT_CORRUPT"],
      ["edited turn counter", (t) => t.replace('"turn":3', '"turn":9'), "SNAPSHOT_CORRUPT"],
    ];
    for (const [label, mutate, code] of attempts) {
      const mutated = mutate(pristine);
      expect(mutated, label).not.toBe(pristine);
      await writeFile(file, mutated, "utf8");
      const fresh = makeRegistry({ store });
      const result = await settle(fresh.registry.restore("s-a"));
      expect(errorCode(result), label).toBe(code);
      expect(fresh.registry.get("s-a"), label).toBeUndefined();
    }
    await writeFile(file, pristine, "utf8");
    const ok = makeRegistry({ store });
    expect((await settle(ok.registry.restore("s-a"))).ok).toBe(true);
  });

  it("AT-21 a snapshot copied under another session's filename is rejected", async () => {
    const dir = await tmp();
    const store = createJsonFileSessionStore(dir);
    const h = makeRegistry({ store });
    await threeTurnsTwoNotes(h, id);
    await h.registry.persist("s-a");
    await writeFile(join(dir, "s-b.json"), await readFile(join(dir, "s-a.json"), "utf8"), "utf8");
    const fresh = makeRegistry({ store });
    expect(errorCode(await settle(fresh.registry.restore("s-b")))).toBe("SNAPSHOT_CORRUPT");
    expect(fresh.registry.get("s-b")).toBeUndefined();
  });

  it("AT-22 restore needs the session's own secret; restoring A never loads or exposes B", async () => {
    const h1 = makeRegistry();
    await threeTurnsTwoNotes(h1, id, "s-a", "A");
    await threeTurnsTwoNotes(h1, id, "s-b", "B");
    await h1.registry.persist("s-a");
    await h1.registry.persist("s-b");

    const noKeys = makeRegistry({ store: h1.store, secrets: {} });
    const missing = await settle(noKeys.registry.restore("s-a"));
    expect(errorCode(missing)).toBe("SECRET_MISSING");
    const message = String((!missing.ok && (missing.error as Error).message) || "");
    expect(message).toContain(`KEY_A_${id.toUpperCase()}`);
    expect(message).not.toMatch(/sk-/);
    expect(noKeys.registry.get("s-a")).toBeUndefined();

    const withKeys = makeRegistry({ store: h1.store });
    const a = await withKeys.registry.restore("s-a");
    expect(a.id).toBe("s-a");
    expect(withKeys.registry.get("s-b")).toBeUndefined();
    expect(JSON.stringify(a.snapshot())).not.toContain("s-b");
    expect(errorCode(await settle(withKeys.registry.restore("does-not-exist")))).toBe("STORE_ERROR");
    expect(errorCode(await settle(withKeys.registry.restore("s-a")))).toBe("CONFIG_INVALID"); // already open
  });

  it("AT-22 path-traversal ids are rejected by open() and by the file store", async () => {
    const dir = await tmp();
    const store = createJsonFileSessionStore(dir);
    const h = makeRegistry({ store });
    for (const bad of ["../x", "a/b", "..", "a\\b", "/etc/passwd", "UPPER", ""]) {
      expect(() => h.registry.open(cfg({ provider: id, sessionId: bad })), bad).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
      expect(errorCode(await settle(store.load(bad))), bad).toBe("CONFIG_INVALID");
      expect(errorCode(await settle(store.delete(bad))), bad).toBe("CONFIG_INVALID");
      expect(errorCode(await settle(h.registry.restore(bad))), bad).toBe("CONFIG_INVALID");
    }
    const snapshot: SessionSnapshot = { ...(await threeTurnsTwoNotes(h, id)).snapshot(), sessionId: "../escape" };
    expect(errorCode(await settle(store.save(snapshot)))).toBe("CONFIG_INVALID");
    expect(await readdir(dir)).toEqual([]);
    expect(await readdir(join(dir, ".."))).not.toContain("escape.json");
  });
});
