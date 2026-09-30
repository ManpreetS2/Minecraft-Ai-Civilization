# Cloud Pass Report

**Date:** 2026-09-30  
**Branch:** `cursor/cloud-dev-skeleton-07c8`  
**Environment:** Cloud-only (no Minecraft / Paper / RCON / Mineflayer live connect)

Status labels used below: **LIVE PASS** · **UNIT PASS** · **IMPLEMENTED / LIVE UNVERIFIED** · **BLOCKED** · **NOT TESTED**

---

## CLOUD_PASS_STATUS

`PARTIAL`

Reason: static health is clean, provider/property/water/launcher/tracing/home/fishing unit layers landed, but this public branch did not previously contain the local world-lab fishing/home LIVE-proven stack. No live Minecraft verification was (or could be) performed here.

`LIVE_TESTS_RUN=NONE`

---

## Baseline audit

| Area | Finding |
| --- | --- |
| TypeScript (`pnpm typecheck`) | **UNIT PASS** — clean before and after this pass on current public tree |
| Reported local hotspots (`movement-sync`, `navigation`, `combat`, `mineflayer-fish-cycle`) | **NOT TESTED** / absent from this public branch — no pre-existing TS failures to triage here |
| `packages/skills/src/world.ts` | Present; typechecks clean. No behavior rewrite |

---

## What changed

### 1. Model provider abstraction — **UNIT PASS** / **IMPLEMENTED / LIVE UNVERIFIED**

Architecture:

```text
Citizen cognition
      ↓
ModelRouter
      ↓
ProviderAdapter
 ├─ Ollama
 ├─ Gemini
 ├─ NVIDIA NIM (OpenAI-compatible)
 └─ openai_compatible / heuristic
```

