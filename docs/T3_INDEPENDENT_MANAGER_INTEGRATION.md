# Independent manager/session integration ? offline candidate

Branch `agents/t3-independent-manager-integration`, base reviewed security candidate `e85d7f9f0ae393fdd80d8460178d31f3261cfebe` (#16).

Inspected and merged exact published registry `5522748fd1f6d570d705820f443359f76f857aae` (#17), then inspected/merged manager proposal `81c846d63496942db188b4100d71d530b1d52117` (#18). Local source merge checkpoints: `1b52a0d` and `12fe135`. Both merged cleanly and preserved O3 deferred acknowledgement, scoped planner state, reviewed SEC invariants and cloud cost controls. No Claude in-progress worktree edited and no registry production fixes duplicated.

## Manager repairs with red/green evidence

Five new tests failed against the proposal and pass after narrow manager adaptation:

1. Routed mode still instantiated the unused global provider, requiring a global paid credential/config. It now creates an inert router-only sentinel; unknown citizens cannot borrow any provider.
2. A model decision already queued before death survived cancellation and could steer the respawned body. Cancellation now clears that citizen's pending goal/bulletin selection as well as cancelling its session. Applied on ordinary/terminal death, operator task stop and admin override.
3. Disconnect/kick left the session active. It now suspends that citizen only and discards queued decisions; spawn/respawn resumes the same identity.
4. Context preparation errors left llmBusy/in-flight counters stranded. Admission flags are set only after synchronous context preparation succeeds.
5. A provider throwing synchronously escaped the Promise finally block. The actual provider invocation now runs inside the tracked Promise; rejection/error accounting and flags recover normally.

The structural router interface is exported for an orchestrator factory. No change to executor.ts or construction guard. Current default orchestrator startup is still the legacy factory; it does not load an experiment assignment profile automatically. Explicit injection is exercised in tests. A production operator configuration/launch adapter still needs implementation and review.

## Acceptance and honest limits

Real AgentManager ticks + real registry/provider code + real SQLite, with scripted OpenAI fetch and Claude transport. Tests cover exactly one GPT plus one Claude, four sessions, distinct choices, per-citizen private histories, same-community announcements across model families, rival privacy, unassigned refusal, concurrent inference, one-body failure, death/cancel, reconnect identity, personal memory/model binding across affiliation changes, and SQLite/private history/session/accounting across restart. Real fetch is trapped; credentials are synthetic. Same-family models in the example routing fixtures differ; these are test cases, not an approved fair experimental configuration.

The planner and Minecraft bodies in these manager tests are stubbed. These tests **do not** establish physically verified manager-driven survival, Paper compatibility, real API acceptance or a live Claude transport. The separate skills capability fixtures remain independent evidence; combining their PASS labels does not make full D1/D2 acceptance pass. Protected community executor wiring remains required.

## Blocking cost-policy finding (not hidden by the green suite)

`pnpm exec tsx scripts/repro-routing-budget-restart.ts` currently **fails**: a usage:null response correctly closes the run, but recreating the registry with the same run/store restores dollars/holds/requests without restoring cost-fault closure. No network; one scripted GPT assignment and disposable in-memory session store. Hard-dollar reservations are retained, but the run's explicit unknown-usage fail-closed policy is not retained. Release **NO-GO** until corrected.

This reproducer is deliberately a standalone executable with its assertion intact, not an expected-failure/skip. It is outside the default *.test.ts glob; a green workspace run therefore does not cover this outstanding failure. Claude owns registry production files; finding and exact reproduction posted to Issue #6 comment 6561933875. Do not weaken the assertion or merge as ready. Add this case to the registry suite when the owner publishes a fix.

## Verification

- Imported cognition package: **291/291 passed**.
- Proposal baseline real manager/security: **48/48 passed**.
- New lifecycle red run: **5 failed / 10 passed**.
- Adapted manager + SEC manager: **56/56 passed** (18 routed-manager tests, 38 SEC manager tests).
- Full workspace: **1757 passed / 0 failed / 2 existing skips / 1759**.
- Full typecheck/lint/build pass; diff whitespace passes.
- Separate unknown-usage restart reproducer: **1 confirmed failure**, pending Claude fix.

Artifacts: artifacts/campaign/routing-*.json and *.log. API cost incurred: **$0 actual**; reported fixture token/dollar accounting is simulated. No live server, production database/world operation or protected-branch merge. Code-owned preflight release blockers remain in place.
