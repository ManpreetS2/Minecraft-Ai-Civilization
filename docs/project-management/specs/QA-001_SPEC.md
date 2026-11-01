# QA-001 SPEC - offline 1v1 survival test harness (2v2-ready)

🛠️ ENGINEERING RESEARCHER | Technical Research

Date: Oct 31, 2026 (America/Los_Angeles). Author: Engineering Researcher. Implementer: Bug Hunter (NEW files only).
Basis: reviewed branches F1 36f9ae1, BASE-003 a27c817, CRAFT-001 70be7db, AI-001 54d2c62 (all on `origin` as of 7:50 PM PT), Codex PRIV-001 99c0e00, and `docs/project-management/SPEC_2V2.md`.
Status of this document: DESIGN. Nothing here is implemented or verified against a live server. SPEC_2V2 Gate A states offline tests alone do not close it; this harness is evidence toward Gate A, never a substitute for the observed 1v1 run.

## 1. Purpose and non-goals

Purpose: a deterministic, offline, no-network, no-paid-API harness that runs two citizens (one per team) through scripted survival scenarios using the REAL planner, executor, skills, claim board, bulletin/context pipeline and CivilizationStore against a MOCK world, and emits a JSON report. It must also run a cross-team leakage check (section 9) and refuse to label results as evidence when that check fails.

Non-goals: no Minecraft/Paper process, no mineflayer connection, no provider SDK, no model calls, no pathfinder, no `AgentManager`, no dashboard. It does not rank GPT vs Claude and does not manufacture an outcome (SPEC_2V2 `valid_outcomes`).

Design rule for team count: the harness is parametrized `teams x citizensPerTeam`. 1v1 is `1x1 per team (2 teams)`; 2v2 is `2 teams x 2`. All scenarios and the leakage check must run unchanged with 2 citizens per team.

## 2. What exists and what to reuse (verified by reading)

| Asset | Where | Reuse |
|---|---|---|
| Mock mineflayer bot with real prismarine-recipe shapes, dig -> ground-drop entity, pickup-by-proximity, craft/table window, place, nav backend | `packages/skills/src/testing/mineflayer-craft-fixture.ts` (CRAFT-001, `createMineflayerCraftFixture`, L106-L444) | Pattern and recipe/inventory semantics. It builds ONE bot and ONE private `world` Map (L116), so two fixtures cannot share a world. Do not edit it. See Q1. |
| Slot-accurate inventory mock with delayed drops, full-inventory, partial-stack pickup | `packages/skills/src/collect-inventory-delta.test.ts` `world()` (BASE-003) | Copy the `put()` semantics into the new world model. |
| Mock world whose first dig throws so the excavation fallback runs; EventBus + real `CivilizationStore` + `executePlan` | `packages/agent-core/src/gather-fallback.test.ts` (F1) | Pattern for driving `executePlan(ctx, plan, store, events, runtime)` (executor.ts:153) with mock bots. |
| Mock nav backend via `setNavigationBackend` / `createNavigationBackend("pathfinder")` restore | all three above | Required; restore in `afterEach`. |
| Deterministic clock, id factory, scripted/delayed/failing mock provider adapters (GPT and Claude wire shapes) | `packages/session-isolation/src/test-helpers.ts` (`createFakeClock`, `createIdFactory`), `mock-core.ts`, `MockAdapterOptions {script, delayMs, failWithStatus}` (types.ts:158-167) | Scripted cognition. Package `@civ/session-isolation` is on AI-001 only; not in the F1/BASE/CRAFT lineage. See Q2. |
| Planner | `planCitizen` (planner.ts) | Real; default decision path. |
| Claims | `SettlementRuntime.claims` (`ClaimBoard`), `cellClaimKey` (claims.ts:99,155) | Real. |
| Bulletin / context | `buildCitizenBulletin` (shared/src/bulletin.ts:105), `buildCitizenContextPack` (agent-core/src/citizen-context.ts:50) | Real, for the leakage check. |
| Privacy contract tests | Codex `packages/shared/src/bulletin-2v2-contract.test.ts`, `visibility-2v2-contract.test.ts` (branch `agents/codex-privacy-PRIV-001`) | Read for fixture shapes (four synthetic identities). Do not import. |

