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
