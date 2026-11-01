# SQLite runtime launch boundary (Issue #20)

Source base: b514603406f62ba38343899625b01bf6264def38, child branch agents/t3-safe-sqlite-launch.

The previous application startup could contact Paper/RCON before AgentManager opened a database by mutable filename. A checked path or read-only descriptor does not constrain better-sqlite3's later filename open, SQLite sidecars, or a replaced ancestor. No verified OS containment boundary exists in this application.

This proposal therefore refuses live launch before environment loading, server/RCON access or SQLite. Construction live flags and World-Lab connection/SQLite inspection paths also refuse. AgentManager's implicit store accepts only the exact :memory: name; trusted offline tests may explicitly inject an already-open disposable store. The raw CivilizationStore API remains available for offline tools; this is not an OS sandbox for arbitrary trusted callers. No environment flag or operator assertion bypasses the restriction.

This deliberately blocks file-backed runtime functionality rather than claiming a rename-race repair. Enabling future live operation requires a reviewed OS containment/immutable protected-root design, independent QA and separate owner authorization. No production database/world was opened or migrated. CODEX 3's guard implementation is untouched; the current base includes its older 7ba269c checkpoint, not acceptance of newer 652fc605.

Ten regression cases track the real better-sqlite3 constructor: missing file, replacement, three sidecar hardlink aliases, repeated/multilink launch, redirected ancestor/root, disposable file restart, real memory database and application entrypoint refusal before Paper. Baseline: 9 failed / 1 passed. After: 10 passed. Full tree: 1837 passed / 0 failed / 2 skipped; typecheck, lint, build and frozen offline install passed. Evidence: ignored artifacts/campaign/sqlite-launch-*.log and sqlite-launch-final.json.

The separate intact scripts/repro-routing-persist-admission.ts reproduces an unpaid mock transport call after reservation persistence fails on the base registry. It is intentionally outside default Vitest discovery. Claude's published 6569ca3 fix is the next integration task; this checkpoint must not be labeled provider-ready until that reproducer passes. Original budget restart reproducer already passes on b514603. File-backed accounting still cannot promise crash-proof recovery after an already-sent request if its subsequent persistence fails.

Current state is NOT READY for live 1v1 or 2v2. Physical executor community scoping, actual manager/planner simulated-survival integration, independent review, owner policy decisions O2/O4, provider transport and live authorization remain outstanding.
