# Minecraft AI Civilization — Development Journal

Portfolio-oriented engineering log. Claims distinguish **offline verification** from **live Minecraft evidence**. Do not publish externally without the project owner’s approval.

---

## 2026-10-26 — Stage 1 auth boundary (Mission 006B)

**Objective:** First physical one-block placement — **blocked pending exact operator auth phrase**.  
Readiness: ports idle, isolation hashes match, Stage 1 gate + hard-stop for stages 2–4.  
**No Paper / Atlas / placement.** See [CONSTRUCTION_MISSION006B_AUTH_BOUNDARY.md](./CONSTRUCTION_MISSION006B_AUTH_BOUNDARY.md).

---

## 2026-10-26 — Physical construction readiness (Mission 006A)

**Branch:** `integration/reliability-pr7-windows` @ `019d26d` (uncommitted)  
**Objective:** Isolated World-Lab prep, evidence logging, staged abort design — **no Paper/Atlas/Mineflayer**.

### Delivered

- Disposable copy under `experiments/construction-006a/` (ports **25568/25578**); original **25567/25577** fingerprints unchanged.
- `clearSite` refuses protected furniture digs.
- Construction evidence JSONL + experiment guards (default deny live).
- Staged plan + operator commands documented; `--live` hard-stops in 006A runner.

### Tests

Mission 006A-focused + prior construction suite green (see readiness doc for counts).

### Verdict

**NO-GO** for all physical stages until explicit operator authorization on the isolated copy only.

See [CONSTRUCTION_MISSION006A_READINESS.md](./CONSTRUCTION_MISSION006A_READINESS.md).

---

## 2026-10-26 — Production construction reliability (Mission 005)

**Branch:** `integration/reliability-pr7-windows` @ `019d26d` (uncommitted; WIP preserved)  
**Objective:** Close Mission 004 gaps; exercise real `advanceBlueprintBuild`/`placeBlock` under fake Mineflayer; prepare isolated live plan without launching.

### Delivered

- Exact door/bed identity + multiblock plan cells; property match gates COMPLETED.
- Authoritative BOM sync; farm marked unsupported; extras sanitized to `optionalFeatures`.
- `placeBlock` post-place VERIFY for identity, door upper, bed twin.
- Production-path suite (`construction-production-path.test.ts`) + harness.
- Live prep doc only — **no Paper/Atlas**.

### Tests

**82/82 PASS** on construction-focused suite. Knowledge typecheck PASS.

### Recommendation

**NO-GO** for live cabin until operator authorizes isolated World-Lab copy per `CONSTRUCTION_LIVE_TEST_PREP.md`.

See [CONSTRUCTION_MISSION005_LEDGER.md](./CONSTRUCTION_MISSION005_LEDGER.md).

---

## 2026-10-26 — Adversarial construction audit (Mission 004)

**Branch:** `integration/reliability-pr7-windows` @ `019d26d` (uncommitted; WIP preserved)  
**Objective:** Independently verify Missions 001–003; distinguish proven offline logic from unverified Mineflayer assumptions.

### Findings

- Reproduced **58/58** construction tests; they do **not** prove live placement.
- Critical: site selection + procurement were offline-complete but **not** on the live `executeBuildStructurePlan` path; acceptance used `simulatePlaceNext` only; dispatch advanced with `liveValidate: false`.

### Fixes (narrow)

- Wire Phase-C site select + Phase-D procurement into executor; enable live validation on advance.
- Adversarial suite: **+7** → **65/65 PASS**.

### Recommendation

**NO-GO** for an isolated live cabin test until authorized World-Lab evidence exists for neighbor-supported `placeBlock`, door/bed multiblock, and enter/exit validation.

See [CONSTRUCTION_MISSION004_AUDIT.md](./CONSTRUCTION_MISSION004_AUDIT.md).

---

## 2026-10-26 — Full construction roadmap offline (Mission 003)

**Branch:** `integration/reliability-pr7-windows` @ `019d26d` (uncommitted)  
**Objective:** Complete as much of the Autonomous Construction Engine as possible offline.

### Delivered

- Phase A–I offline: blueprint rules, 6-structure catalog, site selection, procurement, simulated execution, recovery e2e, multi-citizen isolation, docs.
- Acceptance: `runWorkshopCabinOfflineAcceptance` (simulated placements only).
- Tests: **58/58 PASS** on construction-focused suite. Knowledge typecheck PASS.

### Not delivered (authorization boundary)

- Live Mineflayer / World-Lab cabin build.
- `.schem` import; scaffolding; assumed chest contents.

See [AUTONOMOUS_CONSTRUCTION_ENGINE.md](./AUTONOMOUS_CONSTRUCTION_ENGINE.md), [CONSTRUCTION_MISSION003_LEDGER.md](./CONSTRUCTION_MISSION003_LEDGER.md).

---

## 2026-10-26 — Construction intention integration (Mission 002, offline)

