# Construction completion and restart fixes

This implementation starts at PR #61, `1d7170741bdebe04e1c7c59eb210c0a357d5b0ea`, preserving its action recording and stale chest-token fixes. The original PR #63 QA directory is imported verbatim, including its historical report and results. Its test file blob remains `e810fe4283ce510ef47b135390cec22fc5a47863`.

All five reported defects reproduced on PR #61 before implementation: 7 passing, 5 failing, 0 skipped, exit 1. The unchanged 12 assertions pass after implementation. Executable source is frozen at `84237590e5d74cb6f4a3b9c792b305f391c24d40`; the publication follow-up adds documentation and command output only. New code and focused assertions are author-run regression evidence, not independent OFF-05 acceptance.

## Behavior

- The executor adapter now obtains block properties from the observed Mineflayer block and normalizes their actual values to the verifier's string representation. Missing observations stay missing. Stateful door checks can complete without manufacturing world state.
- Workstation validation opens and reads the actual container, closing it afterwards. This is a fresh, read-only accessibility check instead of depositing another plank on each retry. Failure to open/read remains a validation failure. Tests explicitly cover repeated successful reads and an inaccessible container. No durable transfer marker is needed because validation no longer transfers or reserves materials.
- Dispatch and cancellation reject a different owner. The transactional SQLite save also checks both prior and proposed owner, so bypassing planner checks cannot overwrite another citizen's project. There is no new reassignment endpoint. Existing ownerless community projects remain compatible. Each community retains its separate runtime and row.
- Runtime hydration restores all durable communities' non-cancelled, non-failed site claims into the shared claim board before new work. Claims are refreshed from durable project ownership. Project/physical reconciliation remains required after restart.
- Explicit cancellation invokes the supplied persistence callback. A failed write returns a retryable unsuccessful result with `phase: PERSIST_FAILED`, `persisted: false`, and the storage reason. An in-memory cancellation can therefore stop work while honestly reporting that restart safety was not established.
- executePlan checks `store.isOpen()` before community/database queries. Late entry into a closed application returns a controlled unsuccessful result. No blanket exception handler hides unrelated programming errors.

Successful controlled executor construction now reaches COMPLETED after 70 fake placement requests and 71 reconciled cells (the door spans two cells), saves the project, opens a new SQLite connection and replays continuation without additional placement or inventory changes. Final fake inventory has 934 planks from 1000, and nine each of door/chest/torch/crafting table from ten each. Validation no longer transfers a plank.

## Reproduction and validation

Run from repository root:

```sh
pnpm exec vitest run --config qa/construction-persistence/vitest.config.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run packages/agent-core/src/construction-persistence-reliability.test.ts packages/agent-core/src/community-construction-runtime.test.ts packages/agent-core/src/executor-community-construction.test.ts --maxWorkers=1 --no-file-parallelism
pnpm test --maxWorkers=1 --no-file-parallelism
pnpm test:security --maxWorkers=1 --no-file-parallelism
pnpm typecheck
pnpm typecheck:tools
pnpm lint
pnpm build
```

Actual command output is in `docs/evidence/construction-fix/`; `red-before.txt` is the run on the unmodified PR #61 implementation, and `green-after.txt` is the unchanged QA suite after fixes. Historical QA evidence under `qa/` still refers to its original older source and must not be counted as current passing evidence.

The focused command passes 12 tests (four new tests plus eight existing community/executor checks), and security passes 358 tests. The V1 tooling command, `pnpm test:v1 --maxWorkers=1 --no-file-parallelism`, passes 100 tests. All have zero failures/skips and exit 0. Typecheck, tools typecheck, lint and build pass with exit 0.

An earlier workspace run overlapped development and reported 2267 passing/one failing assertion: the new ownership assertion ran with cached pre-fix modules. That output is retained as `workspace-during-development.txt`, not counted as final validation. The clean final full run starts after the implementation freeze and passes all **2268 tests across 200 files**, with zero failures/skips and exit 0. No required check remains failing.

## Independent re-review

A different reviewer should rerun the original 12 QA assertions and the focused tests at the final integrated SHA, verify the original QA blob above, and inspect the observed-property adapter, read-only validation, owner checks, cancellation write failure and closed-store boundary. Re-run the security suites after integration. This PR neither updates the official ledger nor independently approves its own fixes.

Tests use actual executor, construction, verifier and SQLite implementations with controlled fake Mineflayer observations and temporary databases. They do not establish real Paper structure placement, live playerdata durability, full server/process recovery, model choice, paid billing or every manager shutdown interleaving. World and inventory remain in the fake server across SQLite reopen. No live Paper, paid providers or production data were used.
