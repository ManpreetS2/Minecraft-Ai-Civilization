import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
/** Explicit operator command: GitHub metadata only. Never checks out, fetches, merges or modifies refs. */
const repositories = [
  { repository: "ManpreetS2/Minecraft-Ai-Civilization", numbers: [12, 13, 14] },
  { repository: "ManpreetS2/Minecraft-Ai-Civilization-windows-backup", numbers: [25, 27, 29, 32, 37, 42, 43, 47, 48, 50] },
];
const records = [];
for (const { repository, numbers } of repositories) for (const number of numbers) {
  const response = JSON.parse(execFileSync("gh", ["pr", "view", String(number), "--repo", repository, "--json", "number,url,headRefName,headRefOid,baseRefName,baseRefOid,state,files"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as { number: number; url: string; headRefName: string; headRefOid: string; baseRefName: string; baseRefOid: string; state: string; files: { path: string }[] };
  records.push({ repository, number: response.number, url: response.url, headRefName: response.headRefName, headRefOid: response.headRefOid, baseRefName: response.baseRefName, baseRefOid: response.baseRefOid, state: response.state, changedPaths: response.files.map((f) => f.path), capturedAt: new Date().toISOString() });
}
writeFileSync(new URL("./published-refs.json", import.meta.url), JSON.stringify(records, null, 2) + "\n");
console.log(`Recorded ${records.length} published PR references. Local Git objects must be available separately.`);