Test runner facts: root `vitest run`, include `packages/**/*.test.ts`, `apps/**/*.test.ts`, default 5 s timeout (CRAFT-001 needed explicit 30 s: its slowest case is ~4.7 s). Node >= 22 required (`better-sqlite3` fails on the box default Node 20). Baseline at 953d61e: 2 known failures (`construction-experiment-guard` "detects path aliasing", `blueprint` "has a floor, walls, roof, door, chest and crafting table") and 10 type errors; the harness must not change these counts.

## 3. Target file paths (all NEW; none of these exist)

Do not touch `executor.ts`, `manager.ts`, `collect.ts` (FILE_OWNERSHIP), and do not import `manager.ts` (it pulls the live Minecraft body layer). Importing `executor.ts` (read-only use of `executePlan`) is allowed.

Default location (no lockfile/root-config change needed): `packages/agent-core/src/qa/`

```
packages/agent-core/src/qa/prng.ts                  seeded PRNG (mulberry32) + stable hash
packages/agent-core/src/qa/sim-clock.ts             tick clock: tick -> simulated ms/ISO, Date injection helper
packages/agent-core/src/qa/mock-world.ts            shared world model (blocks, drops, mobs, day/night, hunger)
packages/agent-core/src/qa/mock-bot.ts              per-citizen mineflayer-shaped bot view over the shared world
packages/agent-core/src/qa/scripted-cognition.ts    CognitionProvider-shaped scripted/mocked decision source
packages/agent-core/src/qa/scenarios.ts             scenario definitions (data) + registry
packages/agent-core/src/qa/harness.ts               tick loop: observe -> context -> decide -> executePlan -> record
packages/agent-core/src/qa/metrics.ts               metric collectors + derived values
packages/agent-core/src/qa/report.ts                JSON report type, builder, canonicalizer, hash
packages/agent-core/src/qa/leakage.ts               marker planting + surface scanners + positive controls
packages/agent-core/src/qa/qa-001.test.ts           acceptance tests (IDs in section 10)
packages/agent-core/src/qa/qa-001-leakage.test.ts   leakage acceptance tests
packages/agent-core/src/qa/README.md                how to run; no secrets
```

Optional runner (not required for acceptance): `packages/agent-core/src/qa/run-scenario.ts` writing the report to a path under `os.tmpdir()` or an explicitly passed `--out`; never into the repo tree, never into `data/`.

## 4. Mock server / world model

One `MockWorld` instance shared by all citizens (this is the property the CRAFT-001 fixture lacks).

- Grid: integer block map `Map<"x,y,z", BlockName>`, default ground `y<=63` stone, air above; feet at y=64 (same convention as the CRAFT-001 fixture, L102-L103).
- Two "sites" per scenario at configurable distance (default 160 blocks, inside SPEC_2V2 ~120-200); each site has trees, stone, optionally coal/iron, water. World generation is a pure function of `(seed, scenarioId)`.
- Drops: dig removes the block and spawns a dropped-item entity; inventory changes only when the bot is within pickup radius (CRAFT-001: 1.3) or by the mapped drop; supports `dropDelayMs` in sim time, partial-stack pickup and overflow loss (BASE-003 semantics). Use the same drop mapping as production (`packages/skills/src/drop-mapping.ts`) for expectations, not a second copy.
- Recipes: use `@civ/minecraft-knowledge` recipe data like the CRAFT-001 fixture; table-required rules and 3x3 gating identical.
- Survival: `health` 20, `food` 20, exhaustion-driven hunger decay per sim tick, starvation damage at food 0, fall/lava damage optional, a scripted `MobSpawnPlan` (zombie at night within radius when unsheltered) with deterministic timing from the PRNG. Death: inventory cleared (`keepInventory=false`), respawn at spawn after N sim ticks; identity, memory and persistent facts preserved (SPEC_2V2 `death`).
- Day/night: `timeOfDay = (tick + offset) % 24000`; night 13000-23000.
- Faults (all scripted, never random-by-wall-clock): first-dig failure (F1 pattern), full inventory, craft rejection, nav failure, unreachable block.
- Isolation of perception: each bot sees only blocks/entities within its own radius; nothing returns another team's citizen unless within perception range (supports the speech checks).
- No network, no child process, no filesystem writes other than temp SQLite databases created with `mkdtempSync(join(tmpdir(), "qa-"))`, deleted in `afterAll`.

