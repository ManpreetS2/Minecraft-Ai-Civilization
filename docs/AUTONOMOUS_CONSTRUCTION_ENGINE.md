# Autonomous Construction Engine

Date: 2026-10-26  
Branch: `integration/reliability-pr7-windows` @ `019d26d` (uncommitted Missions 001–005 WIP)  
Constraint: **No live Paper/Atlas** unless operator authorizes — see `CONSTRUCTION_LIVE_TEST_PREP.md`.

## Status

| Area | Status |
| --- | --- |
| Offline blueprint / preflight / reconcile | **Proven in tests** |
| Production path wiring (site select + procure + advance) | **Wired** (Mission 004–005) |
| Fake-Mineflayer production harness | **Proven offline** (Mission 005) — not physical proof |
| Door/bed exact identity + multiblock plan | **Offline proven**; live still unverified |
| BOM authoritative sync | **Proven** (`authoritativeBomFromExpanded` + pipeline BOM_DRIFT) |
| `simple_farm_v1` | **Unsupported** (not a plank pad) |
| World-Lab physical cabin | **NO-GO** (prepared only) |

## Architecture (production)

```
Citizen intention (WHAT/WHY/WHERE)
  → executeBuildStructurePlan
      → selectConstructionSite when no plan.target / project.site (fail closed on unloaded)
      → dispatchCitizenBuildIntention
          → planBuildStructure / site claim / shortfall
          → planConstructionProcurement on PROCURING
          → advanceBlueprintBuild (liveValidate=true) → placeBlock
              → nav + equip + neighbor support + post-place identity (+ door upper / bed twin)
          → world reconcile (name + door/bed properties) → COMPLETED only if verified
          → persist (failure ≠ physical success)
  → Offline map harness: simulatePlaceNext (explicitly simulatedOnly)
```

## Catalog

| ID | Type | Notes |
| --- | --- | --- |
| `workshop_cabin_v1` | WORKSHOP | Primary target; door lower+upper; optional bed head/foot |
| `starter_house_v1` / `small_house_v1` | SMALL_HOUSE | Implemented |
| `storage_shed_v1` / `small_warehouse_v1` | STORAGE_SHED | Extras sanitized to `optionalFeatures` |
| `path_segment_v1` | ROAD_SEGMENT | Implemented |
| `simple_farm_v1` | FARM | **implemented: false** — unsupported until hoe/water skill path |

## Tests

```
pnpm exec vitest run `
  packages/minecraft-knowledge/src/construction-blueprint-rules.test.ts `
  packages/minecraft-knowledge/src/structures.test.ts `
  packages/minecraft-knowledge/src/build-preflight.test.ts `
  packages/agent-core/src/build-structure.test.ts `
  packages/agent-core/src/build-structure-intention.test.ts `
  packages/agent-core/src/construction-mission003.test.ts `
  packages/agent-core/src/construction-mission004-audit.test.ts `
  packages/agent-core/src/construction-production-path.test.ts `
  packages/agent-core/src/goal-dispatch.test.ts `
  packages/agent-core/src/projects.test.ts `
  packages/agent-core/src/construction-water.test.ts `
  packages/agent-core/src/execution-engine.test.ts
```

**82/82 PASS** (Mission 005).  
`@civ/minecraft-knowledge` typecheck **PASS**.  
Agent-core: Mission 005 construction files clean; pre-existing unrelated WIP `tsc` noise elsewhere.

## Live readiness

See [CONSTRUCTION_LIVE_TEST_PREP.md](./CONSTRUCTION_LIVE_TEST_PREP.md).  
**Physical test: NO-GO** until operator authorizes an isolated World-Lab copy.
