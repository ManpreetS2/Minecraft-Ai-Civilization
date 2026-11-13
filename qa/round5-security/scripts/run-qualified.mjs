/* global setTimeout, clearTimeout, console, process */
// QA-only launcher reproducing the PR #150 author's stated qualification: fork execArgv --stack-size=8192, config unchanged.
import { startVitest } from "vitest/node";
const t = setTimeout(() => { console.log("QUALIFIED_RUN timeout"); process.exit(3); }, 240_000);
const vi = await startVitest("test", [], { config: process.argv[2], pool: "forks", poolOptions: { forks: { execArgv: ["--stack-size=8192"] } }, run: true, watch: false }, {});
const files = vi.state.getFiles(); const tests = files.flatMap((f) => f.tasks.flatMap(function w(t) { return t.tasks ? t.tasks.flatMap(w) : [t]; }));
const failed = tests.filter((x) => x.result?.state === "fail").length, passed = tests.filter((x) => x.result?.state === "pass").length;
console.log(`QUALIFIED_RUN config=${process.argv[2]} passed=${passed} failed=${failed} total=${tests.length}`); clearTimeout(t); await vi.close(); process.exit(failed ? 1 : 0);
