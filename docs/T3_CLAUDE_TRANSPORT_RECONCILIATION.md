# Completed Claude transport reconciliation

Parent source f25c6f0ca11f0c2b38bfe9e3479905d53c528df9 (#31). This child integrates only the published completed #28 checkpoint fa13d3b8c090e4c8ebd8b9f2eb38183c00e88c51, via clean merge2e2cec479ac7d9f7d40d66137e0e3275a173d6e9. Behavior/test checkpoint9d0370688a8b1750f8d926978614bfe95be0dee7. pnpm-lock auto-merged; frozen offline install passed, retaining orchestrator cognition dependency and SDK1.3.0. No changes to Claude-owned provider implementation by CODEX1, nor integration of Claude2's unfinished hardening branch.

The official SDK is driven only through simulated HTTP in 90 contract cases. Live transport remains on a separate import path behind a default-deny paid gate. Actual endpoints/models/credentials have never been contacted or verified. The orchestrator offline factory rejects a transport marked paid before any body/send; new regression preserves that boundary. Real normal-start 1v1/2v2 planner/skill capability tests still pass. Root focused commands now include the new community privacy and startup/physical suites.

Results: full2032 pass/0 fail/2 skip (177 files, process exit0); security358 pass; AI459 pass; SDK/provider/manager focused451 pass before the additional refusal test; final runtime suite9 pass. Typecheck/lint/build/frozen offline install/diff checks pass. Both original registry budget reproducers PASS. API cost incurred $0.

The intact global-executor isolation reproducer still FAILS with settlement_first.food0->2. After clean install, its bare root @civ/shared import proved undeclared; it now imports the existing package source path, without changing assertions. The final rerun reaches the expected actual assertion, not a module-resolution error. File-backed accounting still has the documented post-send persistence/crash limitation. No source/runtime/live success is inferred from fixture green counts.

Current self-contained handoff: docs/T3_CAMPAIGN_RESUME.md. No server, production data, protected executor/guard/adapter edits, force push or protected merge. Overall NOT READY.