## 5. Deterministic seed and clock

- `seed` (string) feeds one PRNG; every random choice (terrain, mob timing, scripted cognition tie-breaks) draws from named sub-streams `prng.fork("world"|"mobs"|"cognition")` so adding a draw in one stream does not perturb others.
- Simulated time: `tick` (1 tick = 50 ms sim). The harness advances by explicit steps; no real sleeps. Simulated `Date` is injected with `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(...)` so production code that calls `new Date()`/`Date.now()` (store timestamps, `createEvent`) is reproducible. Do NOT fake `setTimeout`/`setInterval` globally: `collectResource` polls with real timers (BASE-003 `waitForInventoryGain`, default 1.2 s window); scenario drops are immediate unless the scenario is the delayed-drop one, which uses the `dropWaitMs` option and short real waits.
- Known non-deterministic sources in production code the harness must neutralize or normalize in the report: `crypto.randomUUID()` for persistent-fact ids (citizen-context.ts:78), `createEvent` ids, and `delivered_at`/`created_at` wall-clock columns. Compare facts by `factKey`/`content`, never by `id`; the report canonicalizer drops `id` fields and replaces timestamps with tick numbers.
- Determinism contract: same `(seed, scenario, harnessVersion)` => byte-identical canonical report (section 8) across runs and across two orderings of the two citizens' turns within a tick (fixed order: team index, then citizen index; the order is itself part of the report).

## 6. Citizens

Exactly two for 1v1: `team A: citizen_qa_a1`, `team B: citizen_qa_b1`. For 2v2: add `a2`, `b2`. Each has: own `MockBot` (own inventory, position, health/food), own bot-body stub (`nearbyEntities`, `unreachable`, `position`), own `CivilizationStore` rows (citizen record, personality), `citizenId` fixed, provider-family label as DATA only (`"gpt"|"claude"|"none"`) and never used for any authorization decision (Codex finding: provider family never authorizes information). Empty start: no inventory, no tools, no food (SPEC_2V2 `start`).

Executor wiring per citizen: a `SkillContext`-shaped object like the CRAFT-001/F1 tests (`bot`, `citizenId`, `events`, `timeoutMs`, `body`), one shared `EventBus` per run, one shared `SettlementRuntime` per TEAM (not per world) so claims are team-scoped by construction; the cross-team contention scenario (SC-02) deliberately shares one for contrast (see Q4).

## 7. Scripted or mocked cognition (no paid APIs)

Three decision sources, selectable per scenario and per citizen:

1. `planner`: the real `planCitizen` decision only (default, no LLM path).
2. `script`: a pure function `(observation, tick, prng) => HighLevelDecision | undefined` for exact goal sequences (e.g. gather_wood, craft pickaxe, mine_stone, eat, shelter).
3. `mock-provider`: wraps `createMockGptAdapter` / `createMockClaudeAdapter` (AI-001) with `script`, `delayMs`, `failWithStatus` to exercise latency, 429/500 retry/abort, and the planner fallback path. Replies are canned JSON that the real cognition output parser must accept; malformed replies are a scenario input (error code path).

The harness records every prompt object handed to cognition (the structured `CognitionPrompt`, including `bulletin`, `memories`, `personalityContext`, `settlementNeeds`, `nearbyCitizens`) so the leakage check can inspect exactly what a model would see. No real provider SDK may be imported; a test asserts `globalThis.fetch` and `node:http(s)` are never called (QA-NET-01).

## 8. Metrics and JSON report

Per citizen, per team and per run (all in simulated time unless marked `wall`):

