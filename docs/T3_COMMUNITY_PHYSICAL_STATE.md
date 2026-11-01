# Per-community physical state ? supporting implementation

Base: reconciliation candidate `7c039eca53acd56566717522abceed255c29c735` (draft PR #7).
Branch: `agents/t3-community-physical-state`.

## Dependency map and current runtime boundary

| Path | Identity arrives | Current boundary / remaining loss |
|---|---|---|
| manager.tickCitizen -> scopeSettlementForCitizen | runtime citizen ID | Now reads its own community snapshot; unaffiliated callers remain neutral |
| store.getSettlement/saveSettlement | no caller | Legacy settlement_first retained; explicitly not relabeled |
| manager.runTick / refreshSnapshot | global population | Legacy project/work assignments and observer aggregate; SEC filters citizen input, but execution is still global |
| executor.executePlan | ctx.citizenId | Protected implementation still calls unscoped store/helpers in food, materials, storage, construction |
| settlement-runtime / claims / reservation book | owner ID, no community | Legacy global in-memory project/reservations; new persistent API has separate authorization but is not substituted automatically |
| workstations -> getSettlement | no authenticated caller at remember | Global metadata; future adapter must use verified observation plus bound facade |
| homes / property-safety / storage | citizen in some calls | Legacy communal storage still references global row; new assets require owner grant even for teammates |
| available-homes | catalog, no reader | World-Lab prepared house catalog; must be disabled for wilderness experiment and replaced by observed candidates |
| build-structure / procurement / construction | project owner/ctx citizen | Protected executor path still passes global store/runtime; scoped supporting API not complete construction wiring |
| planner / cognition | runtime citizen, scoped settlement | Uses new per-community snapshot; no rival plans or inventory from legacy row |
| restart | SQLite | New state, grants, holds, world claims persist; every use rechecks current membership |

## Implemented and tested

Additive, transactional, idempotent schema; no copying ambiguous legacy ownership. Dry-run report returns legacy IDs/counts/disposition without content mutation. Disposable backup verified via VACUUM and quick_check; rollback on incompatible preexisting schema tested. This is not a production migration runner or authorization to run one.

Trusted-runtime facades bind citizen and community at creation and recheck membership inside each SQLite immediate transaction. No caller-chosen destination community. State is a last-observed cache, not omniscient stock. Compare-and-swap revisions prevent stale planner observations overwriting newer physical observations. A newly bound community starts with zero supplies, no home, workstation, shelter or project. Existing settlement_first and home rows stay unchanged/unassigned.

Separate communal reservations, owner-only release and expiry. Shared-world block keys include dimension and floored position; claims arbitrate contention across communities without publishing owner metadata. Claims are scheduling/social rules, never physical walls. Expired or unaffiliated work is pruned before new admissions. Quantities must be positive finite integers; inherited JavaScript properties never count as inventory.

Personal assets (home/bed/chest/table/furnace) require explicit owner grants, including for teammates. Grants may intentionally cross communities. Rival observation remains possible through the Minecraft adapter; observation alone grants no chest access. Owner-only abandonment/revocation is audited. Affiliation changes invalidate queued old-community work without changing citizen identity or provider. Provider binding remains Claude's responsibility.

Tests drive real store and planner with 1v1/2v2 simulated observations, but do not execute the real manager/provider or Minecraft bodies. No inventory or blocks are created by planning. Additional tests cover SQLite contention, private assets, migrations/rollback/backup, death/cancellation cleanup API, missing/unknown identity, ownership transition and grants across restart.

## Protected executor patch and conflict analysis

`docs/patches/executor-community-boundary.patch` is a review-only safety gate, generated against the current protected executor. It has NOT been applied. It refuses non-observation community work until scoped physical execution has acceptance coverage. This small entry-point patch preserves all Mission 013 action bodies; it does not solve the eventual store/runtime migration. Check with `git apply --check docs/patches/executor-community-boundary.patch`.

Do not merely replace getSettlement calls: downstream helpers, home authorization, runtime project/holds, live inventory deltas and durable writes must all agree on community. Do not wrap the store with an unsafe prototype/proxy to bypass its private state. Review the unpublished Windows executor delta before applying any patch. Full community execution remains a release blocker, even though planner reads are now scoped.

## Required next verification

Owner-reviewed executor integration; scoped helpers and runtime lifecycles; world-verified gathering/crafting/build outcomes; observed homes instead of catalog; membership-change cancellation; independent provider sessions from Claude; real manager 1v1/2v2 harness. No paid calls/live server/production paths used. NOT READY for live experiment.

## Verified checkpoint evidence

Full suite: **1513 passed, 1 pre-existing blueprint failure, 2 skipped / 1516**. New physical-state suite: **22/22 passed**. Original 220-case security replay still passes in full run. Recursive compiler retains exactly ten pre-existing errors; focused changed-file lint and whitespace checks pass. Protected executor diff is empty; review-only patch applies cleanly with --check. No full physical executor, independent provider, or live acceptance claim.
