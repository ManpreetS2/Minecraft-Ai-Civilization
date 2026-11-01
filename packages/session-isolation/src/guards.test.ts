import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cfg, keyRef, makeRegistry, providerCases, settle } from "./test-helpers.js";
import { createJsonFileSessionStore } from "./store-file.js";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));

/** Every non-test source file in this package (test-helpers.ts included on purpose). */
function sourceFiles(): Array<{ name: string; text: string }> {
  return readdirSync(here)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(here, name), "utf8") }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("static guards", () => {
  it("scans the files it claims to scan", () => {
    const names = sourceFiles().map((f) => f.name);
    for (const required of ["session.ts", "registry.ts", "mock-gpt-adapter.ts", "mock-claude-adapter.ts", "store-file.ts", "test-helpers.ts"]) {
      expect(names).toContain(required);
    }
  });

  it("AT-15 no module-level mutable state", () => {
    const patterns: RegExp[] = [
      /^(let|var)\s/m,
      /^(export\s+)?const\s+\w+\s*=\s*new\s+(Map|Set|WeakMap|Array)\b/m,
      /^(export\s+)?const\s+\w+(\s*:\s*[^=]+)?\s*=\s*(\[\]|\{\})\s*;?\s*$/m,
    ];
    for (const file of sourceFiles()) {
      for (const pattern of patterns) expect(file.text, `${file.name} ${pattern}`).not.toMatch(pattern);
    }
  });

  it("AT-15 the guard patterns really catch what they claim to (self-check)", () => {
    const sample = ["let x = 1;", "const m = new Map();", "export const bag = {};", "const list: string[] = [];"];
    const patterns: RegExp[] = [
      /^(let|var)\s/m,
      /^(export\s+)?const\s+\w+\s*=\s*new\s+(Map|Set|WeakMap|Array)\b/m,
      /^(export\s+)?const\s+\w+(\s*:\s*[^=]+)?\s*=\s*(\[\]|\{\})\s*;?\s*$/m,
    ];
    for (const line of sample) expect(patterns.some((p) => p.test(line)), line).toBe(true);
  });

  it("AT-15 exported factories hand out frozen allowlists", () => {
    for (const { make } of providerCases()) expect(Object.isFrozen(make().allowedModels)).toBe(true);
  });

  it("AT-24 no network primitives, vendor URLs, randomness or wall-clock reads in non-test source", () => {
    const forbidden = /node:(http|https|net|tls|dns|dgram|child_process|worker_threads)|from\s+["'](http|https|net|tls|dns)["']|\bfetch\s*\(|XMLHttpRequest|WebSocket|api\.openai\.com|api\.anthropic\.com/;
    for (const file of sourceFiles()) {
      expect(file.text, file.name).not.toMatch(forbidden);
      expect(file.text, file.name).not.toMatch(/Math\.random|Date\.now\s*\(/);
    }
  });

  it("AT-24 the network guard pattern catches what it claims to (self-check)", () => {
    const forbidden = /node:(http|https|net|tls|dns|dgram|child_process|worker_threads)|from\s+["'](http|https|net|tls|dns)["']|\bfetch\s*\(|XMLHttpRequest|WebSocket|api\.openai\.com|api\.anthropic\.com/;
    for (const sample of ['import x from "node:https";', 'await fetch ("u")', "new WebSocket(u)", "https://api.openai.com/v1", "https://api.anthropic.com"]) {
      expect(forbidden.test(sample), sample).toBe(true);
    }
  });

  it("AT-25 no restricted-file coupling: no imports of executor/manager/collect, no workspace dependencies", () => {
    for (const file of sourceFiles()) {
      const specifiers = [...file.text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
      for (const specifier of specifiers) {
        expect(specifier, file.name).not.toMatch(/executor|manager|collect/);
        expect(specifier, file.name).not.toMatch(/^@civ\/(agent-core|skills|cognition)/);
        expect(specifier.startsWith("@civ/"), `${file.name} imports ${specifier}`).toBe(false);
      }
    }
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as Record<string, unknown>;
    const deps = { ...(pkg["dependencies"] as object | undefined), ...(pkg["devDependencies"] as object | undefined) };
    expect(Object.keys(deps)).toEqual([]);
  });
});

describe.each(providerCases())("AT-23 no network at runtime ($id)", ({ id }) => {
  it("a full flow (open, send, remember, persist, restore, cancel, timeout) never calls fetch or opens sockets", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("network forbidden");
    });
    const socketLike = (): number => process.getActiveResourcesInfo().filter((name) => /TCP|UDP|TLS/i.test(name)).length;
    const socketsBefore = socketLike();
    const dir = mkdtempSync(join(tmpdir(), "civ-sess-"));
    try {
      vi.useFakeTimers();
      const store = createJsonFileSessionStore(dir);
      const h = makeRegistry({ store, gpt: { delayMs: 200 }, claude: { delayMs: 200 } });
      const s = h.registry.open(cfg({ provider: id, sessionId: "s-a", limits: { timeoutMs: 1000, maxOutputTokens: 64, maxRequests: 10, maxHistoryMessages: 20 } }));
      s.remember("note");
      const ok = settle(s.send({ content: "hello" }));
      await vi.advanceTimersByTimeAsync(200);
      expect((await ok).ok).toBe(true);

      const cancelled = settle(s.send({ content: "cancel me" }));
      s.cancel();
      await vi.advanceTimersByTimeAsync(200);
      expect((await cancelled).ok).toBe(false);

      const slow = makeRegistry({ gpt: { delayMs: 5000 }, claude: { delayMs: 5000 } });
      const t = slow.registry.open(cfg({ provider: id, apiKeyRef: keyRef("A", id) }));
      const timedOut = settle(t.send({ content: "slow" }));
      await vi.advanceTimersByTimeAsync(1000);
      expect((await timedOut).ok).toBe(false);

      vi.useRealTimers();
      await h.registry.persist("s-a");
      const h2 = makeRegistry({ store });
      const restored = await h2.registry.restore("s-a");
      expect(restored.snapshot().turn).toBe(1);
      h.registry.closeAll();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(socketLike()).toBeLessThanOrEqual(socketsBefore);
  });
});
