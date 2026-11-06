# Construction persistence verification

OFF-05 assessment: **Changes required** on `875ebf707b93a082a6423c9a3aecc7d00ae02e48`.

This branch adds independent executable tests and evidence only. No runtime, recorder, chest, navigation, filesystem guard or acceptance ledger implementation was changed. Work ran in a new isolated worktree, with temporary SQLite files and in-process fake world observations. No Paper or paid inference.

The authoritative [public charter](https://github.com/ManpreetS2/Minecraft-Ai-Civilization/blob/main/project.md) requires legitimate material consumption and observed physical outcomes and distinguishes those from database events. The candidate README points there; its project.md is explicitly historical. The candidate docs/V1_ACCEPTANCE_LEDGER.md lists OFF-05 as AUTHOR_TESTED at a176fca; that is not independent acceptance on this source.

## Results

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run --config qa/construction-persistence/vitest.config.ts --maxWorkers=1 --no-file-parallelism
pnpm exec eslint qa/construction-persistence/test/persistence.test.ts qa/construction-persistence/vitest.config.ts
```

Tests: **7 passed, 5 failed, 0 skipped**, exit **1**. Lint: exit **0**. Actual output: evidence/results.txt and evidence/lint.txt. These are ordinary failing assertions, not expected-failure annotations or a passing acceptance claim. Node 22.12.0, pnpm 10.16.0, macOS. Every test imports the actual candidate modules through source aliases.

The positive dispatcher test completes the workshop with 70 placement requests (including multi-block door placement), reports 71 reconciled cells, durably saves COMPLETED, closes SQLite, opens a new connection, and preserves task identity/owner/progress. Two subsequent dispatches add no placements or material consumption. Initial controlled stock is explicit: 1000 planks and ten each of door/chest/torch/crafting table. End stock is 933 planks and nine of each other item; 66 planks are placed and one is deposited during workstation validation. Nothing is minted during the test. This proves the lower-level engine/storage contract using simulated observations, not application-wide successful completion.

The real executePlan path persists partial progress and resumes from new SQLite and SettlementRuntime instances. Missing materials and silent placement failure do not complete or consume stock. Abort adds no placements and preserves reconciled progress. An unaffiliated citizen is refused. A forged COMPLETED row is rechecked against the fake world and does not produce a completion memory.

## Reproducible defects and handoff

Append the indicated `-t` filter to the Vitest command above for a minimal reproduction.

1. `-t 'completes through real executor'`: after up to 300 real executePlan calls, the workshop stays BUILDING with one door entry remaining, despite 70 placement requests. build-structure.ts dispatch accepts getBlockProperties, but executeBuildStructurePlan supplies only block names to the dispatcher. Stateful door verification therefore remains unverified. Recommended fix: wire observed block properties through the executor adapter and recheck full completion. The passing dispatcher test supplies those observations and isolates the wiring gap without changing source.
2. `-t 'replayed completion'`: two more executor deliveries issue no placements but lower planks from 923 to 921 through repeated workstation validation deposits. These are simulated transfers into the test container, not destroyed items, but retry is not materially idempotent. Recommended fix: preserve/reconcile validation effects or avoid repeating the mutating probe while physical state remains unchanged. The harness asserts citizen/container changes via the real depositItem implementation.
3. `-t 'another member'`: after restart, another authenticated member of the same community executes the same objective and replaces citizen_atlas's project with an other-owned project. Runtime claims are empty after restart; projectsMatchIntention rejects reuse for a different owner, then a fresh project replaces the single community row. Recommended fix: enforce project ownership or explicit authorized reassignment at dispatch/persistence boundaries, and restore/reconcile site claims. The planner helper itself refuses the other owner, but the executor accepts a supplied valid planner task. No cross-community bypass is claimed.
4. `-t 'explicit cancellation'`: executeBuildStructurePlan(cancelled: true) returns CANCELLED and updates in-memory project.cancelled, but does not invoke the supplied real persistence callback. Reopening SQLite restores cancelled:false. Recommended fix: persist cancellation and report failure to persist it; cover restart behavior.
5. `-t 'shutdown with a closed store'`: aborted late execution against a closed store throws from CivilizationStore.hasCommunities before returning a safe action result. Recommended fix: reject late execution before reading closed SQLite. This is a focused executor lifecycle boundary reproduction, not proof that the manager always schedules that call. A full manager stop race remains unproven.

## Scope and evidence limits

The fixture uses real executePlan, executeBuildStructurePlan, plannedTaskForConstructionProject, dispatchCitizenBuildIntention, advanceBlueprintBuild, placeBlock, inventory service, CommunityConstruction and CivilizationStore. The initial objective is a supported planner-shaped task; continuation comes from the real planner helper. The higher-level manager/model decision loop is not exercised. The test falls back to the initial objective to probe repeat delivery even when normal planner scheduling would stop; it does not pretend the planner emits repeated completion messages automatically.

The existing production harness supplies fake navigation and world placements; the QA fixture adds inventory slots and a fake container transfer so full validation runs rather than crashing on an incomplete fake bot. It does not override executor, construction, verification or persistence code. Door properties come from the fake placement harness. The new SQLite connection is real; the fake Minecraft world and inventory remain in memory across the storage restart, modeling an independently persistent server. Application SQLite does not itself restore that physical inventory. Full process/server restart, genuine playerdata durability, live material provenance and Paper structures remain unproven.

Repeated commands test duplicate delivery effects. There is no tested durable event-ID deduplication interface here, so arbitrary event bus replay idempotency remains unproven. Shutdown testing covers aborted work and closed-store late entry, not every manager concurrency interleaving. The task row is trusted-runtime storage: saving a forged row directly is a corruption test, not an exposed model API exploit.

Existing interrupted/negative unit tests were inspected before this suite was written; their past results are not counted here. No implementation fixes or ledger upgrades are included. Integrators must fix the defects and rerun these independent assertions on their final source SHA before advancing OFF-05.
