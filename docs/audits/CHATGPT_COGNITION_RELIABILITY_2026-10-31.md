# Cognition reliability audit — independent proposal (October 31, 2026)

## Scope and ownership

Base: private `integration/weekly-2026-10-31` at `17bff2db5b0b2f29c4c0d1626d0b28f332653633`.

Proposal branch: `agents/chatgpt-reliability-20261031`.

This review deliberately excludes protected `manager.ts`, `executor.ts`, Windows Mission 013, SEC-001's live security work and the Codex privacy proposals. It makes no Minecraft, network, real API or production database calls. This is a focused audit, not a complete security certification.

## Confirmed source defects and changes

1. **InferenceQueue synchronous job failures stalled the queue** (`packages/cognition/src/queue.ts`). The previous `next.job.run().then(...)` expression throws before attaching `finally` when `run()` throws synchronously. `inFlight` remains occupied and subsequent work can wait indefinitely. The patch enters the job through `Promise.resolve().then(() => next.job.run())` so both synchronous throws and rejected promises release the worker slot. Invalid zero/noninteger concurrency is rejected at construction.

2. **Unknown or duplicate CloudBudgetGate settlements freed unrelated capacity** (`packages/cognition/src/cloud-budget.ts`). The previous `get(id) ?? 0` and unconditional `inFlight -= 1` decremented active concurrency when the ID was absent or already settled. The patch checks reservation membership first and rejects invalid settlement without mutating counters.

3. **Invalid/missing metered usage could fail open** (`cloud-budget.ts`, `openai-responses.ts`). A non-finite token count could poison `spendUsd` with `NaN`, causing subsequent spend checks to fail open. A successful Responses payload without `usage` was converted to 0 input/0 output tokens, refunding its reserved budget despite potentially billable API activity. The patch requires valid nonnegative safe-integer token counts and refuses further paid admissions on invalid/missing usage. The provider still records a failed call, and its existing catch path releases the provisional reservation; the budget remains closed. Run-limit NaNs/negative values are rejected.

## Regression coverage added

- `packages/cognition/src/inference-queue-regression.test.ts`: synchronous exception recovery, mixed async/sync failures, invalid concurrency.
- `packages/cognition/src/cloud-budget-regression.test.ts`: unknown/double settlement, malformed and missing usage, validation of limits, normal reconciliation.
- `packages/cognition/src/openai-usage-regression.test.ts`: mocked Responses requests with missing, negative, fractional, string, null and partial token usage.

## Validation honestly performed

- An isolated Node 22 / TypeScript 5.8 logic smoke harness reconstructed the affected queue and budget methods and ran **7 cases PASS** with no network or API access.
- The full repository and its Vitest dependencies were not available as an executable checkout in this session. **The actual new Vitest files, full workspace suite, lint and repository typecheck have not been run here.**
- A full independent reviewer must run tests on the actual proposed Git branch before merging. The handoff from Grok reports two known failures on the weekly integration baseline; do not attribute those to this proposal.

Recommended commands on a standard authenticated checkout:

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run packages/cognition/src/inference-queue-regression.test.ts packages/cognition/src/cloud-budget-regression.test.ts packages/cognition/src/openai-usage-regression.test.ts packages/cognition/src/openai-responses.test.ts
pnpm --filter @civ/cognition typecheck
pnpm test
pnpm lint
git diff --check integration/weekly-2026-10-31...HEAD
```

## Integration instructions

1. Keep this branch isolated, **do not merge automatically**.
2. Obtain independent review of constructor validation, in-flight settlement behavior, and malformed/missing-usage billing logic.
3. Run the complete Vitest and typecheck set, resolve any direct regression, then combine only after the lead integrator reviews interactions with SEC-001.
4. SEC-001 and existing Codex negative privacy tests remain independent release blockers.
5. Follow up later on cost estimation for successful responses that report usage but do not include all billable components. No invoice or actual paid model usage was measured here.
