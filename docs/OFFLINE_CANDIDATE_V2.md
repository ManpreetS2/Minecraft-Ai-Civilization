# Offline candidate v2

**Offline only. Known PR #67 live-authenticity vulnerabilities remain present and unaccepted.** This candidate is not a live gate, a trusted Paper attestation verifier, or a formal acceptance-ledger upgrade.

Executable source under test: `e83444cc8dbfb376f59c59f8d8c6989363e5d7b9`. The publication follow-up contains evidence and documentation only. Rehearsal manifests retain their actual tested SHA; do not replace it with a later documentation head.

## Source and reconciliation

Base: PR #68 `4feef20622eb29ff85f7be122214630a84edac33`, already including action-time evidence, journal matching, chest CAS/epochs, construction durability, navigation deadlines and provider isolation.

Only new commits were transferred:

- PR #69 `5ad304c0cbb624aca89ad265a0c9ba765f7c6bcd` → `cd9230a`: real skill cancellation fixes, bounded window operations, native action ownership/deadline boundary and audit tests. The blueprint validation changes compose with the existing read-only workstation validation and retain observed door properties and original action recording.
- PR #70 code `ced983d` → `bf4cb34`; head `e754370efa7f23bc56f01a15830d1ff7618600ee` → `edda677`: cross-platform workflow and offline artifact verification. Its earlier validator ancestry was not replayed.
- Combined adaptation `e83444cc8dbfb376f59c59f8d8c6989363e5d7b9`: actual journal subprocess controls, truthful CI failure propagation, combined lifecycle regressions and historical-test setup reconciliation.

No protected merge, YC runner, live Paper, paid inference or production database was used. Earlier branches/worktrees remain intact. Full ancestry and unchanged vulnerable-verifier blob hashes are recorded in `docs/evidence/offline-v2/ancestry.json`.

## Integration changes

PR #70's helper previously marked its forged-receipt check passed after executing only a positive command, omitted the experiment-ID argument required by the combined recording, and did not make journal failure affect the CI process result. The combined helper now executes the actual CLI four times: consistent evidence, missing root, missing journal, and a copied receipt/manifest rehashed to claim 30 logs against the original journal. It requires exit codes 0/2/2/1, rejects live-authenticity promotion, and requires a journal-specific contradiction in the forged case. Forged copies are temporary and removed. Originals remain unchanged. The entry point exits unsuccessfully if these controls do not run successfully. Node's executable launches the subprocess portably, avoiding Windows pnpm.cmd shell quoting.

The workflow retains Ubuntu/macOS/Windows jobs and adds construction, movement, provider and cancellation QA to each platform's smoke job, with QA/test-support path triggers. Application tests and full Ubuntu checks remain. Every result is offline-scoped; the summary explicitly warns that PR #67's vulnerabilities are not repaired.

Two imported assertions required setup reconciliation, not weaker safety expectations. The CI absence test now uses its empty temporary workspace instead of the combined repository, where the CLI exists. One historical action-audit source characterization asserted that QA57-M1's bounded recovery fix was absent; it now requires that already-integrated bounded operation and deadline/abort guard. All cancellation behavioral assertions remain ordinary tests. The historical audit README describes its original source, not a new acceptance decision.

New executable cases use the real manager, executor, persistence and provider implementations: construction cancellation during delayed navigation followed by a new SQLite connection and safe continuation; and held GPT/Claude replies delivered only after citizen death and manager stop. The latter deliberately exceeds shutdown drain with uncooperative fake transports; after release there is no late decision and private memory survives in reopened SQLite. The drain diagnostic is expected in that test, not proof that every operation cooperates or that every shutdown race is solved.

## Commands and artifacts

From a clean checkout of the tested source:

```sh
pnpm install --frozen-lockfile
pnpm test --maxWorkers=1 --no-file-parallelism
pnpm test:security --maxWorkers=1 --no-file-parallelism
pnpm test:ai --maxWorkers=1 --no-file-parallelism
pnpm test:v1 --maxWorkers=1 --no-file-parallelism
pnpm test:evidence-validator --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run --config qa/construction-persistence/vitest.config.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run --config qa/v57/vitest.config.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run --config qa/provider-safety/vitest.config.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run --config qa/action-audit/vitest.config.ts --maxWorkers=1 --no-file-parallelism
pnpm typecheck
pnpm typecheck:tools
pnpm typecheck:evidence-validator
pnpm exec tsc --noEmit -p qa/action-audit/tsconfig.json
pnpm lint
pnpm build
pnpm v1:offline 2 artifacts/v1/v2-1v1
pnpm v1:offline 4 artifacts/v1/v2-2v2
pnpm exec tsx tools/ci/verify-offline-acceptance.ts --scenario2 artifacts/v1/v2-1v1 --scenario4 artifacts/v1/v2-2v2 --sha e83444cc8dbfb376f59c59f8d8c6989363e5d7b9 --output artifacts/v1/v2-ci
pnpm v1:journal artifacts/v1/v2-2v2/manifest.json e83444cc8dbfb376f59c59f8d8c6989363e5d7b9 ManpreetS2/Minecraft-Ai-Civilization-windows-backup artifacts/v1/v2-2v2 operator.jsonl off4
```

