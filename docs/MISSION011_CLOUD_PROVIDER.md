# Mission 011 — Minimal Cloud LLM Provider Integration

**Date:** 2026-10-27  
**Branch:** `dev/demo-simplification-20261027`  
**Scope:** Offline, mock-tested OpenAI Responses API adapter on the existing `CognitionProvider`. No paid calls. No Minecraft.

## Status distinction

| Claim | Status |
| --- | --- |
| Code integrated with cognition factory + allowlist/autonomy stack | **Yes (offline)** |
| Mock HTTP suite covering auth/budget/errors | **Yes** |
| Real OpenAI API smoke test / paid request | **Not authorized / not run** |
| Three-citizen live demo readiness | **Not claimed** |

## Architecture

```
AppConfig (CLOUD_LLM_ENABLED default false)
  └─ createCognition(config, { fetchImpl? })
       ├─ heuristic          # disabled / misconfigured
       ├─ ollama             # local (unchanged)
       └─ openai-responses   # OpenAiResponsesProvider
            ├─ CloudBudgetGate (admit → request → reconcile)
            ├─ CloudDecisionLedger (structured records, no API keys)
            ├─ POST {baseUrl}/responses  (structured JSON schema)
            └─ validateDecision → HighLevelDecision
                 └─ AgentManager pendingLlm → planCitizen → dispatch → executePlan
```

Preserved contract: `CognitionProvider.decide(prompt, timeoutMs) → HighLevelDecision`.

No Cognition V2, no second planner, no tool/function calling to the model.

## Request contract (OpenAI Responses API)

- Endpoint: `POST /v1/responses`
- `store: false`
- `max_output_tokens` from config
- `text.format` = strict `json_schema` for `{ goal, priority, reason, targetCitizenId? }`
- `goal` enum = cognition `GOALS`
- System prompt forbids chain-of-thought, code, shell, Minecraft commands
- No `tools` parameter

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `LLM_PROVIDER` | `ollama` | Set `openai` for cloud |
| `LLM_ENABLED` | `false` | Must be true with cloud |
| `CLOUD_LLM_ENABLED` | `false` | **Required**; `OLLAMA_ENABLED` never enables cloud |
| `OPENAI_API_KEY` | empty | Env only; never commit |
| `OPENAI_MODEL` | `gpt-4o-mini` | Allowlisted models only |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | |
| `CLOUD_TIMEOUT_MS` | 30000 | |
| `CLOUD_MAX_OUTPUT_TOKENS` | 128 | Cap ≤ 512 |
| `CLOUD_MAX_CONCURRENCY` | 1 | |
| `CLOUD_MAX_REQUESTS_PER_RUN` | 60 | Run budget |
| `CLOUD_SPEND_ALLOWANCE_USD` | 1.0 | Local estimate ceiling |
| `CLOUD_MAX_RETRIES` | 1 | 429/500/503 only; **never** retry 401 |
| `LLM_COOLDOWN_MS` | 60000 | Existing manager cooldown |

## Cost safeguards

1. Admit only if requests/spend/concurrency allow (reserve ~$0.01 then reconcile).  
2. Estimate cost from `docs`-adjacent `OPENAI_MODEL_PRICES` (USD / 1M tokens).  
3. Ledger stores tokens + estimated USD — **not** API keys.  
4. Fail closed when budget exhausted.  
5. Estimates are local safeguards, not invoice guarantees.

## Decision lifecycle

1. Manager eligibility (`LLM_ENABLED`, cooldown, etc.)  
2. `decide()` → budget admit  
3. HTTP Responses call (or mock)  
4. Validate JSON → `HighLevelDecision`  
5. Ledger success/failure record  
6. `pendingLlm` → planner autonomy + Mission 010 integrity  

Failures surface as thrown errors → existing `LLMSkipped` path in AgentManager.

## Setup steps (when a paid smoke test is later authorized)

1. Obtain a real OpenAI **API** key (not ChatGPT Plus alone).  
2. Set `LLM_PROVIDER=openai`, `LLM_ENABLED=true`, `CLOUD_LLM_ENABLED=true`, `OPENAI_API_KEY=...`.  
3. Keep spend/request caps low for first run.  
4. Run a single offline unit with live fetch only under explicit operator approval (not part of this mission).

## Test coverage

`packages/cognition/src/openai-responses.test.ts` — cases 1–20 (disabled default, valid/invalid JSON/goals, missing key, 401/429/500, timeout, retry exhaustion, budgets, tokens/cost, no key leak, concurrency, stale abort, shutdown, allowlisted goals, ollama/heuristic factory, mock-only network).

## Offline limitations / risks

- Structured Outputs shape may evolve; adapter isolates Responses payload parsing.  
- Price table can drift from OpenAI billing.  
- Manager still uses narrow `llmDue` triggers.  
- No live multi-citizen cloud latency measurement yet.

## Files

- `packages/shared/src/config.ts` — cloud env fields  
- `packages/cognition/src/config.ts` — resolve cloud vs ollama enablement  
- `packages/cognition/src/openai-responses.ts` — provider  
- `packages/cognition/src/cloud-budget.ts` / `cloud-prices.ts` / `decision-record.ts`  
- `packages/cognition/src/index.ts` — factory  
- `packages/cognition/src/openai-responses.test.ts`  
- `.env.example`  
- `docs/MISSION011_CLOUD_PROVIDER.md`
