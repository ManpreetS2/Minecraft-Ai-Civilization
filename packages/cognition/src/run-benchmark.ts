import { runBenchmark, writeBenchmarkArtifacts } from "./benchmark.js";

const result = await runBenchmark();
writeBenchmarkArtifacts(result.scores, result.markdown);
console.log(result.markdown);
console.log(`Wrote artifacts/cognition-benchmark.json (${result.scores.length} rows)`);
