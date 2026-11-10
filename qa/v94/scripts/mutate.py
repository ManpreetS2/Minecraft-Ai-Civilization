#!/usr/bin/env python3
"""Mutation check of the QA94 canonical-binding tests. Usage: mutate.py <disposable-worktree> <id>. ONE textual mutation of PR #94's validator in a
throwaway worktree (never the audited tree, never committed). Restore with `git checkout -- .` there."""
import sys, pathlib
wt = pathlib.Path(sys.argv[1]); mid = sys.argv[2]; F = "experiments/evidence-validator/src/validator.ts"
M = {
 "A-ignore-citizenId": ("  delete content.previousHash;\n", "  delete content.previousHash;\n  delete content.citizenId;\n"),
 "B-ignore-nested-hash-names": ("function canonicalJson(value: unknown): unknown {\n", "function canonicalJson(value: unknown): unknown {\n  if (value && typeof value === \"object\" && !Array.isArray(value)) { const o = { ...(value as Record<string, unknown>) }; delete o.hash; delete o.previousHash; value = o; }\n"),
 "C-compare-but-keep-parsed-rows": ("    journalRows = rawParsed as unknown as JournalRow[];", "    // (mutant) parsed rows kept"),
 "D-defaults-for-every-kind": ('  if (content.kind === "action_observation") {', "  if (true) {"),
 "E-no-key-sort": (".sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)", ""),
 "F-no-decision-source-enum": ("if (!journalAttemptSchema.shape.decisionSource.safeParse(row.decisionSource).success) {", "if (false) {"),
 "G-no-count-check": ("if (journalRows.length !== rawParsed.length) {", "if (false) {"),
 "H-array-order-ignored": ("if (Array.isArray(value)) return value.map(canonicalJson);", "if (Array.isArray(value)) return value.map(canonicalJson).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);"),
 "I-nonjson-normalised": ('  throw new Error("Journal row contains a non-JSON value");', "  return null;"),
}
old, new = M[mid]; p = wt / F; s = p.read_text()
assert s.count(old) == 1, f"mutant {mid}: expected exactly one match, found {s.count(old)}"
p.write_text(s.replace(old, new)); print("applied", mid)
