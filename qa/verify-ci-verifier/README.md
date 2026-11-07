# Independent audit of PR #70: the offline-acceptance CI verifier

Auditor: Claude Sonnet 5.5. I did not author PR #70 or PR #68. **Neither PR was modified**, no production code changed, no live Paper, no paid or model calls, no protected merges. This branch only adds `qa/verify-ci-verifier/` (tests, a runner, captured outputs).

| | |
| --- | --- |
| Candidate | PR #70, head `e754370efa7f23bc56f01a15830d1ff7618600ee` (base `2baaf8a`) |
| Workflow run audited | `42328575182` (success; 4 jobs) |
| Integration reference | PR #68, head `4feef20622eb29ff85f7be122214630a84edac33` |

## Decision

# CHANGES REQUIRED

The verifier is honest about what it *is*, and the workflow is hygienic. But it does **not** reliably detect broken civilization evidence, and the one component that would close the gap (the journal-CLI check) is wired so it can neither fail the build nor correctly pass. Three questions need separate answers, because a green CI run answers only the first:

| Question | Answer |
| --- | --- |
| **1. Does GitHub Actions succeed?** | Yes: all 4 jobs green on the exact SHA. That is true and independently confirmed. |
| **2. Is the evidence proven secure?** | **No / NOT PROVEN.** The verifier checks internal self-consistency of artifacts the same job just generated. 13 of 26 tamper classes I tried pass it (details below), and a fully coherent forgery is, by design, undetectable offline. |
| **3. Did real Minecraft / authenticated Paper execution happen?** | **No / NOT PROVEN.** The bundles are scripted in-process fixtures (`decisionTransport: scripted-in-process`, `authentication: synthetic`). The report says so. Nothing in this CI can prove otherwise. |

Sub-verdicts:

| Area | Verdict |
| --- | --- |
| Existing 16 regression tests reproduce | **PASS**, 16/16 (`evidence/reproduction/01-…`) |
| Reported SHA equals the source actually checked out | **PASS** (verified from the run log, see below; one low gap) |
| Secrets / private-artifact handling | **PASS** (low findings) |
| Rejects forged evidence | **CHANGES REQUIRED** (13/26 tamper classes accepted) |
| Journal-CLI integration (PR #70 ↔ PR #68) | **CHANGES REQUIRED** (4 defects, reproduced) |
| Honest reporting of incomplete checks | **PASS with low findings** (it is honest in the body, unqualified in the headline) |
| Real Paper / real Minecraft / authenticated evidence | **NOT PROVEN** (by design) |
| Windows behaviour of the journal-CLI path | **NOT PROVEN** (never exercised; see finding I-4) |

## How it was verified

Base bundles are **real** outputs of the candidate's own `pnpm v1:offline 2|4`, not hand-built fixtures (PR #70's own tests use a hand-built fixture whose receipts are far thinner than real ones). Every tamper is applied to a private copy, with the attacker recomputing the journal hash chain and `verdict.json`'s journal digest where a competent forger would. Each case asks two questions:

- **L1**: does PR #70's `verifyOfflineScenario` reject it?
- **L2**: does PR #68's real `journal-cli-main.ts` reject it (called correctly, with the `experimentId` PR #68's own CLI passes)?

Two configurations, both run 3×:

- **A**: PR #70 as-is. 56 pass, 34 skipped (everything that needs the journal CLI, which does not exist on this branch).
- **B**: PR #68's tree with PR #70's verifier copied in, untracked. 79 pass, 11 skipped (the workflow-file tests; that file is not in #68's tree).

