# Cognition V2 Audit

Audit of the **real** cognition/memory/psychology stack on `feat/cognition-v2-real` (based on `feat/persistent-memory-psychology`). Cloud kits were not found on this machine; nothing was wholesale-replaced.

This is a **pure cognition** branch. It does not prove live Minecraft behavior.

Legend: **KEEP** / **EXTEND** / **SIMPLIFY** / **REPLACE** / **MISSING**

## Architecture (KEEP)

Minecraft body ≠ persistent citizen identity ≠ cognition/mind.

Cognition receives verified facts. It never invents physical world truth. LLM chooses high-level **what**. Runtime chooses **how**. Minecraft verifies whether it happened.

## Subsystems

| Subsystem | Verdict | Notes |
| --- | --- | --- |
| `CognitionService` | KEEP + EXTEND | Real decide/reflect loop, cooldown, stale drop, heuristic fallback. Do not replace. Wire `worldHash` at Agent #1 integration time. |
| `ModelRouter` | KEEP | `NO_LLM` / `ROUTINE_DELIBERATION` / `DEEP_REFLECTION`. Model never chooses privilege. |
| `CognitionContextBuilder` | KEEP | Compact engine-aware context. Does not dump mechanics encyclopedia. |
| `packages/memory` CognitiveStore | KEEP | SQLite identities, memories, beliefs, habits, associations, lessons, experience ledger. |
| `packages/psychology` CitizenMind | KEEP | Ingest, hear, retrieve, snapshot, consolidate, local beliefs. |
| `ExperienceLedger` | KEEP + EXTEND | Single implementation. Failure classification + candidate engine rules already exist. Do not duplicate. |
| Goal enums | EXTEND | Real names kept (`gather_wood`, `use_storage`, `assist_citizen`, `reconsider`, …). Added `return_to_settlement`, `transfer_item`. Aliases for `deposit_items` / `withdraw_items` / `idle` / `gather_stone`. |
| Decision schemas | EXTEND | Legacy `CognitionDecision` kept for planner compatibility. New `BoundedDecision` is the integration contract. |
| Prompt builders | KEEP | No personality injection; privileged fields rejected. |
| Heuristic fallback | EXTEND | Personal food ≠ settlement `NEED_FOOD`. Multi-citizen `pickUnused`. |
| Reflection hooks | KEEP | Rare triggers only; structured proposal; no objective-fact writes. |
| Social belief types | KEEP | Pairwise trust/affection/respect/resentment/familiarity. Rumors vs knownFacts. No global reputation. |
| Appraisal | KEEP | Deterministic bounded dimensions. Influences emotion/salience, not scripted tasks. |
| Habit / association | EXTEND | Existing reinforce/weaken/decay. Added bounded `recalibrateAssociation`. |
| Storage persistence | KEEP | SQLite in `@civ/memory`. Obligations are in-memory until Agent #1 persists them (documented). |
| Tests | EXTEND | Existing v2/learning/scenarios plus contract, food, NO_LLM, diversity, perspective fixtures. |
| Benchmark harness | EXTEND | Existing `BENCHMARK_SCENARIOS` kept. Added ≥150 portable `COGNITION_VECTORS`. |

## Memory taxonomy (KEEP, do not rename)

Real names are already established. Map the ticket vocabulary; do not create duplicates.

| Ticket name | Real name |
| --- | --- |
| RECENT | `immediate` (TTL) |
| EPISODIC | `episodic` |
| SEMANTIC | `semantic` |
| SOCIAL | `social` |
| LESSON | `LearningLesson` table (not a memoryType) |
| RECORDED | `RECORD` provenance |

Provenance already: `DIRECT` \| `WITNESSED` \| `HEARD` \| `RECORD` \| `INFERRED`.

## What was extended on this branch

- Bounded decision contract + compact world-state hash
- Compound-goal safe split + `EXECUTION_LEVEL` rejection
- Pure fact guards (personal food, health, creeper, tools, completed project)
- Staleness reasons: directive, project, tool lost, world hash
- Speech gate / speech-is-not-action
- Obligation board (fulfill requires verified event id)
- Compact `MindSnapshot` + observer debug snapshot (no hidden CoT)
- Retrieval diversity (max two near-identical patterns)
- Queue metadata + anti-monopoly pick
- Cooldown keyed by optional world hash
- Portable cognition vectors + evaluator

## Intentionally not replaced

Do not port cloud package layouts over these real modules:

- `CitizenMind`, `CognitiveStore`, `ExperienceLedger`
- `ModelRouter`, `CognitionService`, `classifyFailure`
- Deterministic appraisal / social evidence / behavior profile

## Missing / Agent #1 must wire

These are **not** implemented here on purpose:

- AgentManager / Mineflayer / pathfinding / planner runtime
- Physical flee, eat, transfer, bed, storage, building
- Dashboard
- SQLite persistence of `ObligationBoard`
- Coupled LLM scheduler inside the Minecraft tick
- Live Ollama bakeoff while Agent #1 may be using the GPU

## Cloud kits

Searched Desktop, Downloads, Documents, and the repo parent for:

- `cognition-transplant-kit.zip`
- `cognition-integration-kit-v2.zip`
- `cognition-decision-contract-v4.patch` / `.bundle`
- `cognition-test-vectors.json` / `cognition-v2-vectors.json`

**Result: none found.** No patch was applied.

## Invariants this branch encodes

1. Cognition never invents world facts.
2. Personal edible inventory ≠ settlement food reserve.
3. Speech is not a completed physical action.
4. NETWORK/SERVER/INFRASTRUCTURE failures never become citizen lessons.
5. Path/skill failure is not a bad high-level decision.
6. No global `citizen.reputation`.
7. No preset bravery/kindness/ambition sliders.
8. No hidden chain-of-thought storage.
9. Body death (`SIM_PERMADEATH_ENABLED=false`) does not erase identity or memory.
10. Personality summary text is observer-facing, not causal input.
