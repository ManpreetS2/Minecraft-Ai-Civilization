# Per-citizen GPT and Claude provider routing

Status on 2026-11-01: **implemented and tested offline. Not wired into `AgentManager` on this branch, and never run against a real API.** Base: `agents/t3-sec001-cloud-reconciliation` at `7c039ec`.

| Claim | Status |
| --- | --- |
| Four independent citizen sessions through the real decision interface | Yes, offline |
| GPT path uses the real `OpenAiResponsesProvider` | Yes, against a scripted fetch |
| Claude path | Real provider logic against a scripted transport. **No live transport exists** |
| `AgentManager` routes per citizen | **No, not on this branch.** See "Manager wiring" |
| Any paid or real API request | **Never made** |
| Real 1v1 or 2v2 | **Not run** |

## What was shared before

| Item | Where | Effect |
| --- | --- | --- |
| One provider | `manager.ts`: `this.cognition = createCognition(config)` | All citizens share one model and session |
| One thinking slot | `manager.ts`: module-level `let llmInFlight`, checked with `llmInFlight === 0` | Only one citizen in the process can think at a time. It is also shared between manager instances |
| One model and key | `shared/src/config.ts`: `OPENAI_MODEL`, `OPENAI_API_KEY`, and only an `openai` cloud provider | No way to assign a family per citizen |
| No Claude provider | `cognition/src/index.ts` | `@civ/session-isolation` has a mock Claude adapter only, and production never imports that package |
| Cancellation | `OpenAiResponsesProvider.close()` | Permanently closes the provider and the budget it holds, so one citizen could not be cancelled alone |
| Cost attribution | `CloudBudgetGate` | Experiment totals only |

**Why not `@civ/session-isolation`?** It models chat sessions that replay history, with their own usage counters. PR #4's cost controls live in the `CognitionProvider` layer, and what a citizen knows must come from gated store reads on each decision. Routing at the `CognitionProvider` level keeps those guarantees without a second engine. That package is unchanged.

## What exists now

Import from `@civ/cognition/routing`. New code is in `packages/cognition/src/routing/`.

```ts
const registry = new CitizenProviderRegistry({
  runId,
  assignments,            // explicit for each citizen; there is no default
  experiment: { maxConcurrency, maxRequestsPerRun, spendAllowanceUsd },
  resolveSecret,          // CredentialRef -> value; keys are never stored or logged
  store,                  // survives restart: identity and accounting only
  fetchImpl,              // or allowPaidRequests: true, which is off by default
  claudeTransportFor,     // required for Claude citizens
  onEvidence,
});

const session = registry.providerFor(citizenId); // a CognitionProvider, or throws UNASSIGNED
await session.decide(prompt, timeoutMs);
session.cancel();                                // this citizen only; any late reply is discarded
session.suspend(reason); session.resume();       // body disconnect and reconnect
registry.accounting();                           // experiment totals plus each citizen
registry.evidenceLog();                          // per-decision record without prompt text
registry.closeAll();
```

### Guarantees tested offline

- **Identity:** a stable session per citizen. A prompt for another citizen is refused before sending, and family and model never depend on community.
- **Isolation:** separate provider instances, credentials and settings. Prompts are not replayed, so no context carries over within or between citizens.
- **Failure:** a timeout, invalid JSON, cancellation or close affects one citizen only.
- **One exception, by design:** missing or unbounded usage closes the budget for **all** citizens, because you directed that the budget stays closed for the run. The shared ceiling can no longer be trusted at that point.
- **Late replies:** a reply arriving after `cancel` is refused with `STALE_RESPONSE`.
- **Fallback:** `none` by default, otherwise `heuristic` or loopback Ollama. It runs only after a cost-policy stop, never on an ordinary failure.
- **Restart:** the same run restores sessions and spending, and in-flight work becomes a hold. A changed family or model is refused. A new run starts fresh.
- **Paid guard:** nothing reaches a network unless `fetchImpl` is injected or `allowPaidRequests` is deliberately set.

### Accounting

Each citizen gets a `CitizenBudgetView` over the one shared `CloudBudgetGate`, so PR #4's rules still set the ceiling. The view adds requests, retries, refusals, tokens, estimated spend, holds and reservations per citizen, plus optional per-citizen limits.

