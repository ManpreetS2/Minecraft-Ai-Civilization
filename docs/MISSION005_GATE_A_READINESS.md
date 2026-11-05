# Mission 005 — Gate A readiness package (runbook only)

**Authority:** Offline engineering. Does **not** authorize Paper startup, paid providers, production worlds, or protected merges.  
**Candidate:** PR #56 tip (see git).  
**Charter:** `project.md` @ `63d1b97b188fb840db05c6baf60b549c476e508f`

## What this package is

A controlled checklist for a **future** isolated real Paper 1 GPT vs 1 Claude Gate A test. Offline rehearsals (`pnpm v1:offline 2|4`) exercise the real manager/planner/executor with **scripted** model transports and controlled fixture bodies. They do **not** demonstrate genuine Minecraft survival.

## Offline rehearsal commands (today)

```powershell
# Clean tree required (provenance)
pnpm v1:offline 2 artifacts/v1/mission005-1v1
pnpm v1:offline 4 artifacts/v1/mission005-2v2
```

Artifacts per run: `operator.jsonl` (hash-chained operator journal), `manifest.json`, `scenario.json`, `verdict.json`, `NOT_PROVEN.json`, acceptance stubs.

Journal declares `decisionTransport: scripted-in-process`. `serverGameTick` is omitted (`tickProvenance: unavailable`). Tool durability is omitted when the fixture cannot observe damage. Bundle validator verdict for offline structure is **`NOT PROVEN`** — never a live Gate A pass.

## Required for a future live Gate A (unproven until run)

| Item | Requirement |
| --- | --- |
| Paper | Disposable Paper matching project World-Lab version; **isolated** host/port; never production |
| World | New disposable world directory; never production worlds |
| SQLite | New disposable DB path under an operator-owned temp root |
| Models | Owner-approved GPT + Claude model IDs; per-citizen credentials; no shared keys |
| Spend | Explicit max requests + USD ceiling in experiment config; kill switches documented before start |
| Evidence | Operator journal path + manifest; live mode; Paper tick source once validated monotonic |
| Kill switches | Immediate process stop, provider cancel-all, Paper stop script |
| Startup | Owner authorization recorded; preflight; network allowlist only to providers; disposable Paper up |
| Shutdown | Drain pending ops; close journal; stop Paper; archive evidence; never leave production artifacts |

## Live vs offline validation

| Claim | Offline rehearsal | Live Gate A |
| --- | --- | --- |
| Scripted manager/planner/executor path | Exercised | Same path, live bodies/providers |
| Private memory / routing | Exercised | Must re-prove with live transports |
| Physical gather deltas in fixture | Exercised | Must re-prove in Paper world |
| Paper `serverGameTick` continuity | **NOT_PROVEN** | Required |
| Real model decisions | **NOT_PROVEN** (scripted) | Required |
| Actual API spend | Synthetic zero | Metered under ceiling |
| 60-minute survival | **NOT_PROVEN** | Gate B / later |

## Still unproven / blocked for authorization

- Independent `OFFLINE_PASS` tip acceptance (ledger **0/18**).
- Movement/guard ownership (CODEX 1.2) if Gate A needs those paths.
- Evidence validator package (Gemini `experiments/evidence-validator`) not folded into this workspace — adapter consumes reports when supplied.
- Cross-community chest grant policy remains **provisional** (not owner-approved).
- Mineflayer/Paper tick monotonicity across day cycles — must be verified before adopting `bot.time.time` as `serverGameTick`.

## Operator actions for controlled live start (when authorized)

1. Owner records written authorization (spend ceiling, models, world path).
2. Create disposable directories; confirm production paths untouched.
3. Run experiment preflight against the live manifest.
4. Start disposable Paper; confirm ping/version.
5. Start orchestrator in live mode with kill-switch hotkeys documented.
6. Archive evidence continuously; on stop: drain, journal close, Paper stop, hash artifacts.

**Gate A authorization assessment:** **NOT READY.** Offline Mission 005 rehearsal strengthens implementation evidence only.
