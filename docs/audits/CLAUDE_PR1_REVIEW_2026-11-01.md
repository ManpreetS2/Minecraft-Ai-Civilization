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

## Remaining risks at `77b9a9b`

These are the risks as first reported. The owner decision below resolves or narrows several of them.

- **The cap can overshoot.** Admission only sees the reserve, a flat $0.01 regardless of model or prompt size. The last admitted call can exceed the allowance by its actual cost, and `CLOUD_MAX_CONCURRENCY` above 1 multiplies that. Prices are a local table and ignore cached-token discounts.
- **Timeouts are still refunded.** A request that fails before response headers arrive is refunded, though the provider may have billed it. Retryable 429, 500 and 503 responses are also treated as free.
- **A single bad response ends cloud cognition for the run.** Missing usage or an unreadable 200 body closes the gate, including a timeout during body read. Later `decide` calls fail with `cloud cognition shut down`, and the manager records `LLMSkipped` each time. That message does not state the real cause.
- **`CLOUD_MAX_REQUESTS_PER_RUN` now effectively means fewer decisions** when retries occur, because each attempt counts.
- **Any HTTPS host is accepted.** An operator-set `OPENAI_BASE_URL` still receives the API key. An allowlist would be a policy decision. A query string or fragment in the URL is also accepted and misroutes the request.
- **SEC-001 interaction is untested.** T3's work was not reviewed against these changes. `agents/claude-sec001-manager` and the Codex privacy branches remain separate blockers.
- **Nothing was checked against real billing.** No invoice or real OpenAI response was used.

## Owner decision follow-up (`4d5f786`)

The owner approved `77b9a9b` as the review candidate, not for merging, and directed the changes below. `77b9a9b` is kept in the branch history.

### What changed

| Direction | Implementation |
| --- | --- |
| Fail closed on missing, invalid or unreadable usage | The budget closes for the run. `closedReason` and later refusals name the cause, such as `OpenAI HTTP 200 response had missing token usage`. |
| Hold is not confirmed billing | New `heldUsd` and ledger `unverifiedHoldUsd`. `spendUsd` and `estimatedCostUsd` now come only from reported usage. |
| Non-paid fallback only | New `CLOUD_FALLBACK_PROVIDER`: `none` (default), `heuristic`, or `ollama` with a loopback host. Other values fail config parsing. It applies only to cost-policy stops, never to shutdown, concurrency limits or ordinary failures. |
| Per-request admission estimate | Attempt bound = `(request UTF-8 bytes + 64)` input tokens plus max output tokens, at the model's configured price. Requests over `CLOUD_MAX_INPUT_TOKENS` (default 16000) are refused unsent. The flat `reserveUsdPerRequest` is removed. |
| Concurrency and retries | The bound × all attempts is reserved up front, and every live reservation counts against the allowance. |
| Fail closed when unbounded | Unpriced or zero-priced models are rejected at startup. The silent fallback to `gpt-4o-mini` pricing is removed. A non-finite estimate closes the gate, and so does reported usage above the bound. |
| Official endpoint by default | Only `https://api.openai.com/v1` and loopback mocks work without further configuration. A query or fragment is rejected. |
| Deliberate custom endpoints | Other HTTPS hosts need `OPENAI_CUSTOM_ENDPOINT_HOST` to match exactly, including port. |

Beyond the direction, timeouts, network failures and 5xx attempts now hold their bound instead of refunding it, because their usage is unknown. Those holds do not close the budget, because their cost is bounded.

### The $1.05 overrun

`cloud-admission-adversarial.test.ts` replays the old flat-reserve arithmetic against $0.075 calls and a $1.00 allowance: 14 calls and $1.05. Through the real provider with a prompt that large, the new policy admits 13 calls, reaches $0.975, and refuses the rest unsent.

If a small prompt reports the same 500k tokens, the first call costs $0.075 and the budget closes, so the remaining 30 attempts send nothing.

### Test results

Same environment as above, at `4d5f786`, compared against base `17bff2d`.

| Check | Base `17bff2d` | `4d5f786` | New failures |
| --- | --- | --- | --- |
| Seven targeted test files | not run | 126 passed | none |
| `packages/cognition` | not run | 164 passed, five consecutive runs | none |
| `@civ/cognition` and `@civ/shared` typecheck | pass | pass | none |
| Workspace typecheck | fail, 10 errors | fail, identical 10 | none |
| `pnpm lint` | fail, 15 errors | fail, identical 15 | none |
| ESLint on `packages/cognition/src` and `packages/shared/src` | not run | pass | none |
| `pnpm test` tests | 1 failed, 1061 passed, 2 skipped | 1 failed, 1164 passed, 2 skipped | none |
| `pnpm test` files | 1 failed, 130 passed | 1 failed, 136 passed | none |

The one test failure is still `blueprint.test.ts`, the same as on the base. The typecheck errors are still in `agent-core` and `apps/orchestrator`, which these changes do not touch.

To check the tests can fail, 17 safety properties were broken one at a time, including reserving a single attempt, ignoring live reservations, refunding timeouts, following redirects and allowing any HTTPS host. The cognition tests caught all 17. The mutation script was not committed.

### What the bound does and does not establish

Local estimates cannot pass the allowance as long as these hold:

- the price table is accurate
- the provider honors `max_output_tokens`
- tokenizers emit at most one token per UTF-8 byte

This is not a billing guarantee, and none of it has been checked against a real OpenAI response or invoice.

### Remaining risks

- **Prices were not re-verified.** `OPENAI_MODEL_PRICES` is an approximate local table. If real prices are higher, the bound is too low and nothing detects it, because the check compares against the same table.
- **Non-default billing is outside the bound.** That covers non-default service tiers and provider surcharges.
- **A bound violation is detected after the fact.** That one call is already made, so it can pass the allowance, though the budget closes straight after.
- **Budget can go unused near the limit.** The byte-based bound runs well above real token counts for English text, and retries multiply it. A run can be refused with allowance left, by up to one reservation. Synthetic prompts measured 1.3 KB to 13 KB, reserving $0.0006 to $0.0041 on `gpt-4o-mini` and $0.009 to $0.068 on `gpt-4o`, with one retry.
- **Outages consume budget.** Failed attempts hold their bound for the rest of the run, even if the provider never billed them.
- **Very large prompts are refused.** Requests over 16000 bytes get `input_too_large`. The largest synthetic prompt was 13 KB, but real prompt sizes were not measured.
- **Custom endpoints use OpenAI prices.** A host that bills differently is not bounded correctly. This is documented in `.env.example` and the mission doc.
- **Fallback events show only the provider name.** The wrapper reports `openai-responses+fallback:heuristic` for all decisions. The cause is in the provider's ledger, which `AgentManager` does not surface.
- **`AgentManager` never calls the provider's `close()`.** This predates the PR and was left alone because `manager.ts` is out of scope.
- **Loopback mocks still receive the key.** Any local process listening on the configured port would get it.
- **SEC-001 interaction is still untested.** `manager.ts` and `executor.ts` remain unchanged.
