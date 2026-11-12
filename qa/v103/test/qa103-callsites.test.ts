// QA103: corrected call-site tripwire (the QA88 original also scanned build output in packages/*/dist and failed after `pnpm build`; this copy excludes dist/node_modules).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const walk = (d: string, out: string[] = []): string[] => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "node_modules" && f !== "dist") walk(p, out); } else if (/\.ts$/.test(f) && !/\.(test|d)\.ts$/.test(f)) out.push(p); } return out; };
describe("chest-skill call sites (reviewed set) and the home-storage gate", () => {
  const root = join(process.cwd(), "packages");
  const files = [...new Set(walk(root).filter((f) => /\b(depositItems?|withdrawItems?)\(/.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length + 1).replaceAll("\\", "/")))].sort();
  it("the production files that call the chest skills are exactly the reviewed set", () => {
    expect(files).toEqual(["agent-core/src/executor.ts", "agent-core/src/home-ops.ts", "skills/src/farm.ts", "skills/src/fish-quota.ts", "skills/src/fish.ts", "skills/src/inventory-service.ts", "skills/src/inventory.ts", "skills/src/library.ts", "skills/src/mine.ts"]);
  });
  it("in home-ops every success event for a transfer is emitted only after a current-action check, and the claim release is conditional", () => {
    const src = readFileSync(join(root, "agent-core/src/home-ops.ts"), "utf8");
    expect(src).toMatch(/await depositItems\([^)]*\);\s*if \(!storageActionCurrent\(ctx\)\) return abandonedStorage[\s\S]*?createEvent\("ItemDeposited"/);
    expect(src).toMatch(/await withdrawItems\([^)]*\);\s*if \(!storageActionCurrent\(ctx\)\) return abandonedStorage[\s\S]*?createEvent\("ItemWithdrawn"/);
    expect(src).toMatch(/finally \{\s*if \(ctx.citizenId && acquisitionId\) \{\s*runtime\.claims\.releaseAcquisition/);
  });
});