- Config: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_FALLBACK_*`, `NVIDIA_*`, `GEMINI_*`, timeouts/retries
- Features: timeout, abort, rate-limit handling, bounded retry, fallback, structured `LlmProviderError`, provider/model log attribution, token/latency metadata when APIs return it
- API keys never committed (`.env.example` placeholders only)
- Model names remain configurable; no assumption that NVIDIA models are free

### 2. Citizen property safety — **UNIT PASS** / **IMPLEMENTED / LIVE UNVERIFIED**

- `PropertyRegistry` + `checkPropertyPermission` independent of planner intent
- Protects personal chests, claimed beds, home structure, fixture chests, communal vs unclaimed, doors without destroy auth
- Mining/path dig refuses protected obstruction (`PATH_BLOCKED` / `ACCESS_DENIED`)
- Wired optionally into `mineBlock` / `depositItems` when registry is present on `SkillContext`

### 3. Water / swimming safety — **UNIT PASS** / **IMPLEMENTED / LIVE UNVERIFIED**

- Pure decision module: enter water, submerged, air, shore search, abort honesty, lava ≠ water
- No teleport, no fabricated arrival, no block placement in this module

**Still requires main-PC Minecraft verification:**

- Real Mineflayer pathfinder liquid navigation
- Actual `bot.oxygen` / air semantics on 1.21.11
- Current vs flow water push
- Swim control authority vs pathfinder goals
- Accidental fall recovery under lag

### 4. One-citizen launcher guards — **UNIT PASS**

- `pnpm world-lab:one-citizen -- --dry-run`
- Guards: ports 25565/25566, `civilization.sqlite`, citizen count ≠ 1, `AUTO_START_PAPER`, `SIM_ASSIGN_WORK_ROLES`, probe identities
- Dry-run prints citizen, host/port, DB, model provider/model, Paper start, world mutation, live/dry-run state
- Live connect disabled in this cloud entrypoint even if guards pass

### 5. Observability — **UNIT PASS** / **IMPLEMENTED / LIVE UNVERIFIED**

- `ActionTracer` + phases: DECISION → PLAN → SKILL_START → SKILL_RESULT → WORLD_VERIFICATION → MEMORY_EVENT_UPDATE
- Executor emits `ActionTrace` events (not per-tick)

### 6. Fishing concurrency regression — **UNIT PASS** / **IMPLEMENTED / LIVE UNVERIFIED**

- Owner-aware `FishingCycleCoordinator` unit model (not stock `bot.fish()`)
- Covers dual cast, bobber ownership, foreign particle/bite ignore, staggered bites, duplicate cast, timeout/cancel isolation, chest delta accounting
- **Cloud implementation is not live-tested**
- **Evidence preservation:** Kai + Atlas concurrent fishing has an earlier witnessed **LIVE PASS — EXISTING MAIN-PC BASELINE** on the main-PC codebase. That evidence must not be treated as validation of this cloud unit model. If cloud fishing hooks are transplanted into the real runtime, require a **regression live check**.

### 7. Home / planner edge cases — **UNIT PASS** / **IMPLEMENTED / LIVE UNVERIFIED**

- `planHousing` covers similar-distance homes, mid-travel claim races, blocked nearest route, unreachable/empty catalog, mid-plan housed, disconnect, night+blocked, claim persistence failure, destroyed/invalid home
- No hardcoded H1 assignment

---

## Files changed (high level)

- `packages/shared` — config, error codes, action-trace
- `packages/cognition` — ModelRouter, NVIDIA/Gemini/OpenAI-compatible adapters, errors
- `packages/skills` — property safety, fishing-cycle, skill context hooks, gather/inventory permission checks
- `packages/minecraft-adapter` — water-safety, expanded protected block names
- `packages/agent-core` — housing planner, executor action traces
- `apps/orchestrator` — one-citizen launcher + tests
- `docs/CLOUD_PASS_REPORT.md`, `docs/ARCHITECTURE.md`, `.env.example`, root scripts

---

## Tests run

```bash
pnpm typecheck
pnpm test
pnpm world-lab:one-citizen -- --dry-run
```

| Command | Result |
| --- | --- |
| `pnpm typecheck` | PASS (0 errors) |
| `pnpm test` | PASS — 81/81 |
| `pnpm world-lab:one-citizen -- --dry-run` | PASS (prints guard report; no world mutation) |

---

## Architectural decisions

1. Provider-specific HTTP stays behind `ProviderAdapter`; planner/memory/social do not import NVIDIA/Gemini clients.
2. Property permissions are a separate layer from planner intent; seeing ≠ access.
3. Water safety is a pure planner over injected world samples so cloud unit tests do not need a server.
4. One-citizen live connect is intentionally disabled in cloud builds.
5. Fishing concurrency is modeled owner-aware; stock `bot.fish()` is not adopted.

## Risks

- Public branch still lacks the full local world-lab runtime wiring for LIVE-proven fishing/home probes.
- Property registry must be populated by settlement/home code on the main PC or permissions stay opt-in.
- Water module does not yet drive Mineflayer controls — integration pending live work.
- NVIDIA/Gemini paths are unit-tested via router mocks; real HTTP **NOT TESTED** here.

## MAIN_PC_WORK_REMAINING (corrected)

| ID | Work | Notes |
| --- | --- | --- |
| A | Cloud-change integration/regression | Especially if fishing/runtime hooks merge |
| B | Property denial live | Dig behind Atlas chest → replan, no break |
| C | Water recovery live | Fall / shore / low-air with real oxygen |
| D | Autonomous pond → housing → claim | No hardcoded H1 |
| E | Real runtime curfew → own-home sleep | LIVE UNVERIFIED on public branch |
| F | Guarded one-citizen WORLD-LAB session | 25567 + world-lab DB, not cloud |
| G | Optional NVIDIA endpoint smoke | Cost-aware; real key on main-PC only |

**Preserved baseline (do not re-litigate as missing):** Kai + Atlas concurrent fishing = **LIVE PASS — EXISTING MAIN-PC BASELINE**.

See also `docs/CLOUD_TO_MAIN_TRANSPLANT.md`.

---

## Cloud Pass 2 additions

- Transplant manifest
- Model router failure matrix + normalized cognition contract
- Property fail-closed matrix
- Water state machine session tests
- Action-trace invariants (redaction, correlation, no tick spam)
- Launcher guard matrix (world-lab DB / localhost / count 0)