| Metric | Definition |
|---|---|
| `survivalTicks` / `survivalSeconds` | ticks from spawn to first death, or to scenario end if none |
| `deaths[]` | `{tick, cause, position, inventoryLost}`; `deathCount` |
| `inventoryDeltas[]` | per executed action: `{tick, actionId, before, after, delta}` by item name from the mock inventory (never from executor-reported counts); `finalInventory` |
| `goals` | `attempted`, `succeeded`, `failed`, per goal name; a goal succeeds only if the verified inventory/world delta matches (CRAFT-001 style "claim matches inventory") |
| `errorCodes` | histogram of `ActionResult.code` (e.g. `ITEM_NOT_FOUND`, `INVENTORY_FULL`, `DIG_FAILED`, provider `TIMEOUT`/`CANCELLED`/`RATE_LIMITED`), plus first-occurrence tick |
| `actionsPerSecond` | `executedActions / simSeconds` (deterministic), and separately `wallActionsPerSecond` marked `wall`, EXCLUDED from the determinism hash |
| `claims` | `tryClaim` attempts/successes/contended, per team |
| `cognition` | calls, scripted vs fallback, simulated latency, aborted |
| `events` | counts by `SimEvent.type` |

Report (`QaReport`, `schemaVersion: 1`):

```json
{
  "schemaVersion": 1,
  "harnessVersion": "qa-001/1",
  "scenarioId": "SC-01",
  "seed": "qa-seed-1",
  "config": { "teams": 2, "citizensPerTeam": 1, "ticks": 6000, "siteDistance": 160 },
  "citizens": [ { "id": "citizen_qa_a1", "team": "A", "decisionSource": "planner", "metrics": { } } ],
  "teams": [ { "id": "A", "metrics": { } } ],
  "run": { "ticksRun": 6000, "turnOrder": ["A:0", "B:0"], "abortedReason": null },
  "leakage": { "ran": true, "passed": true, "controlsPassed": true, "checks": [ { "id": "LK-MEM-01", "channel": "memories", "planted": "team A", "observedBy": "team B", "leaked": false } ] },
  "evidenceValid": true,
  "wall": { "elapsedMs": 0, "wallActionsPerSecond": 0 },
  "determinismHash": "sha256 of canonical JSON excluding `wall`"
}
```

Rules: `evidenceValid = leakage.ran && leakage.passed && leakage.controlsPassed && no unexpected harness error`. Any summary or console line that reports survival/contact/cooperation outcomes MUST print `evidenceValid`; when false it must print "NOT EVIDENCE: leakage check failed or did not run" and must not print a comparison between teams. Canonicalization: sorted keys, ids/timestamps normalized as in section 5, numbers rounded to a fixed precision, `wall` removed before hashing.

## 9. Cross-team leakage check (mandatory; gates all 2v2 evidence)

Goal: plant marker memories, claims and speech in one team, then assert the other team can never retrieve them through any citizen-reachable surface. Run in both directions (A plants / B observes, then B plants / A observes) in every scenario run, with the same seed, as the last phase and also continuously (a scan every N ticks, so transient exposure counts).

Markers: unique tokens derived from the seed, e.g. `MARK-MEM-A-<h>`, `MARK-CLAIM-A-<h>`, `MARK-SAY-A-<h>`, `MARK-BULL-A-<h>`, plus a coordinate marker `x=137 z=-211` (Codex repro) so numeric leaks are caught. Markers contain no real secrets.

Plants (through production write paths, not by writing the observed table directly):
1. Memory: `store.addMemory(createMemory(<A citizen>, "social", "...MARK-MEM-A...", ...))` (store.ts:582) and an `observed_fact` via the same `upsertPersistentFact` route a bulletin would use (store.ts:489).
2. Claim: a team-A `tryClaim` on a cell/resource whose key and owner id contain the marker position; plus an A-side reservation (`ReservationBook`).
3. Speech: team-A citizen emits `ConversationOccurred` with `MARK-SAY-A` as public speech at a position farther than `PUBLIC_CHAT_RADIUS` (24 blocks) from every team-B citizen, and a second one as directed/private to an A-only audience.
4. Bulletin: emit events with `visibility` classes `actor_private`, `directed` (A-only audience), `nearby_speech` (A-only audience), `observer_only`, missing visibility, and `settlement_public` (with scopeNote naming A) carrying `MARK-BULL-A`. The `settlement_public` case is the SEC-001 reproduction (Part C of the review): today it is delivered to every reader.

