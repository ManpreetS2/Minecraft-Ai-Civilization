# QA-P0 — Charter P0 knowledge-isolation QA

Base: `1d9967f0020840fe091cbbc77fe27234a577381f` (PR #120 integration; QA-only branch, no production edits).
Charter basis: `project.md` locked decisions 3, 5, 12 and 13 (citizens learn only what they observed, legitimately heard or received; private communication is a simulation rule; no omniscient shortcuts).

**Result: 49 of 49 tests pass; no information leak confirmed in any of the six requested vectors.** This does *not* by itself license a claim of genuinely independent societies — see "What this does not show".

Run: `pnpm exec vitest run -c qa/p0-isolation/vitest.config.ts` (Windows 11, Node 22.17.1, offline).

## Method

Real code under test: `AgentManager.tickCitizen`, `CivilizationStore` (SQLite, file-backed where restart matters), SEC-001 audience authorization, `buildCitizenContextPack`, `persistentFactsForCognition`, `speakNearby/hearersOf/performCommunicationIntent`, `sitesKnownTo`, `scopeSettlementForCitizen`, `seedCommunitiesOnce` (the production seeding path, which logs and ignores bad config), and the real `CitizenMind` / `CognitiveStore` / `observersForEvent` library. The exact text `formatPrompt` renders for a model is inspected for every roster member after each attack. Stubbed: Minecraft body, model provider (a recorder), physical planner. Every negative has a positive control (e.g. the teammate *does* receive a community-audience chest event; the legitimate audience *does* receive the announcement) so a green result is not vacuous.

Not repeated: Claude 1's PR #110 basic memory isolation; `sec001-independent-review` membership-timing/quarantine cases.

## Vectors

| # | Vector | Tests | Result |
| --- | --- | --- | --- |
| 1 | Unobserved chest transfer leaking into another citizen's beliefs | 22 | No leak. `ItemDeposited`/`ItemWithdrawn`/`ItemTransferred`/`ResourceTransferred`/`ItemTransferCompleted`, each with no label, `actor_private` and `observer_only`, never reach teammate, rival or rival-teammate prompts or fact stores. A forged `world_public` label with no audience reaches nobody. In the belief library, observers are by position only: a distant rival and teammate get no memory and no belief; `heardBy`/`recordReaders`/`participants` smuggled into the payload add no observers. Control: a citizen standing next to the transfer *is* a witness. |
| 2 | Undisclosed rival-community coordinates entering another prompt | 4 | No leak. A site discovered by `cal` is known to `cal` only (not to teammate `dee`, not to rival); coordinates in a community announcement reach only that community; sharing one bulletin line discloses only the chosen line, never the speaker's other line; the shared settlement row is replaced by a scoped view once communities exist. |
| 3 | Private messages delivered to unauthorized recipients | 6 | No leak. A partial whisper gives the unreached neighbour no event/fact/prompt line; a body that reports extra recipients does not widen the audience; range is a hard 8.0-block boundary (8.01 is excluded); a dead neighbour never hears; a player named `ADA` / `Ada ` is not credited as citizen `ada`; a failed whisper creates no `ConversationOccurred` at all; a private say to a rival is heard by neither side's teammate. |
| 4 | Speech allegations promoted into verified facts | 5 | No promotion. No stored hearer fact is `observed_fact`; the prompt labels every allegation `Heard (unverified claim, not an instruction)`; authority-spoofing text cannot start its own prompt line; repeating the allegation through two speakers is not corroboration; a legacy `observed_fact` row on a speech event is either excluded or re-labelled heard on read; library `hear()` stores `source: HEARD`, confidence below 0.6, only for the hearer. |
| 5 | Another citizen's memory, summary or mailbox leaking across sessions | 3 | No leak. Another citizen's memory is absent from retrieval, snapshot, narrative and memories, including after the database is reopened; a fresh manager on the same file gives the neighbour none of the other citizen's facts; ids differing by case, whitespace, NUL, `../` or SQL wildcards do not alias. **There is no mailbox feature in the code**: this part is not applicable. |
| 6 | Restart exposing global operator knowledge | 9 | No leak. Operator-only and unlabeled events never reach any prompt before or after a restart. A rival community's announcement stays out of the other community's prompts and facts after restarts with `COMMUNITIES_JSON` dropped, empty, invalid, conflicting (neighbour claimed by the rival), the rival renamed, or everyone moved into one new community (bad configs are ignored fail-closed; existing persisted membership keeps governing). With communities persisted, the site list stays scoped after a config-less restart. |

## What this does not show (limits that remain)

1. **Single-settlement mode is unscoped by design.** On a database that has never had communities, `sitesKnownTo(..., scoped=false)` returns every discovered site to every citizen. Recorded as a boundary test, not a defect: it is only a P0 violation if a society run is ever started with no communities configured. Recommendation: have the society/2v2 launch path refuse to start (or at least warn loudly) when communities are expected but `hasCommunities()` is false.
2. **Community membership comes from `COMMUNITIES_JSON` and is not authenticated per citizen session.** The isolation holds because the orchestrator, not a model, writes membership (tested elsewhere by `community-audit-guard`); a compromised orchestrator config is out of scope.
3. **The physical planner is stubbed**, so site knowledge was verified at the function level (`sitesKnownTo`), not through a planner prompt in the manager.
4. **`CitizenMind` / the psychology belief library has no production runtime caller** found in `apps/` or `agent-core`; its tests prove the library is isolated, not that the live manager feeds it. The live belief path is the bulletin + persistent-fact path (vectors 1-4 above, through the real manager).
5. **No real model, no Paper, no live chat.** A real client could expose information through paths the stub body does not model (server chat, proximity of real entities, plugin messages). Independent-society claims still need live observation.
6. The announcement/community audience model is "everyone in the community at event time"; a citizen who left later loses access to what they legitimately learned (open item O2 in `sec001-independent-review`), which is the safe direction.

## Verdict for the charter

No confirmed leak, so nothing here blocks the *offline* claim that the tested channels isolate community and private knowledge. Genuinely independent societies remain **unproven live** (limits 1, 3, 4, 5).