Confirmed gaps use `it.fails` (the repo's QA convention): the assertion states the *desired* behaviour, the test is green while the gap exists, and it flips red when someone fixes it, which is the signal to convert it to a plain `it`.

## Tamper results (measured, then encoded as tests)

`misses` = accepted by PR #70's verifier. L2 = PR #68's CLI.

| ID | Tamper (on a real bundle) | PR #70 verifier | PR #68 CLI |
| --- | --- | --- | --- |
| T01 | Journal rewritten with valid hashes: world change moved | **misses** | detects |
| T02 | Journal rewritten with valid hashes: attempt target changed | **misses** | detects |
| T03 | Journal rewritten with valid hashes: observation flipped to failed/unverified | **misses** | detects |
| T04 | Journal rewritten with valid hashes: citizen identities swapped between two actions | **misses** | detects |
| T05 | Manifest + receipt citizen ids swapped (journal untouched) | **misses** | detects |
| T06 | Receipt reference replaced with another existing receipt | detects | detects |
| T07 | Receipt **content** forged, ids kept | **misses** | detects |
| T08 | Receipt `sourceSha` changed | **misses** | detects |
| T09 | Receipt file deleted | detects | detects |
| T10 | `manifest.sourceReceipts[].sha256` altered | **misses** | detects |
| T11 | Action duplicated over another | detects | detects |
| T12 | Journal pair replaced by a clone (fresh attemptId, broken inventory continuity) | **misses** | detects |
| T13 | One action removed everywhere | detects | detects |
| T14 | Evidence sources disagree: manifest says delta 9 / failed, journal says otherwise | **misses** | detects |
| T15 | Source SHA differs: manifest only | detects | detects |
| T16 | Source SHA differs: original journal start row vs manifest | detects | detects |
| T17 | Source SHA differs: validator report only | detects | (n/a) |
| T18 | `verdict.json` = PASS | detects | (n/a) |
| T19 | Validator `overallStatus` = VERIFIED | detects | (n/a) |
| T20 | `manifest.mode` = paper-live | detects | detects |
| T21 | Citizen `authentication` = microsoft | detects | (n/a) |
| T22 | **`acceptance.json` claims live 37/37 VERIFIED** (a published artifact) | **misses** | misses |
| T23 | **Validator `environment` = "Authenticated Paper live server"** | **misses** | misses |
| T24 | `UNPROVEN_PAPER_AUTHENTICITY` gap code silently removed | **misses** (warning only) | misses |
| T25 | Journal row edited without recomputing hashes | detects | detects |
| T26 | Coherent forgery (journal + receipt + pins all consistent) | passes (by design) | passes, and says NOT PROVEN |

Counts: L1 detects 12, L1 **misses 13**, 1 by design. Of the 13, PR #68's CLI catches **10**; **3 (T22–T24) are caught by nothing**. The three simulated-as-authenticated variants that matter are the ones in files the verifier never parses: it checks only that `acceptance.json` exists.

Also confirmed for the 2v2 (4-citizen) bundle on the cases marked `[4v]` in the tests.

### Why L1 misses these

By reading the code, then confirming by test:

- The hash chain proves only that rows agree *with each other*. An attacker who edits a row recomputes the chain; `verdict.json`'s digest is recomputed in the same step.
- Manifest actions are never compared with journal attempts, and receipts are never compared with journal observations. Receipts are checked only for `attemptId` and `citizenId`; `sourceSha` is read and never used, `manifest.sourceReceipts[].sha256` is never checked, `reportedSuccess` / `observedSuccess` / `inventoryDelta` are never read.
- Inventory is checked per row (`after == before + 1`), not for continuity across a citizen's rows.
- Nothing anchors the bundle outside itself. PR #68's own CLI says so in its output: *"all artifacts can be replaced consistently without an independently verified external anchor; journal matching does not authenticate Paper execution."*

## Integration with PR #68: four defects (reproduced)

PR #70 deliberately waits for PR #68's `pnpm v1:journal` and "automatically" cross-checks when it appears. I ran exactly that.

| # | Defect | Evidence |
| --- | --- | --- |
| **I-1** | **PR #70 omits the `experimentId` argument**, so on a legitimate, untouched bundle PR #68's CLI exits **1** with 18 × "Foreign run journal event replay". PR #68's own `cli.ts` passes `off2`/`off4`. With it, the same bundle is `JOURNAL CONSISTENT`, exit 0. | `evidence/reproduction/04-…`, `05-…` |
| **I-2** | **The journal check cannot fail the build.** `passed = res2.passed && res4.passed` ignores `journalCliCheck`. On PR #68's tree the report says `Status: ❌ FAILED` and the process still prints "Offline acceptance verification PASSED", exit 0. A real forgery that only the CLI sees (T07) also exits 0. | `evidence/reproduction/03-…`, `[GAP]` test |
| **I-3** | **`forgedReceiptTestPassed: true` is hard-coded**, not measured. It is set whenever the *positive* call exits 0; no forged input is ever fed to the CLI (one `execFileSync`, genuine manifest). The summary then prints "Forged-Receipt Negative Test: PASSED". With a stub CLI that exits 0, the claim is made after exactly one call. | `[CHARACTERISATION]` and `[GAP]` tests (PATH shim records calls) |
| **I-4** | **Only the 1v1 bundle is cross-checked; the 2v2 bundle never is** (one call, `scenario2Dir`). Separately, the call uses `execFileSync("pnpm", …)` with no win32 shell, while `getPnpmVersion` in the same file does set one. On Windows this path has **never run** (the CI logs show `NOT RUN` on all OSes), so I mark it NOT PROVEN, not proven broken. | `[GAP]` tests |

Net effect once #68 lands as-is: the CI shows a red-looking "FAILED" cell on a good bundle yet stays green, so reviewers will learn to ignore it, and a real failure there would be ignored too.

### Minimal reproduction (executable, no changes to either PR)

```sh
qa/verify-ci-verifier/scripts/run-on-candidate.sh "$PWD" 4feef20622eb29ff85f7be122214630a84edac33 /tmp/qaB e754370efa7f23bc56f01a15830d1ff7618600ee
# or by hand, in a PR #68 checkout with PR #70's tools/ci/*.ts copied in:
pnpm v1:offline 2 artifacts/v1/scenario-2 && pnpm v1:offline 4 artifacts/v1/scenario-4
pnpm exec tsx tools/ci/verify-offline-acceptance.ts --scenario2 artifacts/v1/scenario-2 --scenario4 artifacts/v1/scenario-4 --sha $(git rev-parse HEAD); echo "exit=$?"
#   -> "Status: FAILED" for the journal CLI, yet "PASSED", exit=0
pnpm v1:journal artifacts/v1/scenario-2/manifest.json $(git rev-parse HEAD) ManpreetS2/Minecraft-Ai-Civilization-windows-backup artifacts/v1/scenario-2 operator.jsonl        # exit 1, FAIL
pnpm v1:journal artifacts/v1/scenario-2/manifest.json $(git rev-parse HEAD) ManpreetS2/Minecraft-Ai-Civilization-windows-backup artifacts/v1/scenario-2 operator.jsonl off2   # exit 0, JOURNAL CONSISTENT
```

### Engineering handoff (not applied; I was told not to modify either PR)

1. Pass the experiment id as the 6th argument. PR #68 already records it as `manifest.configuration.experimentId`; use that, or `off${count}`.
2. Make a `FAILED` journal check fail the job. Decide explicitly whether `NOT_RUN` on a branch that *has* the CLI should also fail; today `NOT_RUN` correctly stays non-fatal only while the CLI is absent.
3. Run the cross-check for **both** scenarios.
4. Replace the hard-coded `forgedReceiptTestPassed` with a real negative test: copy the bundle to a temp dir, alter a receipt, require a non-zero exit; report `false`/`NOT_RUN` otherwise.
5. Give the `pnpm` spawn in `checkJournalCliIntegration` the same `shell: process.platform === "win32"` as `getPnpmVersion`, and run it on the Windows runner once #68 lands.
6. Close the L1 gaps independently of the CLI: compare manifest actions to journal attempts/observations, verify `sourceReceipts[].sha256`, check receipt `sourceSha`, require continuity of inventory across a citizen's rows, and parse `acceptance.json` and the validator `environment` field for authenticity claims.
7. Re-run `qa/verify-ci-verifier` on the combined SHA: every `it.fails` that is fixed will turn red and must become a plain `it`.

## GitHub Actions run 42328575182 (`evidence/github/run-42328575182-audit.md`)

- **SHA binding: verified.** Run `headSha` = PR head = `e754370…`. In all four jobs, the log shows the checkout of that SHA, `git rev-parse HEAD` printing it, the scenarios recording it, and the verifier banner and summary reporting it. One distinct value.
  - *Low gap:* `--sha $(git rev-parse HEAD)` is computed from the same checkout it verifies, so it cannot catch a wrong checkout ref. It is correct here because each checkout names `github.event.pull_request.head.sha` explicitly.
- **Job results.** All four jobs and all steps succeeded. In every job the journal CLI was `NOT RUN` (the command does not exist on this branch), shown in each summary.
- **Secrets / privacy: pass.** `pull_request` (not `pull_request_target`), `permissions: contents: read`, `persist-credentials: false` on both checkouts, no `secrets.` context anywhere, provider keys blanked and `LLM_PROVIDER: none`, no `continue-on-error`, every action pinned to a full SHA. Only `ci-summary.{md,json}`, `acceptance.md`, `gemini-validator-summary.md` and `verdict.json` are uploaded; the raw journal, receipts, manifest and provider-usage file are not. A grep for key/token patterns over every downloaded artifact found nothing. The artifacts do include runner-absolute paths.
- **Action pin comments are wrong for 3 of 4** (low, hygiene): `checkout` is pinned to v4.4.0 (comment says v4.2.2), `setup-node` to v4.4.0 (comment v4.2.0), and `pnpm/action-setup` to the annotated tag *object* of the moving `v4` tag (comment v4.1.0; real v4.1.0 is `a7487c7…`). I confirmed this is not an imposter commit (`git ls-remote` lists it as `refs/tags/v4`), and the pins are immutable, but the comments mislead anyone auditing versions.
- **Honest reporting of incomplete checks.** The body is honest: `NOT RUN / NOT READY` for the journal check, a "Documented Missing Evidence" list including `UNPROVEN_PAPER_AUTHENTICITY`, and `paperAttestationProven: false`. Two low findings, encoded as `[HONESTY-LOW]` tests: the headline reads an unqualified "PASSED" while a gate is `NOT RUN`/`FAILED`, and nothing surfaces that `acceptance.json` is **0/30 offline "NOT MEASURABLE"** (the uploaded `acceptance.md` lists several `offline FAIL` criteria next to that PASSED headline).

## What this does and does not establish

- **Proven:** the 16 tests reproduce; the SHA matches; the workflow is safe against secret exfiltration and private-artifact leakage as written; the tamper and integration results above, on real bundles, 3 runs each.
- **Not proven:** that any bundle came from a real Minecraft run; that PR #70 behaves on Windows once #68 lands; that the branch protection on this repo requires this check (unknown to me); behaviour on a combined SHA beyond PR #68's tree plus an untracked copy of PR #70's verifier (I did not merge the two).
- **Platforms:** I ran macOS only (arm64 host, x64 Node 22.12 under Rosetta). The CI jobs ran Ubuntu, macOS and Windows on the candidate as-is; none exercised the journal-CLI path.

## Reproduce

```sh
# From a clean checkout of this branch (the runner refuses an uncommitted QA tree):
qa/verify-ci-verifier/scripts/run-on-candidate.sh "$PWD" e754370efa7f23bc56f01a15830d1ff7618600ee /tmp/qaA                                  # config A: 56 pass / 34 skipped
qa/verify-ci-verifier/scripts/run-on-candidate.sh "$PWD" 4feef20622eb29ff85f7be122214630a84edac33   /tmp/qaB e754370efa7f23bc56f01a15830d1ff7618600ee   # config B: 79 pass / 11 skipped
```

Captured outputs (local paths scrubbed) are in `evidence/`; `evidence/env.txt` has versions and SHAs.
