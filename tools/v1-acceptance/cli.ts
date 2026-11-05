import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate, markdown } from './engine.js';
import type { EvaluationInput } from './engine.js';
const path = process.argv[2];
if (!path) { console.error('Usage: tsx tools/v1-acceptance/cli.ts <evaluation.json> [output-prefix]'); process.exitCode = 2; }
else {
  try {
    const result = evaluate(JSON.parse(readFileSync(path, 'utf8')) as EvaluationInput);
    const json = JSON.stringify(result, null, 2) + '\n';
    const prefix = process.argv[3];
    if (prefix) { writeFileSync(`${prefix}.json`, json); writeFileSync(`${prefix}.md`, markdown(result)); }
    else process.stdout.write(json);
    if (result.offline.measurement !== 'MEASURABLE' || result.live.measurement !== 'MEASURABLE' || result.results.some(r => (r.offline !== null && r.offline.verdict !== 'PASS') || (r.live !== null && r.live.verdict !== 'PASS'))) process.exitCode = 1;
  } catch (error) { console.error('Evaluation failed:', error); process.exitCode = 1; }
}
