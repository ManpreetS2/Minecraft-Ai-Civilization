# Main-PC Integration Runbook

**Audience:** Operator with access to the real main-PC repo (may contain unpushed LIVE work).  
**Cloud PR:** [#3](https://github.com/ManpreetS2/Minecraft-Ai-Civilization/pull/3) — **TRANSPLANT SOURCE, NOT A DIRECT MAIN MERGE**.  
**Do not:** retarget PR #3 to `main`, merge PR #3 blindly, migrate the only DB copy, or enable `CITIZEN_BRAIN_V2_ENABLED` until Phase F–G pass.

---

## PHASE A — Snapshot

1. On main-PC machine, open the real repo.
2. `git fetch --all --prune`
3. Commit or stash **all** local work (`git status` clean or stash listed).
4. Record:
   - `git rev-parse HEAD` → `MAIN_PC_SHA=`
   - `git branch --show-current` → `MAIN_PC_BRANCH=`
5. Back up SQLite:
   - Copy `data/civilization.sqlite` (and any WORLD-LAB DBs) to dated paths, e.g.  
     `backups/civilization.YYYYMMDD-HHMM.copy.sqlite`
6. **Never** operate migrations on the only remaining DB file.

---

## PHASE B — Compare

1. Add cloud remote / fetch PR branch `cursor/brain-persistence-07c8` (or cherry-pick from documented SHAs in `docs/TRANSPLANT_ORDER.md`).
2. Diff against `MAIN_PC_SHA`:
   - Identify duplicate functionality (esp. fishing, home, movement-sync, cognition).
   - List conflicting files (see transplant order “EXPECTED CONFLICT FILES”).
3. **Preserve richer LIVE-proven implementations** on main-PC (fishing cycle, home probes, etc.). Cloud fishing/water modules are unit/regression aids, not replacements for LIVE PASS code.

---

## PHASE C — Safe additive imports (first)

Introduce in order (see `docs/TRANSPLANT_ORDER.md` for SHAs):

1. Shared types / config knobs / action-trace / errors (additive).
2. Cognition provider interfaces + ModelRouter + NVIDIA/Gemini adapters (if absent).
3. Pure modules: water-safety, property (if absent), housing planner, fishing-cycle **harness**, brain-types, commitment-target.
4. Docs: `BRAIN_PERSISTENCE_MAP`, transplant manifest, this runbook.

Do **not** yet replace `manager.ts` skill paths or live fishing.

---

## PHASE D — Schema preflight

1. Take a **COPY** of main-PC DB: `*.copy.sqlite`.
2. Read-only:

```bash
pnpm cloud:db-copy-check -- ./backups/civilization.YYYYMMDD.copy.sqlite
```

3. Classify:
   - `COMPATIBLE` → proceed carefully
   - `MANUAL_RECONCILE_REQUIRED` → resolve warnings (missing tables/cols/migrations)
   - `INCOMPATIBLE` → **STOP** (PK / column conflicts)

Public GitHub `main` comparison is **not** proof of main-PC compatibility.

---

## PHASE E — Migrations (copy first)

1. Only after Phase D ≠ `INCOMPATIBLE`:

```bash
pnpm cloud:db-copy-check -- ./backups/civilization.YYYYMMDD.copy.sqlite \
  --apply-migrations --work-copy ./backups/civilization.YYYYMMDD.migrated.copy.sqlite
```

2. Verify:
   - Row counts for `citizens`, `events`, `memories`, `relationships` unchanged or only additive growth
   - `schema_migrations` contains `brain_persistence_v2`, `brain_integrity_v3`
   - Legacy `relationships` still present; Pass-3 beliefs live in `relationship_beliefs`
3. Optional: reconciler **dry report** on the migrated copy (no writes): use `BrainReconciler.report()` in a scratch script / unit harness.
4. Do **not** point production `DATABASE_PATH` at the migrated file until G passes.

---

## PHASE F — Manual wiring

Wire carefully, feature-flagged:

| Piece | Flag / note |
| --- | --- |
| ModelRouter | existing `LLM_*` |
| Property safety | registry injection; fail-closed |
| Water safety | planner only until live pathing reviewed |
| Brain persistence | store migrations via `CivilizationStore` |
| `CitizenBrainAdapter` | **`CITIZEN_BRAIN_V2_ENABLED=false` default** |
| AgentManager | call adapter only when flag true; never bypass planner/reflexes |

Minecraft physical verification **before** SQLite brain txn.

---

## PHASE G — Tests before Minecraft

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm cloud:integration-check`
4. Dry-run launcher guards only (`world-lab:one-citizen` evaluation / unit tests) — **no Paper**
5. DB replay / reconciler unit tests (temp DBs)

---

## PHASE H — Later live verification (manual, not automatic)

Only after G is green on main-PC:

- Guarded WORLD-LAB one-citizen session
- Fishing / home / water regression as applicable
- Optional provider smoke with real keys (never in CI)

**Do not claim LIVE PASS from cloud work.**
