# V1 single-SHA offline 1v1 candidate

**Branch:** `agents/cursor-v1-single-sha-integration`  
**Base:** PR #52 `a544f8830f1fc973947940d4532bfb4bc40c0d1c` (descendant of `9945f02`)  
**Authority:** Offline engineering candidate only. Does **not** close live Gate A/B. Independent QA must still review.

## What is combined

| Source | Role |
| --- | --- |
| PR #52 chest + ledger | Base |
| PR #48 + #53 | Offline default-deny + escape closures |
| PR #42 incrementals | Cancelled-retry / mixed GPT+Claude fault accounting |
| PR #54 `qa/v1/` | Additive independent QA harness (verdict runner has a known review finding — not acceptance authority yet) |
| PR #55 `tools/v1-*` | Additive Codex acceptance/integration tooling; `ChestRegressionAdapter` wired to real store/executor |

## Reproducible commands (this SHA)

```powershell
pnpm install --frozen-lockfile
pnpm exec vitest run apps/orchestrator/src/independent-offline-runtime.test.ts apps/orchestrator/src/independent-offline-default-deny.test.ts apps/orchestrator/src/pr48-review-escapes.test.ts packages/cognition/src/routing/mixed-provider-faults.test.ts packages/agent-core/src/independent-qa-chest-contents.test.ts packages/agent-core/src/community-container-contents.test.ts packages/agent-core/src/community-physical-state.test.ts packages/agent-core/src/executor-community-storage.test.ts
# Expected: 8 files, 82 passed

pnpm exec vitest run --config tools/vitest.config.ts tools/v1-integration/regressions.test.ts tools/v1-integration/integrated-chest-adapter.test.ts tools/v1-integration/preflight.test.ts tools/v1-acceptance/engine.test.ts
# Expected: 4 files, 25 passed
```

Optional (dirty-tree / provenance sensitive):

```powershell
pnpm test:v1
pnpm v1:offline 2
npx vitest run -c qa/v1/vitest.config.ts
npx tsx qa/v1/src/run.ts --expect-sha <THIS_SHA> --expect-branch agents/cursor-v1-single-sha-integration
```

Do **not** treat `qa/v1` PASS as Gate A/B. Claude owns the runner mixed-pass finding. ADV-03 freshness/concurrency metadata remains an explicit gap.

## Independent QA handoff

1. **Claude 2:** Re-run ADV/chest suites against this SHA; confirm former-owner / former-grantee / failed-withdrawal stay green without weakening `it.fails` history; fix QA runner verdict bug before treating harness PASS as authoritative.
2. **Codex (non-author for #53):** Re-check the three offline-root escapes on this SHA.
3. **Non-author:** Provider #32/#42 behavior on this SHA (mixed-provider-faults).
4. **Do not** mark live Gate A/B; no Paper/paid calls.

## Known remaining blockers

- Full workspace `pnpm test` / `test:security` / `test:ai` / typecheck / lint / build not claimed in this note until recorded for the final pushed SHA.
- Movement/guard (CODEX 1.2) and validator ancestry (#47) not folded.
- Live Gate A/B: **0/2**.
- Codex catalog 0/30 and 0/37 remain unreviewed denominators — do not replace the official ledger denominator.
