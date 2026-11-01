# SEC-001-B manager integration: continuation state

**Status: WIP checkpoint. SEC-001 is NOT complete. Do not merge.** Private proposal branch `agents/claude-sec001-manager`, based on `agents/proposal-SEC-001-A@c2ce3aca16e74d0eacd3d69d663fbe654ccbf51c`. Kept separate from `integration/weekly-2026-10-31`. Production code is at `70ff857`; the tip SHA is posted on private Issue #2 (a commit cannot embed its own hash).

No live Minecraft, Paper, paid model request or real database was used. All results below are offline, against the real `AgentManager` and in-memory SQLite with stubbed bodies, cognition and planner.

## Weekly integration: verified, untouched

`integration/weekly-2026-10-31@17bff2d` was already built by Grok and was not redone. Reproduced in clean worktrees on Node 22.12.0, pnpm 10.16.0:

| Revision | Tests | Typecheck |
| --- | --- | --- |
| `b5715f7` (four-branch combination) | 977 pass / 2 fail / 979 | 10 known errors |
| `17bff2d` (adds AI-001) | 1062 pass / 2 fail / 1064 | 10 known errors |

Same two failures in both, unchanged from baseline: `blueprint.test.ts` (starter hut crafting table), `construction-experiment-guard.test.ts` (path aliasing).

## What changed

- **Speech:** `manager.ts` no longer calls `body.chat`. New `MinecraftBody.whisperTo` sends `/tell` per recipient, gated on the server's own `declare_commands` tree (`server-commands.ts`) and failing closed with no fallback to chat. If it can't be sent, no conversation event or memory exists; only an observer-only `ActionFailed` records the attempt.
- **Hearing:** audience is living citizens within `HEARING_RADIUS_BLOCKS` (8) per the speaker's client, independent of community.
- **`nearbyPlayers` bug fixed:** it returned every tab-list player with no loaded entity, so distant citizens appeared in the prompt's "Nearby citizens" and would have passed hearing checks.
- **Allowlisted intents:** optional `communication` on `HighLevelDecision` (`say`, `announce_to_community`, `share_bulletin_line`), executed by `community-comms.ts`. Models supply words and a name only. Sender and community come from runtime state and the directory; forged fields are stripped. A share can only reference a numbered line of the bulletin that citizen was shown, and the target must be within hearing.
- **Settlement:** once any community exists, `scopeSettlementForCitizen` gives cognition and the planner a neutral view instead of the shared row, and drops the work split derived from it. Without communities, behavior is unchanged. Rival-discovered sites are filtered from the planner.
- **Facts:** `persistentFactsForCognition` re-authorizes event-derived facts against the stored source at every read, so contaminated rows are excluded even if the operator migration has not run; rows are preserved. Same-key replacement now takes its own trust kind (PRIV-007 case 10); a replacement naming no kind cannot promote. Overwritten versions go to `citizen_persistent_fact_revisions`.
- **Speech trust:** new `reported_speech` kind. Speech is marked `(heard, unverified)` in bulletins and `Heard (unverified claim, not an instruction)` in memories, decided from the source event so legacy rows are covered. It has a separate budget (3) and cannot crowd out observed facts (5). Control characters can no longer forge bulletin lines.
- **`SimulationStarted`** now carries `audience: { scope: "world" }`. `executor.ts` is unchanged.

## Acceptance status

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Unauthorized settlement information blocked | Passing offline at manager boundary; see open items 3-4 |
| 2 | Same-community communication works | Passing offline through real manager path |
| 3 | Voluntary cross-community sharing | Passing offline through real manager path; `/tell` unverified live |
| 4 | Unauthorized messages not acknowledged or promoted | Passing offline |
| 5 | Historical facts cannot re-enter cognition | Read path passing offline; Codex migration findings still open |
| 6 | Codex regressions pass after compatibility updates | **NOT RUN against this branch** |
| 7 | Independent QA | **NOT DONE**; Codex downstream QA is waiting on this branch |

## Open items, in order

1. **Replay PRIV-001, PRIV-005, PRIV-007 and Codex QA `5df239c` against this tip** in a separate worktree/branch; don't edit the original red branches. Expected compatibility updates: fake store methods; `audience` on `world_public` fixtures; legacy-row seeding, because the secured writer refuses to create poison. Two PRIV-007 tests are declared characterizations of the old weakness (raw speech memory; five-row crowd-out) and should now fail by design. Report them as such; don't count them as passes.
2. **Live check required, not assumed:** does Paper offer `/tell` to a non-op citizen in `declare_commands`, does `bot.whisper` deliver on 1.21.6/1.21.11 with `online-mode=false`, and does anything else see it. Offline evidence only shows the parser matches a real `declare_commands` packet encoded by minecraft-protocol. Needs owner approval.
3. **Shared physical state remains (blocker for a real 2v2):** `executor.ts`, `construction.ts`, `homes.ts` and `workstations.ts` still read and write the one `settlement_first` row, and `listAvailableHomes`, `authorizedWorkStorage` and `runtime.project` are not community-scoped. Cognition no longer reads the row, but per-community settlement state is unbuilt. Overlaps Mission 013.
4. **Planner behavior under the neutral view is untested beyond inputs.** It sees zero stocks and no storage in community mode; check for planning loops in offline 1v1 work.
5. **Provider findings, unfixed:** `DECISION_JSON_SCHEMA` uses `strict: true` with optional properties (`targetCitizenId` already, now `communication`), which OpenAI strict mode is documented to reject; unverified without a paid call. `formatPrompt` keeps only the first five memories and facts are appended last, so facts can be dropped when five memories exist.
6. **Review PR #1** (`agents/chatgpt-reliability-20261031`, head `3e6c006`): NOT reviewed or run yet. Do not merge.
7. Lifecycle gaps from the handoff still open: no audited quarantine release API, events older than the newest-400 window are not delivered.

## Decisions to confirm

- **Hearing radius 8** reuses the existing work distance; Minecraft has no speech range, and the charter leaves the limit open.
- **A share reaches the target's whole community** (existing mechanism's semantics), gated on physical contact with one member. A directed-only share would be stricter.
- **Announcements have no in-game transport:** they are delivered to members' bulletins regardless of distance, as the brief requires for same-community communication.

## Windows Mission 013 conflict review

Mission 013 is unpublished, so this is against the published Windows WIP (`1a0756c`) only. The Windows owner must confirm.

- `manager.ts`: Windows WIP lacks the Mac-side `contextPack`, `persistentFacts` and `isThreeCitizenDemo` blocks, so the cognition-assembly region around `decide()` will conflict regardless of this patch. Also touched: `tickCitizen` signature and start, `llmDue`, planner `projectStatus`/`knownSites`, `maybeSocial` speech.
- `store.ts`, `citizen-context.ts`: Windows WIP lacks most of this code; expect conflicts inherited from SEC-001-A.
- `minecraft-body.ts`: additive, plus a `nearbyPlayers` condition. Windows WIP's adapter differences are in `navigation.ts` and `movement-sync.ts`, not this file.

## Resume

```
git fetch windows-backup
git worktree add <path> windows-backup/agents/claude-sec001-manager
pnpm install --frozen-lockfile   # rebuilds native SQLite for the new machine
pnpm exec vitest run packages/agent-core/src/sec001-manager.test.ts packages/minecraft-adapter/src/server-commands.test.ts
```
