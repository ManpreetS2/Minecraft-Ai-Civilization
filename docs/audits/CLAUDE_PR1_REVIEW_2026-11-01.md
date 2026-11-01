# Independent review of Draft PR #1 (November 1, 2026)

Reviewed head: `agents/chatgpt-reliability-20261031` at `3e6c006`, base `integration/weekly-2026-10-31` at `17bff2d`.

Corrections branch: `agents/claude-pr1-review`. The PR branch was not changed and nothing was merged.

No real API request was made and Minecraft was not started. Tests used mocked fetches. One throwaway proof, not committed, used loopback-only HTTP servers. `manager.ts` and `executor.ts` were read but not changed.

## What the PR got right

- The queue fix releases the slot after a synchronous throw, and deferring `run()` by a microtask broke no test.
- `reconcile` no longer frees capacity for unknown or repeated reservation IDs.
- `NaN` and other malformed token counts no longer corrupt spend.
- URL validation parses the real host and protocol. Userinfo tricks, IPv6-suffixed hosts and IPv4-mapped addresses are rejected, and errors do not echo the URL.
- The new constructor checks match the existing zod minimums, so valid configs do not start throwing.

## Defects found and corrected

Each was reproduced against the unmodified PR code before being fixed.

| # | Defect | Proof on PR code | Correction |
| --- | --- | --- | --- |
| 1 | HTTP 200 with usable token counts but an unusable decision was refunded in full. The spend allowance never applied to these calls. | 20 responses of about $1.25 each left `spendUsd: 0`, with the budget open. | Charge usage before interpreting output, and record tokens and cost in the failure ledger entry. |
| 2 | Missing or invalid usage closed the budget, but the catch path still refunded the reserve. A PR test asserted `spendUsd === 0`. | `spendUsd: 0`, `closed: true`. | New `settleUnknownUsage` keeps the reserve as spend and closes the gate. An unreadable 200 body takes the same path. |
| 3 | The cancellation check sat outside the inner `try`, so an abort between retries never settled the reservation. | `inFlight` stuck at 1 and every later call refused with `cloud concurrency limit reached`. No ledger entry. | Moved the check inside the `try`. |
| 4 | Retries did not count toward `CLOUD_MAX_REQUESTS_PER_RUN`. | Cap of 1 with `maxRetries` 2 sent 3 HTTP requests. | New `tryChargeRetry` draws each retry from the budget. |
| 5 | URL validation did not cover redirects. | A 307 from `localhost` delivered the prompt to a different origin, and the decision was accepted. `Authorization` was stripped, so the key did not leak. | `redirect: "error"`. |
| 6 | `reserveUsdPerRequest: 0` passed validation. | Admitted with a $0 allowance. | The reserve must be positive. |

Defect 3 was forced with a mock that ignores the abort signal. Real `fetch` rejects on abort, so the production window is a narrow race. Defect 2 is an incomplete PR fix. The others predate the PR and were left unfixed by it, so none is a regression the PR introduced.

Existing PR tests changed because they asserted defect 2: two in `cloud-budget-regression.test.ts` and one in `openai-usage-regression.test.ts`.

## Incorrect assumptions in the PR audit

- **The queue fix does not reach live runs.** `InferenceQueue` is only used by `CognitionService`, and no code outside `packages/cognition` uses that service. `AgentManager` calls `createCognition(...).decide` directly. The fix is correct but does not change live behavior today.
- **The queue is not free of stalls.** A job that never settles still blocks it, and there is no watchdog. The Ollama and OpenAI providers have timeouts, but the queue itself does not enforce one.
- **"Two known baseline failures" is not what this checkout shows.** The full suite has one failure on the base, in `blueprint.test.ts`.
- **"Provider releases the reservation; budget stays closed" was presented as safe.** That release was defect 2.

## Test results

Node 22.17.1, pnpm 10.13.1, Windows. `OPENAI_API_KEY` and the cloud flags were unset, and there is no `.env` in the checkout.

| Check | Base `17bff2d` | PR `3e6c006` | Corrected |
| --- | --- | --- | --- |
| Five targeted test files | not run | 50 passed | 69 passed |
| `packages/cognition` | not run | 88 passed | 107 passed, five consecutive runs |
| `@civ/cognition` typecheck | pass | pass | pass |
| Workspace typecheck | fail, 10 errors | fail, same 10 | fail, same 10 |
| `pnpm lint` | fail, 15 errors | fail, same 15 | fail, same 15 |
| ESLint on `packages/cognition/src` | not run | no errors in full lint | pass |
| `pnpm test` tests | 1 failed, 1061 passed, 2 skipped | 1 failed, 1088 passed, 2 skipped | 1 failed, 1107 passed, 2 skipped |
| `pnpm test` files | 1 failed, 130 passed | 1 failed, 134 passed | 1 failed, 134 passed |
| `git diff --check` | not run | clean | clean |

The one failure on every line is `packages/agent-core/src/blueprint.test.ts`: `materials.crafting_table` is `undefined`, expected 1. The typecheck errors are in `agent-core` and `apps/orchestrator`. None of the failures come from this PR or these corrections.

Running the reviewed tests against the original PR source produces 20 failures, so they do detect these defects. The added queue and URL tests pass on the PR source because they pin behavior the PR already got right, as does the control test that rejected requests are still refunded.

## Remaining risks

- **The cap can overshoot.** Admission only sees the reserve, a flat $0.01 regardless of model or prompt size. The last admitted call can exceed the allowance by its actual cost, and `CLOUD_MAX_CONCURRENCY` above 1 multiplies that. Prices are a local table and ignore cached-token discounts.
- **Timeouts are still refunded.** A request that fails before response headers arrive is refunded, though the provider may have billed it. Retryable 429, 500 and 503 responses are also treated as free.
- **A single bad response ends cloud cognition for the run.** Missing usage or an unreadable 200 body closes the gate, including a timeout during body read. Later `decide` calls fail with `cloud cognition shut down`, and the manager records `LLMSkipped` each time. That message does not state the real cause.
- **`CLOUD_MAX_REQUESTS_PER_RUN` now effectively means fewer decisions** when retries occur, because each attempt counts.
- **Any HTTPS host is accepted.** An operator-set `OPENAI_BASE_URL` still receives the API key. An allowlist would be a policy decision. A query string or fragment in the URL is also accepted and misroutes the request.
- **SEC-001 interaction is untested.** T3's work was not reviewed against these changes. `agents/claude-sec001-manager` and the Codex privacy branches remain separate blockers.
- **Nothing was checked against real billing.** No invoice or real OpenAI response was used.
