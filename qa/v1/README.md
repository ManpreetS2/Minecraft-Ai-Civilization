# qa/v1: independent QA harness for the 1v1 integration candidate

Test-only. Nothing in production imports it. All evidence is `OFFLINE_FIXTURE`: it can never certify live Paper behaviour,
real survival, TPS, a real 60-minute run, or measured provider cost. No credentials, no network, no paid calls.

## Run it

```
pnpm install --offline --frozen-lockfile        # once, per checkout
npx tsx qa/v1/src/run.ts --expect-sha <full candidate SHA> --expect-branch <branch>
npx tsc -p qa/v1/tsconfig.json                  # typecheck
npx vitest run -c qa/v1/vitest.config.ts        # raw tests, no verdict logic
```

`run.ts` runs the suites, then `src/verdict.ts` decides. Exit 0 only for PASS. Reports: `qa/v1/out/qa-v1-report.{md,json}`
(git-ignored). It refuses PASS for: zero tests, a missing required file, a failed suite load, nonzero exit, a dirty tree,
a SHA or branch different from the claim, an `it.fails` reproduction counted as a fix, a skipped or BLOCKED scenario, a
BLOCKED case that unexpectedly passes, or `--require-live` (every scenario here is simulated). `test/runner-verdict.test.ts`
proves each refusal.

No root `package.json`, workspace or CI file is edited. `qa/v1/vitest.config.ts` aliases the workspace packages and reuses
`test-support/setup.ts` (the offline network guard).

## Layout

| File | Purpose |
|---|---|
| `src/scenario.ts` | typed scenario contract, `[ADV-nn][DEFECT][BLOCKED]` title convention |
| `src/fixture.ts` | deterministic helpers on the existing `offlineRegistry` / `CivilizationStore(":memory:")`: unique run ids, per-test stores, no-network spy that fails the test, per-session byte capture |
| `src/verdict.ts`, `src/run.ts` | verdict logic, runner |
| `test/adv-*.test.ts` | executable ADV-01..ADV-14 (see `docs/QA_1V1_ADVERSARIAL_ACCEPTANCE.md`, not renumbered) |
| `reference/chest-access-reference.patch` | throwaway patch used only to show the ADV-03 tests go green; for the owner to adapt, not to apply as-is |

## Status by source (what was actually run)

* `ae784fd` (#48 head, includes #32/#37): all non-chest cases pass; 2 ADV-10 cancel-during-retry reproductions (`[DEFECT]`,
  `it.fails`) because PR #42's fix is absent here; ADV-03 is BLOCKED (no chest-contents interface on this base).
* `1a690f6` (#42 head): the same ADV-10 file with `it.fails` removed passes 16 of 16.
* `dbbb7c4` (original PR #14): ADV-03 runs and is RED: 3 failures (old owner reads after leaving, grantee reads after leaving,
  stale bread after a failed withdraw proves it absent); 5 pass; 3 BLOCKED skips.
* `dbbb7c4` plus `reference/chest-access-reference.patch`: ADV-03 8 pass, 3 BLOCKED; `packages/agent-core` 78 files, 846 tests pass.

## Known interface gaps (recorded, not faked)

ADV-03 cannot assert "a stale observation is never treated as verified live stock" or "concurrent observers cannot overwrite a
newer result": `observedContainerContents` returns bare counts, with no `observedAt`/`verifiedLive` and no ordering token on
`recordContainerObservation`.

## Review package for PR #48 (authored by QA: evidence only, not an acceptance verdict)

Trust model: the root removes the supported route for injecting a transport. `script` and `createBody` are trusted in-process
functions, not sandboxed data. See `test/adv-offline-boundary.test.ts`.

1. `script` can reach global `fetch` (a spy was called). The doc comment "Data only: it cannot name a URL" is inaccurate.
2. `createBody` receives `["username","config","events","citizenId","reconnect","allowRespawn","eventLoopLag"]`. `config` carries the
   connection settings, so the factory can open a real Mineflayer connection; the root neither restricts nor wraps it.
3. The check is a denylist: `fetch`, `baseUrl`, `openaiBaseUrl`, `registry`, `providerOverrides` are accepted and unread. Inherited
   and getter-supplied `fetchImpl` ARE refused (`in` does not invoke getters). No exploit today; a future `...args` spread would need a guard.

Minimum correction: correct the two doc comments so they claim only "no supported injection route"; convert the key check to an
allowlist of accepted keys. Alternative where in-process enforcement is impossible: the process-level guard (`test-support`) plus
a launch-policy check that `createBody` is the project's own factory or a test double. Reviewer checklist: confirm 1 to 3 by running
the file; decide whether a trusted-caller model is acceptable for the offline root; confirm no live entrypoint can reach the root.
Reviewer must be Codex or Gemini, not CLAUDE 2.

## Running against an integrated candidate (non-destructive)

```
qa/v1/scripts/run-on-candidate.sh <candidate-repo> <full-40-char-sha> <NEW-worktree-dir> [expected-branch]
```

Creates a new disposable detached worktree at that exact SHA and overlays the harness as UNTRACKED `qa-independent/v1` (never at
`qa/v1`, which a candidate may already track in an older copy). It never deletes, overwrites or moves anything: it refuses an
existing destination, a symlinked path, a destination inside the candidate or harness, a short or unknown SHA, tracked changes in
the candidate repo, an uncommitted harness, and symlinks in the harness (`test/wrapper-safety.test.ts`). The report records the
candidate SHA and the harness commit, so the executed test code is always attributable. Omitting the SHA makes the verdict FAIL.
Do not pass `expected-branch` for a detached worktree.

Areas (from inside the worktree, offline): chest `adv-chest-access` and `adv-chest-freshness`; privacy and sessions `adv-identity-privacy`;
provider cancellation and accounting `adv-provider-faults`; transport boundaries `adv-offline-boundary` and `adv-evidence-injection`;
shutdown and restart `adv-shutdown`; physical truthfulness `adv-physical`. Each: `npx vitest run -c qa-independent/v1/vitest.config.ts qa-independent/v1/test/<file>.test.ts`.

ADV-10 cancel-during-retry tests choose their mode by a behavioural probe: ordinary regressions on source that charges a retry only
after its wait (PR #42), `it.fails` `[DEFECT]` reproductions on older source. The historical reproductions stay in git history.
