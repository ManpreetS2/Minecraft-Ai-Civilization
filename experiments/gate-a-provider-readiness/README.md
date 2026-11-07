# Gate A Provider Readiness: Independent GPT and Claude Citizens

This experiment prepares and independently exercises the dual GPT and Claude provider integration required for Gate A (the first controlled 1v1 Minecraft survival trial).

## Overview

The purpose is to prove that two autonomous citizens can deliberate through independent model-provider adapters (`OpenAiResponsesProvider` and `ClaudeMessagesProvider` + `createClaudeSdkTransport`) without sharing private memories, leaking context, exceeding budgets, or blocking each other on delays.

All tests operate strictly offline against simulated HTTP endpoints shaped from official provider documentation, guarded by network interceptors. No paid API requests are made.

## Structure

```
experiments/gate-a-provider-readiness/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── src/
│   ├── index.ts
│   ├── simulated-transports.ts       # Simulated HTTP responses for OpenAI /responses and Claude /messages
│   ├── provider-harness.ts           # Real AgentManager, CitizenProviderRegistry, SQLite store, mock bodies
│   └── runner.ts                     # Standalone verification runner producing JSON/Markdown reports
├── test/
│   ├── provider-independence.test.ts # 10 Section 3 tests proving isolation, concurrency, and persistence
│   └── provider-budgets-and-faults.test.ts # 11 Section 4 tests proving budgets, limits, and failure handling
├── docs/
│   ├── AUDIT_INFRASTRUCTURE.md       # Audit of existing provider codebases
│   ├── AUTHENTICATION_FEASIBILITY.md # Research on OpenAI/Anthropic API access vs subscriptions
│   └── OPERATOR_CHECKLIST.md         # Pre-flight checklist for the future authorized 1v1 trial
└── reports/
    ├── gate-a-readiness-report.json  # Machine-readable readiness report
    └── gate-a-readiness-report.md    # Human-readable scorecard and findings
```

## Running the Verification

### 1. Run Vitest Regression Tests
```bash
pnpm vitest run --config experiments/gate-a-provider-readiness/vitest.config.ts
```

### 2. Run Standalone Verification Runner
```bash
pnpm tsx experiments/gate-a-provider-readiness/src/runner.ts
```

### 3. Typecheck
```bash
pnpm --filter @civ/gate-a-provider-readiness typecheck
```
