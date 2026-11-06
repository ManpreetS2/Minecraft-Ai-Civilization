import { readFileSync } from "node:fs";
import { validateBundleWithJournal } from "./journal-cross-check.js";
import type { RunBundle } from "./manifest.js";

// Positional arguments deliberately keep the operator's original separate from receipt paths.
export function checkJournal(args: string[]) {
  const [manifestPath, expectedSourceSha, expectedRepository, evidenceRoot, journal] = args;
  if (!manifestPath || !expectedSourceSha || !expectedRepository || args.length > 5)
    throw new Error(
      "Usage: pnpm v1:journal <manifest.json> <full-source-sha> <repository> [evidence-root] [original-journal-relative-to-root]",
    );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RunBundle;
  const result = validateBundleWithJournal({
    manifest,
    expectedSourceSha,
    expectedRepository,
    evidenceRoot,
    operatorJournal: journal
      ? {
          reference: journal,
          runId: manifest.runId,
          sourceSha: expectedSourceSha,
          repository: expectedRepository,
        }
      : undefined,
  });
  return {
    ...result,
    status:
      result.verdict === "FAIL"
        ? "FAIL"
        : result.journalConsistent
          ? "JOURNAL CONSISTENT"
          : "NOT PROVEN",
    authenticatedLiveExecution: false,
    exitCode: result.verdict === "FAIL" ? 1 : result.journalConsistent ? 0 : 2,
  };
}
