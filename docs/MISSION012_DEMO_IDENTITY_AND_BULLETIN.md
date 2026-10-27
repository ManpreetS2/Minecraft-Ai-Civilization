# Mission 012 — Three-Citizen Identity, Demo Configuration & Perspective-Aware Memory

**Status:** Offline implementation complete. Does **not** claim the first live demo is ready.  
**Branch:** `dev/demo-simplification-20261027`  
**Prior checkpoint (Mission 011):** `85420f2` on private backup remote.

## Configuration contract

Opt-in via env (defaults preserve historical five-citizen setups):

| Variable | Default | Demo requirement |
| --- | --- | --- |
| `DEMO_PROFILE` | `none` | `three_citizen` |
| `SIM_CITIZEN_COUNT` | `5` | `3` |
| `SIM_ASSIGN_WORK_ROLES` | `false` | `false` |
| `SIM_PERMADEATH_ENABLED` | `false` | `false` |
| `DEMO_PERSONALITY_SEED` | `civ-demo-2026` | non-empty recorded seed |
| `DEMO_RUN_MINUTES` | `60` | target run length |
| `DEMO_BULLETIN_TARGET_TOKENS` | `200` | ~150–250 bulletin budget |

`validateThreeCitizenDemo(config)` fails closed with explicit errors when constraints are violated.  
`AgentManager.start()` validates when `DEMO_PROFILE=three_citizen` and forces roster size 3 (Atlas, Maya, Theo).

Profile asserts: no mayor, no occupations, no economy/contractor, no starter gifts, `keepInventory=false` **requirement** (must still be verified on the live Paper world during Gate B — config alone is not proof).

Does **not** auto-start simulation.

## Trait generation and persistence

Eight axes (0–100): work ethic, aggression, social trust, empathy, curiosity, risk tolerance, sociability, leadership drive.

- **RNG:** Mulberry32 seeded by FNV-1a of `` `${masterSeed}:${citizenId}:personality-v1` ``.
- **Distribution:** Irwin–Hall *n*=4 of U(0,1), scaled to 0–100 (middle values more common than extremes).
- **Persistence:** `citizens.personality_json`; `ensurePersonality` / upsert `COALESCE` never silently overwrite existing traits.
- **Usage:** `formatPersonalityTendencies` injects neutral tendency text into `CognitionPrompt.personalityContext`. Traits do **not** force attacks, role refusal, or mayoral appointment.

## Event visibility rules

Payload key `visibility` (`packages/shared/src/event-visibility.ts`):

| Class | Citizen access |
| --- | --- |
| `world_public` / `settlement_public` | All citizens |
| `directed` | Listed `audienceIds` only |
| `nearby_speech` | Explicit substantiated `audienceIds` only (no invented proximity) |
| `actor_private` | Owner only |
| `observer_only` | Never to citizens |
| `unknown` / missing | **Fail closed** (never world-public) |

## Bulletin construction

Deterministic pipeline (`packages/shared/src/bulletin.ts`):

observation → visibility authorization → skip already-delivered → urgency rank → dedupe → aggregate → compact text (~token estimate chars/4).

Urgent items may exceed budget with a logged `urgent_overflow` note. Lines are labeled `observed_fact` (not suspicion).

## Privacy protections

Citizens do not automatically receive: private thoughts/goals/memories, unshared inventory, private conversations, unobserved discoveries, observer-only debug records.

Delivery checkpoints: `citizen_event_delivery` (per citizen × event id). Late-visible events remain eligible because checkpoints track IDs, not a single advancing watermark past unauthorized events.

Observer audit: `listAllEventsForObserver` (unfiltered).

## Integration path

```
Minecraft observations / SimEvent bus
  → CivilizationStore.appendEvent
  → buildCitizenContextPack (personality + authorized bulletin)
  → CognitionProvider.decide (existing goal allowlist)
  → planCitizen / resolveModelGoalForPlanner
  → enforceModelOriginatedPlan → executePlan
```

Wired in `AgentManager` LLM deliberation path. No Cognition V2 / CitizenMind activation. Legacy memory retrieval remains citizen-scoped via `getMemories(citizenId)`.

## Offline test evidence

Focused suites (2026-10-27, offline, no Minecraft / no paid API):

| Suite | Result |
| --- | --- |
| `packages/shared/src/demo-identity.test.ts` | 14 passed |
| `packages/agent-core/src/demo-identity.test.ts` | 4 passed |
| `packages/shared/src/shared.test.ts` | 7 passed |
| `goal-dispatch` + `dispatch-integrity` + `openai-responses` + `cognition` | 56 passed |
| `autonomy-precedence` + `planner` + `store` | 66 passed |
| **Combined focused run** | **147 passed** |

Typecheck: `@civ/shared` pass; `@civ/cognition` pass; `@civ/agent-core` still reports **pre-existing** errors in construction/fish/combat/navigation paths (unrelated to Mission 012). No new errors in Mission 012 modules.

## Remaining blockers

### Gate A (offline / engineering)

- Live spawn suitability not verified from config.
- Existing events emitted without `visibility` remain citizen-invisible until tagged (intentional fail-closed).
- Social chat / settlement shortcuts should continue to be audited when emitting new event types.

### Gate B (live demo preparation — not done here)

- Paper `keepInventory=false` and natural spawn conditions.
- Cloud credentials + spend limits for the shared model.
- No human construction during the run; observer tooling readiness.
- Paid API and Minecraft launches require separate authorization.
