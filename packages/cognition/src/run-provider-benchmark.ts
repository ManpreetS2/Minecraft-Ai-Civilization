import { runProviderBenchmark } from "./provider-benchmark.js";

const force = process.env.COGNITION_BENCH_FORCE === "true";
const wantCloud = process.env.COGNITION_BENCH_CLOUD === "true";
const allowAuto = process.env.COGNITION_BENCH_ALLOW_AUTO === "true";

async function ollamaBusy(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/ps", { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const body = (await response.json()) as { models?: Array<{ name?: string; size?: number }> };
    return (body.models ?? []).length > 0;
  } catch {
    return false;
  }
}

const busy = await ollamaBusy();
const runLocal = force || !busy;
if (busy && !force) {
  console.log("Ollama already has a loaded model; skipping live local bakeoff. Set COGNITION_BENCH_FORCE=true to override.");
}

const result = await runProviderBenchmark({
  runLocal,
  runCloud: wantCloud,
  allowAuto,
});
console.log(result.markdown);
if (!runLocal || !wantCloud) {
  console.log("Live comparison incomplete. This does not rank backends.");
}