Observation surfaces scanned for team-B citizens (scan the raw serialized string; any marker substring = leak):
- S1 `store.getMemories(b)` and the full `memories` table rows for B.
- S2 `store.listPersistentFacts(b)` and the whole `citizen_persistent_facts` table filtered to B.
- S3 `store.getDeliveredEventIds(b)` must not contain any A-private/directed/settlement event id.
- S4 `buildCitizenContextPack(...).promptExtras` (bulletin text, personalityContext, sharedObjective) and `.bulletin.lines/.excluded`.
- S5 the structured `CognitionPrompt` captured at the scripted/mock provider boundary: every field, including `memories`, `settlementNeeds`, `nearbyCitizens`, `gameFacts`.
- S6 the complete SQLite text dump of B's reachable rows plus a global scan that marker text appears ONLY in rows keyed to team A (or `events` rows, which are observer-side; see Q5).
- S7 claims: B's view of the claim board. Assert the marker owner id/key is never returned and, per Q4 policy, that B's `tryClaim`/`ownerOf` results are identical with and without A's claim present when the cell is outside B's perception (no existence side channel). Codex confirmed today's board is global (claims.ts:99-112) so this is expected RED unless teams use separate boards.
- S8 speech: B's heard-event list and any `HEARD`/`WITNESSED` memory created from the speech; also the optional typed ledger (`CognitiveStore` rows via `ingestObjectiveEvent` + `fromSimEvent`) when the harness attaches it (production does not wire it; see Q6).

Positive controls (a leak check that cannot fail proves nothing): (a) each marker is found on team A's own surface after planting (proves the plant landed); (b) a `world_public` marker IS delivered to team B (proves delivery works); (c) public speech planted WITHIN radius of a B citizen IS heard by that B citizen (proves the speech filter is not just dropping everything); (d) a deliberately injected leak (test-only monkeypatch of the guard under test) IS detected by the scanner (QA-LK-09). `controlsPassed` requires all four.

Gate: `leakage.passed` is true only if no marker appears on any B surface in any scan in either direction. The 2v2 results count as evidence only if `evidenceValid` is true (section 8).

Expected status today: S3-S5 settlement/bulletin plant, S2 persistence of the same, S7 claim existence, and S5 `settlementNeeds` from the single shared `settlement_first` object (manager.ts:1034 area; shared into every prompt) are expected to FAIL until SEC-001 lands. The harness must report them as leaks, not skip them.

## 10. Scenario definitions

Scenarios are data in `scenarios.ts`: `{ id, seed, ticks, teams, citizensPerTeam, siteDistance, worldSpec, faults[], decisionSources, expectations }`.

| ID | Name | Setup | Intent |
|---|---|---|---|
| SC-00 | Smoke | one site, empty start, 1 citizen per team, planner source | CRAFT-001 chain on two isolated bots: logs -> planks -> sticks -> table -> wooden_pickaxe |
| SC-01 | Parallel isolated bootstrap | two sites 160 apart, separate boards | both teams reach a pickaxe; verify no cross-team world or inventory interference |
| SC-02 | Contended resource | one tree reachable by both; shared board (control) vs separate boards | claim contention and `ITEM_NOT_FOUND`/claim error paths; contrast for Q4 |
| SC-03 | Night and hunger | no food, mobs at night, no shelter | deaths, respawn without inventory, memory preserved, emergency-shelter path logged separately |
| SC-04 | Gather faults | F1 first-dig failure; wrong-item drop; no-gain dig; delayed drop; full inventory; partial stack | error codes and verified-delta accounting (F1/BASE-003 behaviors under the harness) |
| SC-05 | Cognition faults | mock-provider `failWithStatus` 429/500, `delayMs` > timeout, malformed JSON, late reply after abort | fallback to planner, error codes, no state committed for cancelled calls (AI-001 late-reply discard) |
| SC-06 | Leakage | SC-01 world plus section 9 plants | the leakage gate in isolation |
| SC-07 | 2v2 shape | 2 teams x 2 citizens, SC-01 world | everything above holds at 4 citizens; per-team boards |

