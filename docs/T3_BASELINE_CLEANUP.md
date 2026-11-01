# Offline baseline cleanup

Branch `agents/t3-offline-baseline-cleanup`, base survival checkpoint `2983c1728a66b8532a85b0f83d9d63b51848dfed`.

## Root causes and changes

- Legacy starterHut omitted optional crafting_table expansion; its manual role mapper also defaulted that workstation to planks. Uses the existing concreteBlock material contract and requests the table feature. Implied door upper halves are verification targets in the full blueprint, not separate inventory/placement items; omit them from the legacy placement list. Existing test assertions retained.
- Three construction launch refusal branches returned internal `{ok:false}` instead of the public `{allowed:false}` contract. Adapt the error explicitly, preserving refusal.
- Test callbacks/fixtures used unparameterized ActionResult, incomplete SettlementState and an obsolete uppercase directive. Correct the declared types and canonical fixture values without loosening production validation.
- Home probe read nonexistent Mineflayer time.isNight and formatted possibly absent positions. Use body.observe().isNight and explicit unknown position text.
- Fish probe had an unreachable UNVERIFIED comparison after control flow had already handled that outcome; remove only that dead final branch.
- Fifteen lint errors: unused probe constants/imports/parameters, two const declarations, unused planner destructuring and self-assignment. Preserve probe constants with underscore names where they document geometry. No executor.ts edits.

## Before / after

Staging: 1195 passed, 1 failed, 2 skipped; ten TypeScript diagnostics; fifteen lint errors.
Combined + new physical/survival work before cleanup: same known blueprint failure; new gathering regressions fixed separately.
After cleanup: **1523 passed, 0 failed, 2 skipped / 1525**. Focused blueprint/guard/build-intention/dispatch suites **49/49**. Full `pnpm typecheck`, `pnpm lint`, `pnpm build`, whitespace checks pass. Artifacts: artifacts/campaign/cleanup*.json and *.log.

No test assertions disabled, source deleted, broad any/ts-ignore added, live probe invoked, production data accessed or API request made. Build emits ignored dist files only. Full suite success is offline software evidence, not real Minecraft or independent-provider acceptance.
