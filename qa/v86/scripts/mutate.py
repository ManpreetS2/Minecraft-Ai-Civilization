#!/usr/bin/env python3
"""Mutation check of the QA86 suites. Usage: mutate.py <disposable-worktree> <id>. ONE textual mutation of PR #86's validator in a throwaway
worktree (never the audited tree, never committed). Restore with `git checkout -- .` there."""
import sys, pathlib
wt = pathlib.Path(sys.argv[1]); mid = sys.argv[2]; V = "experiments/evidence-validator/src/"
M = {
 "A-no-row-count-check": (V+"validator.ts", "if (journalRows.length !== rawParsed.length) {", "if (false) {"),
 "B-no-window-end-check": (V+"source-authenticator.ts", "if (endTime < lastJournalAt - WINDOW_SKEW_TOLERANCE_MS) {", "if (false) {"),
 "C-no-window-start-check": (V+"source-authenticator.ts", "if (startTime > firstJournalAt + WINDOW_SKEW_TOLERANCE_MS) {", "if (false) {"),
 "D-empty-allowlist-open": (V+"source-authenticator.ts", "if (args.trustedAuthorities !== undefined) {", "if (args.trustedAuthorities && args.trustedAuthorities.length > 0) {"),
 "E-mode-ignores-errors": (V+"validator.ts", "    !hasErrorViolations\n  ) {\n    mode = \"real_minecraft\";", "    true\n  ) {\n    mode = \"real_minecraft\";"),
 "F-no-final-mode-downgrade": (V+"validator.ts", "if (mode === \"real_minecraft\" && violations.some((v) => v.severity === \"ERROR\")) {\n    mode = \"offline_simulated\";\n  }", ""),
 "G-ticks-from-parsed-rows": (V+"duration-verifier.ts", "if (args.rawJournalLines && args.rawJournalLines.length > 0) {", "if (false) {"),
 "H-position-not-bound": (V+"validator.ts", "else if (JSON.stringify(raw.position ?? null) !== JSON.stringify(rowAny.position ?? null)) diverges = true;", ""),
 "I-decisionSource-not-bound": (V+"validator.ts", "else if (raw.decisionSource !== rowAny.decisionSource) diverges = true;", ""),
 "J-no-final-inventory-continuity": (V+"validator.ts", "if (input.finalInventories) {\n    for (const [citizenId, finalPhysical]", "if (false as boolean) {\n    for (const [citizenId, finalPhysical]"),
 "K-no-phantom-from-raw": (V+"validator.ts", "if ((r.kind === \"action_attempt\" || r.kind === \"action_observation\") && r.citizenId) {", "if (false) {"),
 "L-cli-cap-removed": (V+"cli.ts", "report.mode === \"offline_simulated\"\n  ) {", "false\n  ) {"),
}
f, old, new = M[mid]; p = wt / f; s = p.read_text()
assert s.count(old) == 1, f"mutant {mid}: expected exactly one match, found {s.count(old)}"
p.write_text(s.replace(old, new)); print("applied", mid)
