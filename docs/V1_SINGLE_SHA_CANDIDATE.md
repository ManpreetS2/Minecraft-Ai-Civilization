# V1 single-SHA offline 1v1 candidate

**Branch:** `agents/cursor-v1-single-sha-integration`  
**PR:** [#56](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/56)  
**Base:** PR #52 `a544f8830f1fc973947940d4532bfb4bc40c0d1c` (descendant of `9945f02`)  
**Authority:** Offline engineering candidate only. Does **not** close live Gate A/B. Independent QA must still review.

## What is combined

| Source | Role |
| --- | --- |
| PR #52 chest + ledger | Base |
| PR #48 + #53 | Offline default-deny + escape closures |
| PR #42 incrementals | Cancelled-retry / mixed GPT+Claude fault accounting |
| PR #54 `qa/v1/` @ `f5e2228` | Corrected independent QA harness (DEFECT blocks PASS; exact 40-char expect-sha). Destructive `run-on-candidate.sh` **not** imported |
| PR #55 `tools/v1-*` | Additive Codex acceptance/integration tooling; `ChestRegressionAdapter` wired to real store/executor |
| Mission 004 | Ledger consistency, late-shutdown scenario, ADV-10 ordinary assertions, tools/root alias fixes, additive chest provenance read |

## Full matrix (self-run, not independent acceptance)

Recorded on **`43c02cb8ab9cc06d83c08143d7e574e1f65ed79f`** (win32 / node 22.17.1 / pnpm 10.13.1). All listed exits **0**. See `docs/V1_ACCEPTANCE_LEDGER.md` Mission 004 matrix table and local `artifacts/v1/mission004-matrix.log`.

## Reproducible commands

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm typecheck:tools
pnpm lint
pnpm build
pnpm test
pnpm test:security
pnpm test:ai
pnpm test:v1
pnpm exec vitest run --config qa/v1/vitest.config.ts qa/v1/test
pnpm exec vitest run apps/orchestrator/src/independent-offline-runtime.test.ts
pnpm exec vitest run --config tools/vitest.config.ts tools/v1-integration/regressions.test.ts tools/v1-integration/integrated-chest-adapter.test.ts
pnpm exec vitest run apps/orchestrator/src/independent-offline-default-deny.test.ts apps/orchestrator/src/pr48-review-escapes.test.ts
pnpm exec vitest run packages/cognition/src/routing/mixed-provider-faults.test.ts
```

Optional provenance-sensitive QA runner (after clean tree + exact SHA):

```powershell
npx tsx qa/v1/src/run.ts --expect-sha <THIS_SHA> --expect-branch agents/cursor-v1-single-sha-integration
```

Do **not** treat Cursor self-green or `qa/v1` PASS as Gate A/B. ADV-03 freshness/`verifiedLive` and concurrent ordering remain explicit BLOCKED gaps (additive `observedContainerProvenance` only exposes existing timestamps).

## Independent QA instructions

1. **Claude:** Re-run ADV/chest suites against the published HEAD; keep ADV-03 BLOCKED cases until metadata policy is agreed; optionally adopt `observedContainerProvenance`.
2. **Codex (non-author for #53):** Re-check the three offline-root escapes on this SHA.
3. **Non-author:** Provider cancelled-retry / mixed faults (`mixed-provider-faults` + ADV-10).
4. **CODEX 1.2:** Movement `bdfba74` / guard ownership — authorize integrate or leave BLOCKED.
5. **Do not** mark live Gate A/B; no Paper/paid calls.

## Remaining blockers

- Independent `OFFLINE_PASS`: **0/18** (official denominator unchanged).
- Live Gate A/B: **0/2**.
- Movement/guard (CODEX 1.2) and validator ancestry (#47) not folded.
- ADV-03 `verifiedLive` + ordering token not implemented.
- Codex catalog 0/30 and 0/37 remain unreviewed denominators — do not replace the official ledger denominator.

## Readiness for offline Gate A prerequisites

Self-verified implementation coverage is **11/18**. Offline Gate A prerequisites are **not** met for independent acceptance: reviewers must still accept evidence, movement/guard remain BLOCKED, and live gates stay closed.

**Matrix SHA:** `43c02cb8ab9cc06d83c08143d7e574e1f65ed79f`  
**Published HEAD:** 8a8b41546fb2ecf015cfdd77d168f3f67d612fb2
