# Cloud → Main-PC Transplant Manifest

**Branch:** `cursor/cloud-dev-skeleton-07c8`  
**Assumption:** Do **not** assume a clean cherry-pick. The main-PC tree is richer (world-lab fishing, home probes, movement-sync, etc.) and likely diverges in several of the files listed below.

Status of cloud code: **UNIT PASS** / **IMPLEMENTED / LIVE UNVERIFIED** unless noted.

---

## A. Model provider / router

| Field | Detail |
| --- | --- |
| **FEATURE** | Provider-neutral `ModelRouter` + adapters (Ollama, Gemini, NVIDIA OpenAI-compatible) |
| **FILES CHANGED** | `packages/cognition/src/*`, `packages/shared/src/config.ts`, `.env.example` |
| **NEW FILES** | `errors.ts`, `provider.ts`, `router.ts`, `openai-compatible.ts`, `gemini.ts`, `router.test.ts` |
| **EXISTING FILES MODIFIED** | `ollama.ts`, `heuristic.ts`, `index.ts` |
| **IMPORTS / DEPENDENCIES** | `@civ/shared`, native `fetch` only (no new npm deps) |
| **ENV VARS** | `LLM_PROVIDER`, `LLM_MODEL`, `LLM_FALLBACK_PROVIDER`, `LLM_FALLBACK_MODEL`, `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`, `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `NVIDIA_MODEL`, `GEMINI_*`, `OPENAI_COMPAT_*` |
| **NEW ERROR CODES** | `LLM_RATE_LIMITED`, `LLM_PROVIDER_ERROR` (+ structured `LlmProviderError` kinds incl. `config`) |
| **NEW CONFIG FIELDS** | See env vars; `SIM_ASSIGN_WORK_ROLES` also added in shared config |
| **NEW EXPORTED TYPES** | `NormalizedCognitionResult`, `ProviderAdapter`, `TokenUsage`, `ModelRouter`, `LlmProviderError` |
| **DB SCHEMA CHANGES** | None |
| **RUNTIME BEHAVIOR CHANGES** | `createCognition` returns `ModelRouter` when LLM enabled; heuristic fallback; logs provider/model attribution |
| **TEST FILES** | `packages/cognition/src/router.test.ts`, updates in `cognition.test.ts` (unchanged validation tests) |
| **EXPECTED MERGE CONFLICT AREAS** | **HIGH** if main-PC already has Gemini/NVIDIA/cognition provider code or different `createCognition` |

**Likely different on main-PC:** `packages/cognition/src/index.ts`, `ollama.ts`, any local NIM experiments.

---

## B. Property protection

| Field | Detail |
| --- | --- |
| **FEATURE** | Fail-closed property permission layer independent of planner intent |
| **FILES CHANGED** | `packages/skills/src/property.ts`, `context.ts`, `gather.ts`, `inventory.ts`, `index.ts`; `packages/minecraft-adapter/src/path-recovery.ts` (protected block names) |
| **NEW FILES** | `property.ts`, `property.test.ts` |
| **EXISTING FILES MODIFIED** | `gather.ts`, `inventory.ts`, `context.ts`, `path-recovery.ts` |
| **IMPORTS / DEPENDENCIES** | `@civ/shared` only |
| **ENV VARS** | None |
| **NEW ERROR CODES** | Uses `ACCESS_DENIED`, `PATH_BLOCKED`, `CANCELLED` |
| **NEW CONFIG FIELDS** | None |
| **NEW EXPORTED TYPES** | `PropertyRegistry`, `PermissionContext`, `PermissionDecision`, … |
| **DB SCHEMA CHANGES** | None (ownership records are in-memory registry; main-PC must wire persistence) |
| **RUNTIME BEHAVIOR CHANGES** | Optional: `mineBlock` / `depositItems` consult registry when present; incomplete metadata fails closed for protected-looking blocks |
| **TEST FILES** | `packages/skills/src/property.test.ts` |
| **EXPECTED MERGE CONFLICT AREAS** | **HIGH** — main-PC likely has home/chest ownership, fishing fixture chests, dig/path rules |

**Likely different on main-PC:** `gather.ts`, `inventory.ts`, any `home` / `storage` / `permissions` modules absent from public branch.

---

## C. Water safety

| Field | Detail |
| --- | --- |
| **FEATURE** | Pure water recovery planner + `WaterRecoverySession` state machine |
| **FILES CHANGED** | `packages/minecraft-adapter/src/water-safety.ts`, `index.ts` |
| **NEW FILES** | `water-safety.ts`, `water-safety.test.ts` |
| **EXISTING FILES MODIFIED** | `index.ts` exports only |
| **IMPORTS / DEPENDENCIES** | `@civ/shared` types |
| **ENV VARS** | None |
| **NEW ERROR CODES** | Decision codes `WATER_UNSAFE`, `NO_SHORE`, `NO_PROGRESS`, `MAX_STEPS` (ActionResult codes already in shared) |
| **NEW CONFIG FIELDS** | None |
| **NEW EXPORTED TYPES** | `WaterRecoverySession`, `WaterSafetyDecision`, … |
| **DB SCHEMA CHANGES** | None |
| **RUNTIME BEHAVIOR CHANGES** | **Not wired into live pathfinder yet** — unit-testable planner only |
| **TEST FILES** | `water-safety.test.ts` |
| **EXPECTED MERGE CONFLICT AREAS** | **MEDIUM/HIGH** if main-PC has movement-sync / swim / pathing water handling |

**Likely different on main-PC:** `pathing.ts`, movement-sync (not in public branch).

---

## D. Action tracing

| Field | Detail |
| --- | --- |
| **FEATURE** | Standardized action spans + redaction |
| **FILES CHANGED** | `packages/shared/src/action-trace.ts`, `events.ts`, `packages/agent-core/src/executor.ts` |
| **NEW FILES** | `action-trace.ts`, `action-trace.test.ts` |
| **EXISTING FILES MODIFIED** | `events.ts` (`ActionTrace` event), `executor.ts`, `index` re-exports |
| **IMPORTS / DEPENDENCIES** | none beyond shared |
| **ENV VARS** | None |
| **NEW ERROR CODES** | None |
| **NEW CONFIG FIELDS** | None |
| **NEW EXPORTED TYPES** | `ActionTrace`, `ActionTracer`, `TracePhase` |
| **DB SCHEMA CHANGES** | None (events already append-only JSON) |
| **RUNTIME BEHAVIOR CHANGES** | Executor emits `ActionTrace` events; optional `ctx.tracer` |
| **TEST FILES** | `action-trace.test.ts` |
| **EXPECTED MERGE CONFLICT AREAS** | **MEDIUM** — main-PC executor / event schema may differ |

---

## E. Housing planner

| Field | Detail |
| --- | --- |
| **FEATURE** | Pure housing claim/travel edge-case planner (no hardcoded H1) |
| **FILES CHANGED** | `packages/agent-core/src/housing.ts`, `index.ts` |
| **NEW FILES** | `housing.ts`, `housing.test.ts` |
| **EXISTING FILES MODIFIED** | `index.ts` exports |
| **IMPORTS / DEPENDENCIES** | `@civ/shared` Vec3 |
| **ENV VARS** | None |
| **NEW ERROR CODES** | Plan codes only (`NO_HOUSING`, `CLAIM_FAILED`, …) |
| **NEW CONFIG FIELDS** | None |
| **NEW EXPORTED TYPES** | `HouseRecord`, `HousingPlan`, `planHousing` |
| **DB SCHEMA CHANGES** | None — `persistClaim` injected |
| **RUNTIME BEHAVIOR CHANGES** | **Not wired into AgentManager loop on this branch** |
| **TEST FILES** | `housing.test.ts` |
| **EXPECTED MERGE CONFLICT AREAS** | **HIGH** — main-PC has live home claiming / HomeProbe |

---

## F. Fishing regression hooks

| Field | Detail |
| --- | --- |
| **FEATURE** | Owner-aware fishing concurrency unit model |
| **FILES CHANGED** | `packages/skills/src/fishing-cycle.ts` |
| **NEW FILES** | `fishing-cycle.ts`, `fishing-cycle.test.ts` |
| **EXISTING FILES MODIFIED** | `index.ts` export only |
| **IMPORTS / DEPENDENCIES** | none |
| **ENV VARS** | None |
| **NEW ERROR CODES** | None |
| **NEW CONFIG FIELDS** | None |
| **NEW EXPORTED TYPES** | `FishingCycleCoordinator` |
| **DB SCHEMA CHANGES** | None |
| **RUNTIME BEHAVIOR CHANGES** | **Not replacing live Mineflayer fishing** — regression model only |
| **TEST FILES** | `fishing-cycle.test.ts` |
| **EXPECTED MERGE CONFLICT AREAS** | **VERY HIGH** — main-PC has LIVE PASS fishing (`mineflayer-fish-cycle` etc.) |

**Evidence correction:** Kai + Atlas concurrent fishing is **LIVE PASS — EXISTING MAIN-PC BASELINE**. Cloud unit model is **not** that live proof. After transplant into the real runtime, require a **regression live check**.

---

## G. WORLD-LAB launcher guards

| Field | Detail |
| --- | --- |
| **FEATURE** | Guarded one-citizen dry-run launcher |
| **FILES CHANGED** | `apps/orchestrator/src/one-citizen.ts`, `package.json` scripts |
| **NEW FILES** | `one-citizen.ts`, `one-citizen.test.ts` |
| **EXISTING FILES MODIFIED** | root + orchestrator `package.json` |
| **IMPORTS / DEPENDENCIES** | `@civ/shared`, `node:fs`/`path`/`url` |
| **ENV VARS** | Reads standard sim/LLM env; expects world-lab DB naming |
| **NEW ERROR CODES** | Guard codes only (not ActionResult) |
| **NEW CONFIG FIELDS** | Uses `SIM_ASSIGN_WORK_ROLES` |
| **NEW EXPORTED TYPES** | `evaluateOneCitizenLaunch`, `OneCitizenPlan` |
| **DB SCHEMA CHANGES** | None |
| **RUNTIME BEHAVIOR CHANGES** | Cloud entrypoint **never** connects Mineflayer / starts Paper |
| **TEST FILES** | `one-citizen.test.ts` |
| **EXPECTED MERGE CONFLICT AREAS** | **HIGH** if main-PC already has `world-lab:*` scripts |

---

## Cherry-pick guidance

### SAFE_TO_CHERRY_PICK_DIRECTLY (genuinely low conflict risk)

- `packages/cognition/src/errors.ts` (if no local equivalent)
- `packages/cognition/src/provider.ts` (if no local equivalent)
- `packages/cognition/src/openai-compatible.ts` (if no local NIM client)
- `packages/cognition/src/gemini.ts` (if absent)
- `packages/shared/src/action-trace.ts` (+ test) if main-PC has no tracer
- `packages/minecraft-adapter/src/water-safety.ts` (+ test) if absent
- `packages/agent-core/src/housing.ts` (+ test) if absent as pure module
- `packages/skills/src/fishing-cycle.ts` (+ test) as **parallel** regression harness only (do not replace live fishing)
- `docs/CLOUD_TO_MAIN_TRANSPLANT.md`, `docs/CLOUD_PASS_REPORT.md`

### REQUIRES_MANUAL_TRANSPLANT

- `packages/cognition/src/index.ts` / `ollama.ts` / `heuristic.ts` / `router.ts`
- `packages/shared/src/config.ts` / `action-result.ts` / `events.ts`
- `packages/skills/src/gather.ts` / `inventory.ts` / `context.ts` / `property.ts`
- `packages/minecraft-adapter/src/path-recovery.ts` / `index.ts`
- `packages/agent-core/src/executor.ts`
- `apps/orchestrator/src/one-citizen.ts` + package scripts
- `.env.example`

---

## MAIN_PC_WORK_REMAINING (corrected)

Prior fishing evidence is preserved as **LIVE PASS — EXISTING MAIN-PC BASELINE**.

Outstanding after transplant:

1. **A.** Cloud-change integration/regression (esp. fishing if runtime hooks merge)
2. **B.** Property denial live
3. **C.** Water recovery live
4. **D.** Autonomous pond → housing → claim
5. **E.** Real runtime curfew → own-home sleep
6. **F.** Guarded one-citizen WORLD-LAB session
7. **G.** Optional NVIDIA endpoint smoke test
8. **H.** Wire `CitizenBrain` into main-PC manager tick (manual) — do not assume identical cognition branch

---

## H. Cloud Pass 3 — Brain / memory / decision quality

| Field | Detail |
| --- | --- |
| **FEATURE** | Cognition input contract, structured WHAT/WHY decisions, memory retrieval, learned behavior, asymmetric relationships, commitments, cooldowns, speech gating, cost routing, mood separation, cognition tracing, multi-citizen scenarios |
| **NEW FILES (SAFE_TO_CHERRY_PICK if absent)** | `packages/shared/src/brain-types.ts`; `packages/cognition/src/{input,decision-schema,commitments,cooldown,routing,psychology,cognition-trace,brain}.ts` + `brain.test.ts`; `packages/memory/src/{retrieve,learned-behavior}.ts`; `packages/society/src/relationship-belief.ts` (+ test) |
| **EXISTING FILES MODIFIED (REQUIRES_MANUAL_TRANSPLANT)** | `packages/cognition/src/index.ts`, `packages/cognition/package.json`; `packages/memory/src/index.ts`; `packages/society/src/index.ts`; `packages/shared/src/{index,events}.ts` |
| **DB SCHEMA CHANGES** | None (in-memory / injectable; main-PC must persist commitments/beliefs if desired) |
| **RUNTIME BEHAVIOR CHANGES** | **Not wired into AgentManager tick on this branch** — facade + unit scenarios only. Physical skills / planner HOW path unchanged. |
| **EXPECTED MERGE CONFLICT AREAS** | **HIGH** for cognition `index.ts`, memory `index.ts`, society speech director, any main-PC psychology/memory systems |

### Pass 3 SAFE_TO_CHERRY_PICK_DIRECTLY

- `packages/shared/src/brain-types.ts`
- `packages/cognition/src/input.ts`
- `packages/cognition/src/decision-schema.ts`
- `packages/cognition/src/commitments.ts`
- `packages/cognition/src/cooldown.ts`
- `packages/cognition/src/routing.ts`
- `packages/cognition/src/psychology.ts`
- `packages/cognition/src/cognition-trace.ts`
- `packages/cognition/src/brain.ts` (+ `brain.test.ts`)
- `packages/memory/src/retrieve.ts`
- `packages/memory/src/learned-behavior.ts`
- `packages/society/src/relationship-belief.ts` (+ test)

### Pass 3 REQUIRES_MANUAL_TRANSPLANT

- `packages/cognition/src/index.ts` / `package.json` (new deps `@civ/memory`, `@civ/society`)
- `packages/memory/src/index.ts` (export surface)
- `packages/society/src/index.ts` (requiresResponse + belief exports)
- `packages/shared/src/index.ts` / `events.ts`
- Any main-PC `manager.ts` / cognition v2 wiring

---

## I. Cloud Pass 4 — Brain persistence + thin runtime adapter

| Field | Detail |
| --- | --- |
| **FEATURE** | Versioned SQLite brain persistence (commitments, directional relationship beliefs + evidence, learned behavior evidence, cognition state, event idempotency), transactional verified-transfer apply, thin `CitizenBrainAdapter` behind `CITIZEN_BRAIN_V2_ENABLED=false`, NO_LLM gate, per-citizen model budgets |
| **NEW FILES** | `docs/BRAIN_PERSISTENCE_MAP.md`; `packages/agent-core/src/{brain-migrations,brain-persistence,citizen-brain-adapter}.ts` + tests; `packages/cognition/src/model-budget.ts` (+ test) |
| **EXISTING FILES MODIFIED** | `packages/agent-core/src/{store,index}.ts`; `packages/cognition/src/{commitments,index,cognition-trace}.ts`; `packages/shared/src/{brain-types,config}.ts`; `.env.example`; this transplant doc |
| **DB SCHEMA CHANGES** | **Yes** — migration `brain_persistence_v2` adds `commitments`, `relationship_beliefs`, `relationship_belief_evidence`, `learned_behavior_evidence`, `cognition_state`, `brain_applied_events`. Uses `schema_migrations`. Does **not** rebuild legacy `relationships` / `memories` / `events`. |
| **ENV VARS** | `CITIZEN_BRAIN_V2_ENABLED` (default **false**), `LLM_MAX_CALLS_PER_CITIZEN_PER_MC_DAY`, `LLM_MAX_ROUTINE_CALLS_PER_WINDOW`, `LLM_ROUTINE_WINDOW_MS`, `LLM_MAX_DEEP_REFLECTION_CALLS_PER_MC_DAY`, optional `LLM_GLOBAL_MAX_CALLS_PER_MC_DAY` |
| **RUNTIME BEHAVIOR CHANGES** | Adapter **not** wired into `AgentManager` tick. Flag default false. Physical skills / planner unchanged. |
| **EXPECTED MERGE CONFLICT AREAS** | **HIGH** for `store.ts` / any main-PC DB layer; **MEDIUM** for `config.ts` / `.env.example`; adapter is additive |

### BRAIN DATABASE CHANGES

See `docs/BRAIN_PERSISTENCE_MAP.md`. New tables only; legacy `relationships` kept for planner scores. Authoritative Pass-3 beliefs live in `relationship_beliefs` (+ evidence).

### REQUIRED MIGRATION ORDER

1. Ensure baseline `CivilizationStore` schema (citizens/events/memories/relationships/…) exists.
2. Apply death-column ad-hoc alters (existing cloud migrate).
3. Apply `brain_persistence_v2` via `schema_migrations` (idempotent).
4. Do **not** run against production `data/civilization.sqlite` from cloud tests.
5. If main-PC schema differs: **stop and reconcile** — do not guess column renames.

### FILES SAFE TO CHERRY PICK (Pass 4)

- `docs/BRAIN_PERSISTENCE_MAP.md`
- `packages/agent-core/src/brain-migrations.ts`
- `packages/agent-core/src/brain-persistence.ts` (+ test) — if store API compatible
- `packages/agent-core/src/citizen-brain-adapter.ts` (+ test)
- `packages/cognition/src/model-budget.ts` (+ test)
- `packages/shared/src/brain-types.ts` (additive fields)

### FILES REQUIRING MANUAL MERGE

- `packages/agent-core/src/store.ts` (migrate hook + `appendEventIdempotent` / `countLlmCallsForCitizen`)
- `packages/agent-core/src/index.ts`
- `packages/agent-core/src/manager.ts` — **integration point only; not auto-wired**
- `packages/shared/src/config.ts`
- `packages/cognition/src/index.ts` / `commitments.ts`
- `.env.example`

### MAIN-PC SCHEMA QUESTIONS

1. Does main-PC already have `commitments` / belief / cognition tables under different names?
2. Is `schema_migrations` already used with incompatible version numbering?
3. Are `events.id` UUIDs shared across processes (idempotency key assumption)?
4. Does main-PC `relationships` already encode asymmetric beliefs (avoid dual-write confusion)?
5. Where should `CITIZEN_BRAIN_V2_ENABLED` be toggled for WORLD-LAB vs production?

### RUNTIME FEATURE-FLAG INTEGRATION POINT

```
AgentManager / future runtime tick
        ↓  if (config.CITIZEN_BRAIN_V2_ENABLED)