## 11. Acceptance tests

All offline, mocked, deterministic, Node >= 22. IDs are stable. "RED today" marks tests that must fail against current code because they encode SEC-001; they are not to be skipped, `it.fails`-ed, or weakened.

World and determinism
- QA-WORLD-01: world generation is a pure function of `(seed, scenarioId)`; two builds are deep-equal.
- QA-WORLD-02: two bots share one world; a block dug by one is gone for the other; their inventories are independent.
- QA-WORLD-03: dig yields a ground drop, not inventory; inventory changes only on pickup (CRAFT-001 invariant); partial stack and overflow match BASE-003 semantics.
- QA-WORLD-04: death clears inventory, keeps identity/memory/persistent facts, respawns at spawn.
- QA-DET-01: same seed run twice => identical `determinismHash`.
- QA-DET-02: swapping the within-tick citizen order flips only `turnOrder`, and each citizen's metrics are unchanged when the scenario has no shared resource (SC-01).
- QA-DET-03: different seeds change world content but not report schema.
- QA-NET-01: no `fetch`, `http`, `https`, `net`, `child_process` calls during any scenario; no provider SDK imports; missing API-key env produces no failure.

Scenarios and metrics
- QA-SC-00-01: SC-00 ends with `wooden_pickaxe` in the mock inventory; each tick's claimed result matches the real inventory.
- QA-SC-01-01: both teams reach a pickaxe; neither team's goals/metrics change when the other team's bot is removed.
- QA-SC-02-01: with a shared board, exactly one team owns the cell; the loser reports a contended outcome, not a fabricated success.
- QA-SC-03-01: starvation or mob death is recorded with cause and tick; `survivalTicks` equals first-death tick; respawn inventory empty.
- QA-SC-04-01..06: each fault yields the expected `errorCodes` entry (`ITEM_NOT_FOUND` on no-gain/wrong-item, `INVENTORY_FULL` before dig and block survives, `DIG_FAILED` fallback reached once, delayed drop counted within window and rejected beyond it).
- QA-SC-05-01..04: provider 429/500/timeout -> planner fallback recorded; malformed reply -> parse-error code; late reply after abort commits nothing; scripted vs fallback counts in `cognition`.
- QA-SC-07-01: 4-citizen run completes with per-team boards and a valid report.
- QA-MET-01: `inventoryDeltas` are computed from the mock inventory, not from executor output (inject an executor result that lies; metric still correct).
- QA-MET-02: `goals.succeeded` requires a matching verified delta (a goal reported success with no delta is counted as failed and logged).
- QA-MET-03: `actionsPerSecond` equals executed actions / simulated seconds; wall value present but excluded from the hash.
- QA-MET-04: deaths, errors and goals sum consistently across citizen -> team -> run.

Report
- QA-RPT-01: report validates against the `QaReport` type and a JSON schema; `schemaVersion` present.
- QA-RPT-02: canonicalization removes ids/timestamps/wall; hash stable.
- QA-RPT-03: `evidenceValid` false whenever the leakage phase is absent, red, or controls fail; the summary printer never prints a team comparison in that case.
- QA-RPT-04: report contains no markers' real secrets, no env values, no API keys (scan for `sk-`, `ANTHROPIC`, `OPENAI` patterns).

