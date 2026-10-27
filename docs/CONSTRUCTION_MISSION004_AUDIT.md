# Mission 004 — Adversarial Construction Engine Audit

Date: 2026-10-26  
Branch: `integration/reliability-pr7-windows` @ `019d26d` (+ uncommitted WIP preserved)  
Mode: read-only audit first; narrowly scoped production-path fixes only.

## Verdict

**Offline ACE logic is real and tested. Live Mineflayer cabin construction remains NO-GO.**

Mission 003’s 58/58 suite is reproducible. It proves blueprint/preflight/claim/reservation/reconcile/sim-placement paths — **not** physical placement.

## Critical defects found

1. **Site selection / procurement disconnected from live executor** — `selectConstructionSite` and `planConstructionProcurement` were only used by the offline harness + unit tests; `executeBuildStructurePlan` defaulted origin to body feet.
2. **Acceptance bypasses production placer** — `runWorkshopCabinOfflineAcceptance` calls `simulatePlaceNext`, never `advanceBlueprintBuild` / `placeBlock`.
3. **`liveValidate: false` on dispatch advance** — skipped enter/door/chest live validation on the real placer path.

## Focused corrections implemented

- Wire `selectConstructionSite` into `executeBuildStructurePlan` when no `plan.target` / `project.site` (fail closed on unloaded).
- Wire `planConstructionProcurement` into PROCURING response (recipe-aware next obtain bite).
- Set `liveValidate: true` for dispatch → `advanceBlueprintBuild`.
- Add `construction-mission004-audit.test.ts` (7 adversarial regressions).

## Test results

- Baseline Mission 003 set: **58/58 PASS** (reproduced).
- With audit suite: **65/65 PASS**.

## Remaining physical risks (unverified)

- Neighbor support / reach / equip failures invisible to simulator.
- Door upper half / bed head-foot not in plan cells; soft `*_door` / `*_bed` match.
- Farm blueprint places oak_planks pad, not farmland + water.
- Warehouse declared `LIGHT_MATERIAL: 2` vs expanded torch count 1.
- No live World-Lab run authorized in this mission.
