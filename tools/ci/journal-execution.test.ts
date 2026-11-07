import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { checkJournalCliIntegration } from "./offline-acceptance-verifier.js";
const historical = resolve("docs/evidence/offline-integration/1v1");
const sha = JSON.parse(readFileSync(join(historical, "manifest.json"), "utf8")).sourceSha;
it("executes the real journal CLI and its forged/missing controls without mutating original artifacts", () => {
  const before = readFileSync(join(historical, "manifest.json"), "utf8");
  const result = checkJournalCliIntegration(process.cwd(), historical, sha);
  expect(result).toMatchObject({
    status: "READY",
    executed: true,
    forgedReceiptTestPassed: true,
    exitCodes: { consistent: 0, missingRoot: 2, missingJournal: 2, forged: 1 },
  });
  expect(readFileSync(join(historical, "manifest.json"), "utf8")).toBe(before);
}, 30_000);
it("refuses to report verification success when the real journal CLI rejects the input", () => {
  const temporary = mkdtempSync(join(tmpdir(), "ci-journal-reject-"));
  try {
    const root = join(temporary, "evidence");
    cpSync(historical, root, { recursive: true });
    const path = join(root, "operator.jsonl");
    writeFileSync(path, readFileSync(path, "utf8").replace('"mode":"offline"', '"mode":"live"'));
    expect(checkJournalCliIntegration(process.cwd(), root, sha)).toMatchObject({
      status: "FAILED",
      executed: true,
      exitCodes: { consistent: 1 },
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 30_000);