CI verification must show `journalCliCheck.executed: true`, the actual exit-code controls and `forgedReceiptTestPassed: true`. CLI presence or READY alone is insufficient. The separate journal-execution regression runs real subprocesses over historical snapshot fixtures and a corrupted copy; it is current executable verification over explicitly historical input, not a new execution of those historical citizens.

Local rehearsals record six actions/attempts/observations for 1v1, twelve for 2v2, and 18/30 total journal rows. Action event IDs, original row sequences and planned/observed deltas remain intact. Scripted decisions remain scripted and planner continuations remain planner-originated. Both reports retain NOT_PROVEN authenticity. The journal checks are actually executed after combination, not merely detected.

## Live-authenticity blocker and Gemini handoff

The independent review of PR #67 at `2baaf8a49806ae01d3bcc3e1c481b8479ccf77ed` reported CHANGES REQUIRED: [review handoff](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/67#issuecomment-6701117088), reviewer source `61545594c299116a22d4de55285e6b61f773f7a1`. Known problems include caller/manifest/journal identity conflicts; weak/small-order Ed25519 keys; signed timestamp/tick inconsistencies; independently supplied journal rows not bound to signed raw bytes; frozen ticks accepted for short runs; scripted attempts relabelled as model calls; and extra/ghost/inventory forgeries. The review's expected-failure reproductions are not counted as successful acceptance by this candidate.

There is **no approved Gemini repair SHA supplied yet**. When it is approved, incorporate exactly the independently reviewed repair commit(s) and their adversarial tests, record the full PR/SHA and approval evidence, and rerun those tests as ordinary passing assertions alongside this complete matrix. Require immutable manifest/journal identity with conflict rejection, canonical/non-degenerate keys, validated signed time/tick relationships, one signed raw-journal authority, truthful decision provenance and a two-way per-citizen physical ledger. Do not substitute an unreviewed tip or this candidate's green offline checks for that approval. Until then, live authenticity is blocked, not fixed.

## Review limits

All local world and provider observations are controlled offline doubles, even though production application code and real disposable SQLite are exercised. Local macOS results do not establish native Ubuntu/Windows behavior. The workflow defines those hosted jobs; their actual PR check results must be reviewed separately before claiming cross-platform verification. The platform-dependent Windows 8.3 case is skipped on macOS. No official ledger was edited, and implementation-author results are not independent acceptance.

## Completed local results

All commands use the frozen executable source above. The earlier workspace process ended with signal exit 143 before completion and is retained as interrupted diagnostic output, not passing evidence. The standalone completed retry supersedes it.

| Check | Passed | Failed | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: |
| workspace | 2555 | 0 | 1 | 0 |
| security | 358 | 0 | 0 | 0 |
| ai | 514 | 0 | 0 | 0 |
| v1 | 149 | 0 | 0 | 0 |
| validator | 161 | 0 | 0 | 0 |
| construction | 12 | 0 | 0 | 0 |
| movement | 204 | 0 | 0 | 0 |
| provider | 10 | 0 | 0 | 0 |
| cancellation | 48 | 0 | 0 | 0 |

Workspace, tools, validator and cancellation-audit typechecks, lint and build all exit 0. Both rehearsal commands, the CI artifact verifier and the separate 2v2 journal CLI exit 0. The CI verifier records actual 0/2/2/1 subprocess controls. Node v22.12.0, pnpm 10.16.0, macOS x64. Raw logs and original rehearsal snapshots are under docs/evidence/offline-v2/. Counts overlap across commands and must not be summed as unique coverage. Hosted Ubuntu/macOS/Windows CI remains pending until the PR jobs complete. No current local integration failure remains; live-authenticity security is still blocked.


## Ubuntu CI follow-up

The Ubuntu smoke job on publication head `764436cb6a62882e1d631ed46cf31918e8d0fd92` failed two existing movement/guard assertions for `DATA/evidence`. Linux treated that as distinct from the protected `data` tree, while the offline safety policy requires conservative refusal of case-folded collisions. The unchanged POSIX lexical comparison tests also require case-sensitive syntax semantics.

The fix separates portable isolation policy from lexical identity: `pathsCollideForIsolation` refuses either a lexical alias or its case-folded collision at the isolation boundary, while `pathsAliasSameTree` retains its existing POSIX behavior. No existing assertions were weakened. A new regression also requires genuinely separate sibling paths to remain permitted.

Implementation commit: `6573847547b02f184c4adde80e9fc2b041f18e64`. Local replay: movement/guard QA 204 passed, 0 failed, 0 skipped; focused guard suites 104 passed, 0 failed, 1 Windows-only skip. Orchestrator typecheck and focused lint exit 0. Commands:

```sh
pnpm exec vitest run --config qa/v57/vitest.config.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run apps/orchestrator/src/construction-case-policy.test.ts apps/orchestrator/src/construction-path-isolation.test.ts apps/orchestrator/src/construction-experiment-guard.test.ts apps/orchestrator/src/off13-qa39-regressions.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec tsc -p apps/orchestrator/tsconfig.json --noEmit
pnpm exec eslint apps/orchestrator/src/construction-experiment-guard.ts apps/orchestrator/src/construction-case-policy.test.ts
```

Failure and replay logs are in `docs/evidence/offline-v2/ci-followup/`. Hosted cross-platform checks must rerun on this follow-up; the earlier full local results above remain evidence for their stated earlier source. Live-authenticity vulnerabilities are unchanged and unaccepted.
