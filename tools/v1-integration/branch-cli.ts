import { readFileSync, writeFileSync } from "node:fs";
import { inspectBranches, gitReader, type BranchInput, type Ownership } from "./branches.js";
interface PublishedRef { repository: string; number: number; headRefOid: string; baseRefOid: string; headRefName: string; url: string }
const published = JSON.parse(readFileSync(new URL("./published-refs.json", import.meta.url), "utf8")) as PublishedRef[];
const dependencies: Record<string, string[]> = { "original#13": ["original#12"], "original#14": ["original#13"], "windows#29": ["windows#27"], "windows#37": ["windows#29"], "windows#42": ["windows#32"], "windows#43": ["windows#37"], "windows#48": ["windows#37"], "windows#50": ["original#14"] };
const inputs: BranchInput[] = published.map((p) => {
  const id = `${p.repository.endsWith("-windows-backup") ? "windows" : "original"}#${p.number}`;
  return { id, ref: p.headRefOid, base: p.baseRefOid, dependencies: dependencies[id] ?? [], owner: null };
});
const ownership = JSON.parse(readFileSync(new URL("./ownership.json", import.meta.url), "utf8")) as Ownership[];
const report = { ...inspectBranches(inputs, gitReader(process.cwd()), ownership), publishedReferences: published.map(({ url, headRefOid }) => ({ url, headRefOid })),
  semanticReview: ["Provider retries #32/#42 require nonauthor review", "Movement and construction guards require owner handoff", "Validator #47 broad comparison requires owner scoping", "PR #50 chest regressions must rerun on integrated source", "Direct merge conflicts are not tested by this tool"] };
const output = process.argv[2];
const bytes = JSON.stringify(report, null, 2) + "\n";
if (output) writeFileSync(output, bytes); else process.stdout.write(bytes);
if (report.blockers.length) process.exitCode = 1;
