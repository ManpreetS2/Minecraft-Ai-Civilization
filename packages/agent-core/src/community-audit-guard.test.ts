import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SEC-001 architecture guard: community membership is writable only through the orchestrator-config path.
 * Only the store (the mutators themselves) and community-config.ts may call them in production code, so nothing an
 * LLM, a tool or an HTTP handler reaches can change who belongs to which community.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MUTATORS = [".addCommunityMember(", ".removeCommunityMember(", ".upsertCommunity("];
const ALLOWED = new Set(["packages/agent-core/src/store.ts", "packages/agent-core/src/community-config.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.test\.ts$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

describe("SEC-001 community mutators are orchestrator-only", () => {
  it("no production file outside store.ts / community-config.ts calls a community mutator", () => {
    const files = [...walk(join(ROOT, "apps")), ...walk(join(ROOT, "packages"))];
    expect(files.length).toBeGreaterThan(50); // the scan really ran
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      for (const m of MUTATORS) if (text.includes(m)) offenders.push(`${rel}: ${m}`);
    }
    expect(offenders).toEqual([]);
  });
  it("the config seed is the only production caller, and it passes an orchestrator-config audit", () => {
    const text = readFileSync(join(ROOT, "packages/agent-core/src/community-config.ts"), "utf8");
    for (const m of MUTATORS.slice(0, 1).concat(MUTATORS[2]!)) expect(text).toContain(m);
    expect(text).toContain('actor: "orchestrator-config"');
  });
  it("COMMUNITIES_JSON is read only by config loading and community-config.ts", () => {
    const files = [...walk(join(ROOT, "apps")), ...walk(join(ROOT, "packages"))];
    const readers = files
      .filter((f) => readFileSync(f, "utf8").includes("COMMUNITIES_JSON"))
      .map((f) => relative(ROOT, f).split("\\").join("/"))
      .sort();
    expect(readers).toEqual(["packages/agent-core/src/community-config.ts", "packages/shared/src/config.ts", "packages/shared/src/event-audience.ts"]);
  });
});