Leakage (section 9)
- QA-LK-01 (memory): planted A memory/persistent fact is never on any B surface S1/S2/S6, both directions.
- QA-LK-02 (claims, owner): B never sees A's claim owner or key.
- QA-LK-03 (claims, existence): B's claim attempts show no existence side channel for A claims outside B's perception. RED today (global board) unless per-team boards; see Q4.
- QA-LK-04 (speech, distance): public speech beyond 24 blocks is on no B surface (heard list, memories, bulletin, prompt, ledger).
- QA-LK-05 (speech, private): directed/private A speech never reaches B regardless of distance.
- QA-LK-06 (bulletin classes): `actor_private`, `directed`, `nearby_speech`, `observer_only`, missing visibility never reach B (S3-S5).
- QA-LK-07 (settlement): a `settlement_public` event scoped to A never reaches B in S3-S5, and no persistent fact for B is created from it (S2). RED today; this is the SEC-001 regression.
- QA-LK-08 (shared settlement state): `settlementNeeds`/workstation facts in B's prompt derive only from B's team state. RED today if one `settlement_first` object feeds all citizens.
- QA-LK-09 (scanner self-test): with a test-only injected leak the scanner reports `leaked: true` (negative control).
- QA-LK-10 (positive controls): all four controls from section 9 pass; otherwise `controlsPassed=false` and `evidenceValid=false`.
- QA-LK-11 (transient exposure): the periodic scans catch a marker present only between two ticks.
- QA-LK-12 (2v2): QA-LK-01..08 repeat with 2 citizens per team; a same-team teammate is not treated as authorization for memory (memory is owner-only per the PRIV-001 contract) unless the chosen contract says otherwise (Q3).
- QA-LK-13 (provider neutrality): swapping the label GPT/Claude for each team changes no leakage result.
- QA-LK-14 (no purge regressions): after the SEC-001 migration is applied to a contaminated fixture database, QA-LK-01..08 pass and uncontaminated facts survive.

Guard rails
- QA-GR-01: the harness change set adds no edits to `executor.ts`, `manager.ts`, `collect.ts` (git diff path check).
- QA-GR-02: after adding the harness, the full suite shows only the 2 known failures and the same 10 type errors.
- QA-GR-03: all temp databases and directories are removed after the run.

## 12. Out of scope

Live Minecraft/Paper; mineflayer connection; real pathfinding; real model/provider calls and token/cost accounting (mock usage only); the YC harness (`research/yc-harness/**`); `AgentManager` loop, dashboard, HTTP server; economy, wallets, governance, permadeath, 3v3+; fair-world validation of real seeds; performance benchmarking on real hardware; fixing SEC-001 or any production defect (the harness only detects).

## 13. Open questions (need an owner decision)

- Q1: Where may the harness import the CRAFT-001 fixture from? `@civ/skills` index does not export `testing/` and a relative cross-package import crosses tsconfig `rootDir` (the same problem Codex hit with shared). Options: export `./testing` from `packages/skills` (owned by Worker B), create a new `packages/qa-harness` (needs lockfile/root config, lead-owned), or copy semantics into `qa/mock-bot.ts` (this spec's default).
- Q2: `@civ/session-isolation` exists only on AI-001. Is the harness allowed to depend on it, or must scripted cognition be dependency-free until AI-001 merges? Default: dependency-free `script` source now, `mock-provider` source behind a flag.
- Q3: Memory scope within a team: owner-only (PRIV-001 `community-boundary.ts:88-96`) or team-shared? Changes QA-LK-12.
- Q4: Are claims physical (a shared board is realistic contention that the other team may legitimately experience) or social (team-scoped, invisible)? Decides whether QA-LK-03 is a defect or a design choice.
- Q5: The `events` table is the observer log (SPEC_2V2: observer logs full but not in world). Confirm the scanner treats it as out-of-world and that no citizen-facing read path queries it unfiltered (today `listEventsAscending(400)` feeds the bulletin, then bulletin authorization is the only filter).
- Q6: The typed ledger (`@civ/memory` `CognitiveStore`, `@civ/psychology` `CitizenMind`) is documented as NOT wired into the manager (`memory/src/integration.ts:8-19`). Should the harness attach it to exercise the future path (recommended), or leave it out of scope until integration?
- Q7: Required fidelity of hunger/mobs for Gate A: simple scripted threat model (this spec) or minecraft-data damage rules?
- Q8: Canonical citizen ids for the 1v1/2v2 fixtures (Codex uses synthetic names such as "GPT Citizen A"); which set should the report use?
