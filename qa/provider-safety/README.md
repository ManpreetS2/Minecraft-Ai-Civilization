# Provider and offline safety review

Source under test: `875ebf707b93a082a6423c9a3aecc7d00ae02e48`. This branch adds only QA files. The isolated worktree was created directly at that candidate. No implementation fixes, ledger changes, Paper runs or paid calls were made. Node 22.12.0, pnpm 10.16.0, macOS.

Reviewed PR #42 (`1a690f62a3e75c8e3fe2ea6c9d1b984629f7da20`), #48 (`ae784fdcd41f00be4dc09f08e75bfaf02b9156df`), #54 (`b7f70dd0762b0f7b3a6308c6572d095e614b817e`), and their current integrated source in #56. The OpenAI provider matches #42; the integrated offline root adds body/fallback/credential restrictions beyond #48. Existing adversarial tests were read before adding tests. Results below come from the candidate, not those earlier tips.

## Assessment

- OFF-10: Independently supported for the supported offline composition interface. Direct/bound/wrapped transport injection and inherited forbidden keys are refused before secret resolution, including malformed initialization. Existing tests cover alternative Claude transports, getters, credentials, fallback/body refusal and usable lifecycle after rejected initialization. Unknown extra keys are ignored, not accepted as transports. Trusted script/body callbacks are arbitrary JavaScript: this is not an OS or in-process hostile-code sandbox. The `Data only` script comment is misleading; recommend describing it as trusted executable code.
- OFF-11: Independently supported within the controlled transport/budget contract. Retry/backoff cancellation, immediate pre-deadline cancellation, timeouts, failed admission, malformed/missing usage, retry ceilings, late replies and restart holds pass. Unsent cancelled retries do not increment sent counts. Unknown usage retains a hold and closes paid admission; zero accumulated known spend is not evidence of zero billing.
- OFF-12: Independently supported within the simulated mixed-provider contract. Simultaneous retries/shared ceiling, cancellation/timeout isolation, late stop replies, run shutdown, restart holds, attribution and private prompt separation pass. This does not prove actual remote billing, SDK behavior beyond the exercised transport contract, process-crash durability of an external store, or arbitrary callback isolation.

No security defect was established. No implementation was changed. These are independent implementation findings, not formal OFFLINE_PASS or acceptance-ledger updates.

## Commands and results

Run from repository root, serially:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run --config qa/provider-safety/vitest.config.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run --config qa/v1/vitest.config.ts qa/v1/test/adv-provider-faults.test.ts qa/v1/test/adv-offline-boundary.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run packages/cognition/src/openai-retry.test.ts packages/cognition/src/openai-usage-regression.test.ts packages/cognition/src/routing/mixed-provider-faults.test.ts apps/orchestrator/src/independent-offline-default-deny.test.ts apps/orchestrator/src/independent-offline-runtime.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec eslint qa/provider-safety/test/boundaries.test.ts qa/provider-safety/vitest.config.ts
```

Actual outputs are in `evidence/`. New tests: 10 passed, 0 failed, 0 skipped, exit 0. Existing adversarial tests: 27 passed, 0 failed, 0 skipped, exit 0. Lint: exit 0. Source suites: 97 passed, 0 failed, 0 skipped, exit 0. Total: 134 passing tests. Socket/DNS/UDP denial is installed by test-support/setup.ts; global fetch is also denied in the new suite. Loopback is permitted by the shared guard; an existing redirect regression uses a temporary loopback HTTP server. No external provider endpoint is contacted.

## New test attribution

`test/boundaries.test.ts` invokes the actual offline composition function and actual CitizenProviderRegistry/OpenAiResponsesProvider/ClaudeMessagesProvider with existing scripted transports. It does not copy provider implementations. All ten cases passed:

| Cases | Expected behavior established |
| --- | --- |
| Four transport variants on inherited malformed input | Reject before any credential lookup or transport invocation |
| Cancel at retry deadline minus 1 ms | One request sent and charged; zero retries |
| Two malformed usage responses | Positive unverified hold; admission closed |
| Two late responses after run shutdown | No decisions, two sent requests, no outstanding reservations or cross-citizen memory |
| Zero shared request budget | Neither transport invoked; zero sent count |
| Changed persisted provider family | Restart rejected before transport initialization |

Existing tests supply the remaining matrix rather than duplicating it: adv-provider-faults covers both-family retries/cancellation/ceilings/unknown usage/restart; adv-offline-boundary covers initialization and trust limits; openai-retry and openai-usage-regression exercise real provider timing and accounting; mixed-provider-faults exercises shared policy closure and interrupted restart; independent-offline-runtime/default-deny exercise composition lifecycle and refusal.

To reproduce a new boundary independently, append `-t 'cancel immediately'`, `-t 'malformed GPT usage'`, or `-t 'run shutdown'` to the new-suite command. No failing reproduction is claimed. Integration must rerun these tests at its final SHA and apply the required independent acceptance process; this report cannot transfer passing evidence to a different source revision.
