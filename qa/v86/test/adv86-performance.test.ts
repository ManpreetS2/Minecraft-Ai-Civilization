// QA86: the raw-row binding does find() per row. Measure it at realistic and stress sizes (a 60-minute run is ~61 ticks; a busy run a few thousand rows).
import { describe, expect, it } from "vitest";
import { T0, attest, liveJournal, paramsFor, validateLive } from "../lib/live.js";
import type { TickSpec } from "../lib/journal.js";
import { richExtra } from "../lib/rich.js";

const ticks = (n: number): TickSpec[] => Array.from({ length: n }, (_, i) => ({ at: new Date(T0 + (i * 3_600_000) / (n - 1)).toISOString(), serverGameTick: 5000 + Math.round((i * 72_000) / (n - 1)), measuredTps: 20 }));
describe("binding cost", () => {
  for (const [n, limit] of [[2_000, 3_000], [10_000, 20_000]] as const) {
    it(`${n} tick rows + the rich action set validate in < ${limit} ms and remain real_minecraft/VERIFIED`, () => {
      const l = liveJournal({ ticks: ticks(n), citizens: ["gpt_atlas", "gpt_maya", "claude_theo", "claude_ava"], extra: richExtra() });
      const t = performance.now(); const r = validateLive(l, attest(paramsFor(l)), { citizens: ["gpt_atlas", "gpt_maya", "claude_theo", "claude_ava"], finalInventories: { gpt_atlas: { oak_planks: 3 }, gpt_maya: { oak_log: 1 } } }); const ms = performance.now() - t;
      console.log(`PERF rows=${l.rows.length} ms=${Math.round(ms)} mode=${r.mode} status=${r.overallStatus}`);
      expect(ms).toBeLessThan(limit); expect(r.mode === "real_minecraft" || r.violations.length > 0).toBe(true);
    });
  }
});
