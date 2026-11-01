# Offline experiment preflight and operator evidence

Base: `980ea688441bb12f0a26449b5727f7574cc4be5a` (reviewed draft PR #10).
Branch: `agents/t3-experiment-offline-preflight`.

## Executable preparation

`pnpm experiment:preflight <manifest.json> <absolute-authoritative-checkout-root>` reads only a bounded JSON manifest and filesystem path metadata. It never opens SQLite/world contents, starts Minecraft/Paper, resolves credentials or calls a provider. The manifest schema and disposable fixtures are in packages/agent-core/src/experiment-preflight*.ts. Model labels/sessions in the manifest are configuration assertions, not proof of provider isolation. Likewise inventory/shelter/privacy assertions must ultimately be populated from authenticated runtime observations and a source-matched replay, not a model's prose. This tool does not authenticate such external evidence or grant launch authorization.

Checks: 1v1/2v2 counts, unique IDs/sessions, balanced family counts, explicit two-community membership independent of model family, separate sites, 60-minute 2v2 duration, observed empty inventory/absent supplied shelter, explicit Paper version/build, ordinary survival rules, bounded spend configuration/unknown-usage handling, operator-only recording, no directives and source-matched privacy replay metadata. Unknown fields (including keys) are rejected without echoing values. It requires absolute paths, an isolated root disjoint from the authoritative checkout, mutually separate world/DB/evidence destinations, separator-aware ancestry and canonical junction/symlink resolution including not-yet-created destinations. These checks are conservative preparation, not a production migration or launch runner.

`readyForLive` is literally false. Code-owned release blockers cannot be cleared by manifest fields: SEC authorization review; protected executor integration; Claude registry/real manager acceptance; knowledge singleton version binding; live protocol parity; explicit live/spend authorization. A valid offline fixture returns configurationValid=true, NOT_READY, exit 2. Missing/invalid input returns NOT_READY, exit 2. CLI tested against artifacts/campaign/preflight-fixture.json, a synthetic assertion fixture only.

## Operator evidence journal

ExperimentEvidenceJournal provides an exclusive-create JSONL file, operator-only audience, actor-bound attempt/observation correlation, unique IDs, stable experiment ID, sequence and hash chain. Strict typed fields omit raw prompts/responses/keys. Record decision event IDs and decision source (model/planner/reflex). Inventory/world observations distinguish verified, failed and unverified reports. Craft verification requires gained output plus consumed ingredients; placement requires consumed item plus target block change; eating requires inventory consumption and hunger recovery. Arrival uses observed position, speech uses authorized delivery recipients supplied by the communication runtime. A death invalidates its in-flight receipts; shutdown records incomplete actions. Tick duration and TPS are measured inputs; absent TPS stays absent. Normal close fsyncs and closes; previous evidence is never overwritten.

This is instrumentation API plus offline tests, **not yet manager wiring**. Trusted runtime callers must supply genuine observations. The journal does not itself observe Minecraft, authenticate a model request, enforce recipes, authorize hearing, implement respawn, or replace Claude's provider/token ledger. Crash recovery must preserve a truncated final line and start a new evidence file; automatic restart stitching is not implemented. Per-citizen usage/request/model-session references and world/drop/death inventory details still need the manager/provider adapter. No secrets should be passed in identifier fields; validation is not a secret detector.

## Installed version audit (read-only)

| Check | 1.21.6 target | 1.21.11 historical |
|---|---|---|
| Installed minecraft-data exact resolution | yes, protocol 771 / data 4435 | yes, protocol 774 / data 4671 |
| Installed Mineflayer 4.39.0 testedVersions lists version | yes | yes |
| Installed minecraft-protocol | 1.68.0 | same installation |
| Installed minecraft-data | 3.116.0 | same installation |
| crafting_table item / block IDs | 320 / 193 | 332 / 205 |
| wooden_pickaxe item ID | 877 | 913 |
| Survival names/recipe/tool/food contracts | offline tests pass | offline tests pass |
| Paper handshake, commands, collisions, crafting window, survival | **not observed** | historical evidence only, not replayed here |

Three new version tests cover exact resolution, key survival items/blocks/recipes/harvesting/food, and demonstrate numeric-ID differences. No active game version changed. minecraftKnowledge() still initializes a default 1.21.11 singleton; explicit negotiated-version binding and call-site audit remain offline work before 1.21.6 can be declared ready. Never reuse numeric registry IDs across versions. Mineflayer's upstream testedVersions list is library metadata, not our server acceptance evidence. Paper #48 binary/hash/plugin compatibility and gamerules need isolated live verification after authorization.

## Verification

45 focused tests pass (preflight 32, journal 10, version 3). Full workspace: **1568 passed, 0 failed, 2 Windows-skipped / 1570**. Frozen offline install, full typecheck/lint/build and separate preflight CLI TypeScript check pass. Two skips are pre-existing POSIX-conditional BodyLock cases; do not treat them as failures repaired here. Artifacts: artifacts/campaign/final.json, final*.log, preflight-cli.log. The exact synthetic CLI correctly exits 2. Zod 3.25.76 was already installed/locked elsewhere; agent-core now declares that direct dependency. No new external dependency version or service was introduced.

## Newly available independent review

Claude's review of the original SEC proposal requests changes (Issue #6 comment 6561572145). Corrections are checkpointed on combined-tree branch agents/claude-sec001-combined-review at 1f8e286 (parent 7c039ec). Integrate only after inspecting exact source and tests. Until then this branch still has the original reviewed weaknesses, including retroactive community access; 220 green original tests do not overturn that finding. T3 owns follow-up sitesKnownTo implicit sharing and premature bulletin delivery marking. Retention after voluntary departure is an owner policy question raised by Claude, unchanged here.
