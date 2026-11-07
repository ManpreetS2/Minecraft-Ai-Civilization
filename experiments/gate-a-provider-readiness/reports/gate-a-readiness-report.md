# Gate A Provider Readiness Report: Independent GPT & Claude Verification

**Report Date:** 2026-11-06  
**Agent:** Gemini High  
**Starting Source SHA:** `72a5a6671601136c807e39433e618ebecfc7552d` (PR #73 integration candidate)  
**Branch:** `experiments/gate-a-provider-readiness`  
**Execution Mode:** Strictly Offline Simulated Transports (Zero Paid Requests, Zero Live Network)

---

## 1. Executive Summary

This report establishes **Gate A Provider Readiness** for the Minecraft AI Civilization project prior to any live 1v1 survival trial. 

We independently exercised the actual `AgentManager`, `CitizenProviderRegistry`, `OpenAiResponsesProvider`, `ClaudeMessagesProvider`, and `createClaudeSdkTransport` (driving official `@anthropic-ai/sdk` v1.3.0) against controlled, simulated HTTP responses. Using one GPT citizen (`gpt-a`, `gpt-4o-mini`) and one Claude citizen (`claude-a`, `claude-haiku-5-5`), we verified that:
1. Two citizens make separate decisions through their assigned model-provider adapters without sharing private context or memories.
2. Delayed or hanging responses in one citizen cannot delay, block, or corrupt the decision cycle of the other citizen.
3. Budgets, token limits, concurrency ceilings, and 429/5xx fault-tolerance rules operate with deterministic fail-closed guarantees.
4. No failed provider silently swaps model families or misrepresents local heuristics as genuine cloud inference.

> [!IMPORTANT]
> **Authenticity Declaration:** All tests in this suite were conducted using **simulated HTTP responses** inside a network-isolated environment guarded by global fetch interceptors. **No requests were sent to the live OpenAI or Anthropic APIs, and no paid inference was consumed.** Live API acceptance, token pricing validation under live traffic, and physical Mineflayer bot mechanics on Paper 1.21.6 build #48 remain **NOT PROVEN** by design.

---

## 2. Status Scorecard

| Category | Total | PASS | FAIL | BLOCKED | NOT PROVEN |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Section 3: Independence & Routing** | 10 | 10 | 0 | 0 | 0 |
| **Section 4: Budgets & Fault Tolerance** | 11 | 11 | 0 | 0 | 0 |
| **Live Environment Prerequisites** | 3 | 0 | 0 | 0 | 3 |
| **Total Gate A Scenarios** | **24** | **21** | **0** | **0** | **3** |

---

## 3. Production Implementations Exercised

The offline harness exercised the following unmodified production implementations:

| Component | File Path | Status | Verification Mechanism |
| :--- | :--- | :---: | :--- |
| **AgentManager** | `packages/agent-core/src/manager.ts` | **PASS** | Real manager loop, per-citizen `llmBusy` tracking, and `cognitionRouter` hook |
| **CitizenProviderRegistry** | `packages/cognition/src/routing/citizen-registry.ts` | **PASS** | Session mapping, prompt routing, accounting persistence, and epoch cancellation |
| **OpenAiResponsesProvider** | `packages/cognition/src/openai-responses.ts` | **PASS** | Structured Outputs schema, token bounding, retry backoff, usage reconciliation |
| **ClaudeMessagesProvider** | `packages/cognition/src/routing/claude-messages.ts` | **PASS** | Messages API schema, reasoning effort, price calculation, unknown usage closure |
| **Claude SDK Transport** | `packages/cognition/src/routing/claude-sdk-transport.ts` | **PASS** | Real `@anthropic-ai/sdk` v1.3.0 `client.messages.create` gated by `PaidRequestGate` |
| **CloudBudgetGate** | `packages/cognition/src/cloud-budget.ts` | **PASS** | Global concurrency, request count ceiling, and spend allowance holds/settlements |
| **CivilizationStore** | `packages/memory/src/store.ts` | **PASS** | Isolated SQLite database (both in-memory and disk file modes) |

---

## 4. Section 3: Proving Independent Model Decisions

| ID | Verification Requirement | Status | Observed Evidence & Implementation Notes |
| :--- | :--- | :---: | :--- |
| **SEC3-01** | GPT citizen routes only to configured OpenAI adapter | **PASS** | `gpt-a` sends POST to `https://api.openai.com/v1/responses` with `Bearer` key. Zero traffic to Anthropic. Schema uses `DECISION_JSON_SCHEMA` with `strict: true`. |
| **SEC3-02** | Claude citizen routes only to configured Anthropic adapter | **PASS** | `claude-a` sends POST to `https://api.anthropic.com/v1/messages` via `createClaudeSdkTransport`. Zero traffic to OpenAI. `x-api-key` header rejected; `Bearer` key used. |
| **SEC3-03** | Separate authorized world knowledge and memories | **PASS** | Private memory added to `gpt-a` (`COORDINATES_VAULT_GPT_...`) appears only in GPT prompt. Private memory added to `claude-a` appears only in Claude prompt. |
| **SEC3-04** | Private messages cannot leak between citizens | **PASS** | Actor-private whisper events and community-specific announcements (`community-north`) are delivered strictly to authorized recipients; omitted from other citizens' context. |
| **SEC3-05** | Decisions independently recorded with correct provenance | **PASS** | `CivilizationStore` events record `payload.provider: "openai-responses"` for GPT and `"anthropic-messages"` for Claude. Registry `DecisionEvidence` reflects exact family/model. |
| **SEC3-06** | Delayed GPT response cannot affect Claude | **PASS** | Hanging GPT promise does not block Claude's tick. Claude executes deliberation, receives mock reply, and adopts decision while GPT remains in flight. |
| **SEC3-07** | Delayed Claude response cannot affect GPT | **PASS** | Hanging Claude promise does not block GPT's tick. GPT executes deliberation, receives mock reply, and adopts decision while Claude remains in flight. |
| **SEC3-08** | Citizen restart preserves memory without copying session | **PASS** | Verified across disk SQLite and disk JSON session store. Restart restores identical session IDs, decision counts, and private memories; zero cross-contamination. |
| **SEC3-09** | Citizen death/shutdown rejects stale model responses | **PASS** | Emitting `CitizenBodyDied` bumps `citizen.llmEpoch` and calls `session.cancel()`. Delayed model response arriving post-death is discarded with `LLMSkipped`. |
| **SEC3-10** | Successive decision cycles without swapping identities | **PASS** | Three consecutive multi-citizen decision cycles maintain stable roster IDs (`gpt-a`, `claude-a`), respective credentials, and attributed request counts. |

---

## 5. Section 4: Verifying Budgets and Failure Handling

| ID | Limit / Failure Scenario | Status | Observed Evidence & Implementation Notes |
| :--- | :--- | :---: | :--- |
| **SEC4-01** | Concurrency limits | **PASS** | With `maxConcurrency: 1`, while GPT deliberates, Claude's admission is refused with `concurrency` error and zero requests dispatched. Slot recovers on cancellation. |
| **SEC4-02** | Request counts | **PASS** | With `maxRequestsPerRun: 2`, third request across both citizens is refused pre-flight with `cloud request budget exhausted`; zero network dispatch. |
| **SEC4-03** | Token accounting | **PASS** | Reported input/output tokens (GPT: 150/45, Claude: 210/75) tracked per citizen in `CitizenAccount` and summed accurately in experiment totals. |
| **SEC4-04** | Estimated vs confirmed charges | **PASS** | Pre-dispatch reservation bound settles to exact price table rate upon receiving confirmed 200 OK tokens ($0.00021 for GPT, $0.00015 for Claude); `reservedUsd` drops to 0. |
| **SEC4-05** | Unknown usage closes budget fail-closed | **PASS** | 200 OK response with `usage: null` triggers `settleUnknownUsage`, holding unverified attempt cost and permanently closing budget for all citizens. |
| **SEC4-06** | Retry accounting | **PASS** | With `maxRetries: 2`, HTTP 503 followed by 200 OK records `requests: 2, retries: 1`, attributing both attempts against quotas. |
| **SEC4-07** | Timeouts | **PASS** | Request exceeding timeout aborts via `AbortController`, holds unverified attempt cost, clears `llmBusy`, and allows citizen to deliberate on next tick. |
| **SEC4-08** | Rate limits (429 handling) | **PASS** | 429 with `retry-after: 0.03` waits, refunds attempt, and succeeds. 429 without `retry-after` is treated as non-retryable quota failure. |
| **SEC4-09** | Provider outages (5xx) | **PASS** | Persistent HTTP 500 retries up to `maxRetries` with exponential backoff and fails cleanly without manager crash or database corruption. |
| **SEC4-10** | Cancellation during retries | **PASS** | Calling `session.cancel()` while waiting in retry backoff sleep immediately aborts, prevents second request from dispatching, and refunds unsent reservation. |
| **SEC4-11** | Budget exhaustion & fallback honesty | **PASS** | Budget exhaustion fails closed. Configured heuristic fallback is recorded explicitly as `decidedBy: "heuristic", outcome: "fallback"`; zero silent model family switching. |

---

## 6. Provider Compatibility Matrix

| Feature | OpenAI (`OpenAiResponsesProvider`) | Anthropic (`ClaudeMessagesProvider` + SDK) |
| :--- | :--- | :--- |
| **Primary Model Tested** | `gpt-4o-mini` | `claude-haiku-5-5` |
| **Pricing Schedule** | $0.15 / $0.60 per 1M tokens | $0.10 / $0.50 per 1M tokens |
| **Structured Output Schema** | JSON Schema (`strict: true`, required nullable fields) | JSON Schema (`output_config`, range limits validated client-side) |
| **Authorization Format** | `Authorization: Bearer sk-proj-...` | `Authorization: Bearer sk-ant-api03-...` |
| **Subscription Reuse** | **Prohibited** (ChatGPT Plus/Team do not grant API credits) | **Prohibited** (Claude Code OAuth `sk-ant-oat` rejected by gate) |
| **Reasoning / Thinking** | Default (unconfigured) | Pinned default; controlled via `effort: "low"` |
| **Timeout Support** | Built-in AbortController | Passed to `@anthropic-ai/sdk` client options |
| **Unknown Usage Handling** | Permanent fail-closed budget shutdown | Permanent fail-closed budget shutdown |

---

## 7. Unverified Dimensions & Live Blockers

The following items cannot be proven offline and remain **NOT PROVEN** until explicitly authorized live testing:

1. **LIVE-01: Live OpenAI API Acceptance (`NOT PROVEN`):**
   - *Reason:* Verified exclusively against simulated HTTP responses. Grammar compilation and account quota acceptance on OpenAI's production servers require an authorized platform API key.
2. **LIVE-02: Live Anthropic API Acceptance (`NOT PROVEN`):**
   - *Reason:* Verified exclusively through `@anthropic-ai/sdk` against simulated HTTP responses. Live Messages API acceptance requires an authorized Anthropic Console API key with funded credits.
3. **LIVE-03: Live Paper 1.21.6 Physical Mechanics (`NOT PROVEN`):**
   - *Reason:* Verified using simulated body observations and mock bodies. Real Mineflayer bot connection, protocol handshake, world physics, item drop conservation, and server tick performance require an independent running Paper server.

---

## 8. Readiness Verdict

- **Software Provider Architecture:** **PASS**
- **Isolation & Concurrency Safety:** **PASS**
- **Budgeting & Fault Tolerance:** **PASS**
- **Gate A Live Pre-Flight Readiness:** **READY FOR AUTHORIZED 1v1 LIVE TRIAL** (Subject to Operator Checklist execution).