CitizenBrainAdapter.deliberate(...)
        ↓
CitizenBrain.prepare / finalize
        ↓
ModelRouter (existing)
```

Adapter must **not** execute Minecraft skills, bypass planner, or mark world actions successful. Minecraft physical verification → then `BrainPersistence.applyVerifiedTransfer` (SQLite txn).

### Anything touching existing main-PC database code

- `CivilizationStore` constructor migrate path
- New tables beside existing ones
- `appendEventIdempotent` additive method
- No destructive DROP/rebuild of legacy tables in this pass

---

## J. Cloud Pass 5 — Reconciliation + brain integrity + replay

| Field | Detail |
| --- | --- |
| **FEATURE** | Durable model budgets via `llm_calls`, commitment completion predicates + quantity progress ledger, verified-transfer quantity, brain reconciler, deterministic replay harness, belief provenance (`source_event_id`/`effect_role`), adapter reconsideration precedence + pending reconsideration, read-only schema preflight |
| **NEW FILES** | `packages/shared/src/commitment-target.ts`; `packages/agent-core/src/{commitment-predicate,durable-budget,event-provenance,brain-reconciler,brain-replay,schema-preflight,pass5-integrity.test}.ts` |
| **EXISTING FILES MODIFIED** | `brain-migrations.ts` (v3), `brain-persistence.ts`, `citizen-brain-adapter.ts`, `store.ts`, `index.ts`, docs, tests |
| **DB SCHEMA CHANGES** | Migration `brain_integrity_v3`: additive `llm_calls` budget columns; `commitment_progress_events`; `pending_reconsideration`; belief evidence `source_event_id`/`effect_role` |
| **RUNTIME BEHAVIOR CHANGES** | Still **not** wired into AgentManager. Flag default false. |
| **PR BASE WARNING** | **PR #3 is based on `cursor/cloud-dev-skeleton-07c8`, NOT main-PC runtime/main.** Do **not** recommend blindly merging the entire PR into main-PC. |

### Pass 5 semantics (see also `docs/BRAIN_PERSISTENCE_MAP.md`)

- **Durable budgets:** derive from `llm_calls.counts_toward_budget`; failed calls don't count; retries share `decision_id`.
- **Commitment predicates:** structured `item_transfer` payload; quantity progress ledger; no force-complete by id.
- **Verified quantity:** required positive integer on transfer events/payload.
- **Reconciler:** verified events → missing brain effects once; malformed/unsupported explicit.
- **Replay:** TEMP DB harness; double replay → equal snapshots.
- **Reconsideration precedence:** lethal → task break → queue important social mid-skill → else continue skill.
- **Schema preflight:** `inspectSchemaCompatibility` on a DB **copy** before transplant.

### Pass 5 SAFE_TO_CHERRY_PICK_DIRECTLY

- `packages/shared/src/commitment-target.ts`
- `packages/agent-core/src/commitment-predicate.ts`
- `packages/agent-core/src/event-provenance.ts`
- `packages/agent-core/src/durable-budget.ts`
- `packages/agent-core/src/brain-reconciler.ts`
- `packages/agent-core/src/brain-replay.ts`
- `packages/agent-core/src/schema-preflight.ts`
- `docs/BRAIN_PERSISTENCE_MAP.md` updates

### Pass 5 REQUIRES_MANUAL_TRANSPLANT

- `packages/agent-core/src/brain-migrations.ts` / `store.ts` / `brain-persistence.ts` / `citizen-brain-adapter.ts`
- Any main-PC `llm_calls` / commitment tables that already exist under different shapes
- AgentManager wiring (still out of scope)

### Schema preflight instructions (main-PC)

1. Copy main-PC sqlite to a scratch file.  
2. Open read-only / via test helper.  
3. `snapshotSqliteSchema(db)` → `inspectSchemaCompatibility(snap)`.  
4. If `INCOMPATIBLE`: stop and reconcile PKs/columns manually.  
5. If `MANUAL_RECONCILE_REQUIRED`: review warnings (missing migrations/tables/budget cols).  
6. Only then apply cloud migrations on another copy — never on production.