Holds are not spend, so `estimatedSpendUsd` comes only from reported usage. Without per-citizen limits, one citizen can use up the shared allowance, so set `limits` if each family should have a fair share.

## Claude provider assessment

No production Claude adapter existed. `ClaudeMessagesProvider` applies the same cost rules as the OpenAI provider to an injected transport.

| Topic | Decision |
| --- | --- |
| Live transport | **Not included.** It needs the official `@anthropic-ai/sdk` dependency, which is deliberately not added |
| Schema | Separate from OpenAI's, because Claude's structured outputs reject `minimum`, `maximum`, `minLength` and `maxLength`. `validateDecision` enforces those ranges |
| Server-side `fallbacks` | **Deliberately off**, and differs from the provider's general recommendation. You prohibited automatic switching to another paid model. A refusal stays a refusal |
| Model check | A response naming a different model than requested closes the budget |
| Thinking | Not configured directly, because `disabled` is rejected on current Opus and Sonnet. Depth is set with `effort` |
| Output limit | Thinking counts toward `max_tokens`, so Claude citizens need far more than the GPT default of 128 |
| Prices | Allowlist and prices are in `cloud-prices.ts`, from list prices cached on 2026-10-06. Check them before any paid run |
| Claude Pro or the CLI | Not application API access. A real API key and billing are needed |

### Before any live Claude call

1. **Owner approval for paid requests.** Nothing here grants it.
2. Add `@anthropic-ai/sdk` and a transport around `client.messages.create(request, { signal })` with `maxRetries: 0`. SDK errors carry the `status` this provider reads. The provider must own retries, or attempts go uncharged.
3. **Measure a real response** to check the 1024-token framing allowance, how much `max_tokens` thinking uses at each effort level, and how refusals report usage.
4. Check that the prompt's characters per token stay within the bound for the chosen tokenizer. Reported usage above the bound closes the budget.
5. Decide whether `claude-opus-5-5` or another model is the experiment's assignment. The fixture's models are only examples, and comparisons between families depend on this choice.

**Mock limits:** the scripted transport follows the documented shape. It does not prove the API accepts this request or this schema.

## Manager wiring

These are the changes needed in `manager.ts`, which T3 owns. A tested proposal is on `agents/claude-routing-manager-proposal`. Merge or adapt it.

1. Add a hook, typed structurally so `agent-core` does not import the registry:
   ```ts
   export type CitizenCognitionRouter = {
     providerFor(citizenId: string): CognitionProvider & { cancel(): void };
     closeAll(): void;
   };
   export type AgentManagerHooks = { drainTimeoutMs?: number; cognitionRouter?: CitizenCognitionRouter };
   ```
2. In `tickCitizen`, replace `this.cognition.decide(...)` with the citizen's provider. An unassigned citizen must skip thinking, never use a global provider.
3. Replace the module-level `llmInFlight === 0` check with a per-citizen flag when a router is present.
4. Call `providerFor(id).cancel()` on body death and on `stopCitizen`.
5. Call `closeAll()` in `performStop`.
6. Build the registry in `apps/orchestrator`. The owner must decide how assignments are configured, because `shared/src/config.ts` is integration-owned.

## Conflicts with T3's branches

| File | Change here | Risk |
| --- | --- | --- |
| `cognition/src/openai-responses.ts` | Budget type widened, `cancelInFlight` added, system prompt exported | Low |
| `cognition/src/cloud-budget.ts` | `CloudBudget` type, `restoreCommitted` added | Low |
| `cognition/src/cloud-prices.ts` | Claude table added, lookup covers both tables | Low |
| `cognition/package.json` | `./routing` export | Low |
| `cognition/src/routing/*`, this document | New | None |

`manager.ts`, `executor.ts`, `shared/src/config.ts` and `cognition/src/index.ts` are not changed on this branch.

## Running the fixture

```bash
pnpm exec vitest run citizen-routing
```

`offlineRegistry()` in `routing/offline-fixture.ts` gives T3 a 2v2 registry with scripted replies. Pass one GPT and one Claude assignment for 1v1. It cannot reach a network.