**Branch:** `integration/reliability-pr7-windows` @ `019d26d` (still uncommitted)  
**Objective:** Connect planner/executor intentions to `planBuildStructure` without live Minecraft.

### Progress

- `dispatchCitizenBuildIntention` + executor `buildStructure` + planner resume via `constructionProject`.
- `contribute_to_project` → `buildStructure` (starter hut path unchanged).
- Reliability suite: duplicate session reuse, site claim deny, foreign reservation subtract, PROCURING shortfall, unknown≠verified, cancel, failed placement, persist≠complete.
- Tests: **33/33 PASS** on focused set. Physical workshop: **NO-GO**.

### Intention path

`buildStructure` → `executeBuildStructurePlan` → `dispatchCitizenBuildIntention` → reuse/`planBuildStructure` → optional `advanceBlueprintBuild`.

See [AUTONOMOUS_CONSTRUCTION_ENGINE.md](./AUTONOMOUS_CONSTRUCTION_ENGINE.md).

---

## 2026-10-26 — Autonomous Construction Engine (Slice A–D offline)

**Branch:** `integration/reliability-pr7-windows` @ `019d26d` (uncommitted construction slice)  
**Objective:** Extend existing construction sessions so citizens can request verified structures without a parallel engine.

### Progress

- Audited Windows construction stack: `structures.ts`, `blueprint-build.ts`, `construction.ts`, `projects.ts`, reservations, placement.
- Rejected new schematic dependencies for this slice (local catalog sufficient; prismarine-schematic 1.21 palette risk).
- Implemented workshop cabin catalog + offline preflight + project bridge + world-reconcile recovery helpers.
- Tests: **23/23 PASS** on construction-focused vitest set.
- Physical cabin in Minecraft: **NO-GO** (not authorized / not run).

### Problems → solutions

| Problem | Fix |
| --- | --- |
| Risk of parallel “new engine” | Extended catalog + `BuildSession` / `SettlementProject` |
| Fake completion from checkpoints | `applyWorldReconcileToSession` requires world match |
| Protected village furniture | Preflight refuses protected names in build volume |

See [AUTONOMOUS_CONSTRUCTION_ENGINE.md](./AUTONOMOUS_CONSTRUCTION_ENGINE.md).

---

## 2026-10-26 — Atlas Day 3 readiness (offline)

**Branch:** `integration/reliability-pr7-windows` @ `019d26d`  
**Objective:** Finish Atlas’s autonomous survival milestone (one citizen, World-Lab only).

### Progress

- Day 1 live: drown + unhandled ECONNRESET → recovery commit `3bb1a3b`.
- Day 2 live: PARTIAL — gather/craft PASS; food spin, sleep STUCK on crafting_table, one drown; clean Node stop.
- Behavioral fixes (committed + frozen WIP): food backoff, fishing-before-give-up, sleep-route backoff, H9 lateral bypass (no furniture dig), water dig refuse, curfew sequence seed from existing `home_h9`.
- Day 3 offline gate: **86/86** targeted tests; WIP SHA256 matches freeze; dry-run pins World-Lab isolation.

### Architecture decisions

- AI chooses goals; deterministic skills execute body actions; world/inventory verify outcomes.
- Harness pins `25567` / `world-lab-civilization.sqlite` / `AUTO_START_PAPER=false` so root `.env` live-civ settings cannot retarget the body.
- Food success requires inventory delta (`finalizeFoodGather`), not task-completion theater.
- Alternate home routing steps laterally around protected furniture; never digs crafting tables/chests/beds/doors; never reports teleport.

### Problems → solutions

| Problem | Fix |
| --- | --- |
| Unbounded `FOOD_NOT_FOUND` reflex | `shouldBackoffFoodSearch` + non-retryable exhausted search |
| Sleep spam into crafting_table | Lateral bypass + `shouldBackoffHomeSleepRoute` |
| Drown while digging from water | Refuse dig when standing in liquid |
| Curfew “not tested” with existing claim | `seedDaySequenceFromExistingHome` |
| Dry-run exit 1 after Day2 claim | Continuation state is informational; guard success ⇒ exit 0 |

### Verified offline vs live

| | Offline | Live |
| --- | --- | --- |
| Day 3 gate | PASS (tests + dry-run isolation) | **Not run** — awaiting authorization |
| Independent citizen-day | Not claimed | Not claimed |

### Remaining limitations

- No fishing_rod / unset communal storage may block fishing fallback live.
- Full society, paid recruitment, permanent-death economy are final-product requirements — **not** this milestone.

### Next milestone

Authorized Atlas Day 3 live on World-Lab; score evidence; smallest fixes only.

See also: [ATLAS_DAY3_LIVE_READINESS.md](./ATLAS_DAY3_LIVE_READINESS.md), [RED_FIRST_CITIZEN_DAY_CHECKLIST.md](./RED_FIRST_CITIZEN_DAY_CHECKLIST.md).
