# Sprint 001 — FIRST CONTACT (2v2 Rival Civilizations)

**Date:** October 31, 2026  
**Status:** Execution contract / planning document. Not evidence of implementation or a completed test.  
**Authoritative charter:** [../project.md](../project.md) — the **Active first-demo specification — Rival AI Civilizations** section overrides older three-citizen milestones.  
**Upstream harness:** [yc-software/minecraft-agent-harness](https://github.com/yc-software/minecraft-agent-harness); initial known reviewed public commit: `775d558689f5e4eaa0f1d0d7a320035190b1fce6`. Record the exact commit actually tested.

## One-sentence mission

Prove that **two GPT-powered citizens and two Claude-powered citizens**, each with a private independent model session, can operate autonomously as **two initially separate communities** for **60 uninterrupted real-world minutes** in **one actual survival Minecraft world**, without scripted rivalry or operator rescue.

## Critical path: only four gates

| Gate | Task | Pass requires | Stop / no-go |
| --- | --- | --- | --- |
| **0 — Protect** | Inspect Windows WIP; establish a verified independent backup and isolate a disposable test world/server/state. | Current git branch/HEAD/status, untracked code, required config, world/SQLite/WAL/SHM and restoration path documented; no production changes. | Any unknown uncommitted source, overwrite danger, unexpected Paper process, missing restore path. |
| **1 — Harness** | Pin upstream and test vanilla harness on its supported Paper **1.21.6** in a fresh environment. | Upstream checks pass; actual Minecraft bot connects, obtains world observations, executes a real bounded movement/gathering action; shutdown/reconnect behavior inspected; failure logs saved. | Host shell/sandbox unsafe, dependency/patch breakage, live game actions never verified, no API cost guard. |
| **2 — Independent 1v1** | One GPT citizen + one Claude citizen, no social scripting. | Both processes run simultaneously; separate sessions, persistent identity/memory, metered inference, no information leaks between citizens; normal survival actions visible. | Accidental common Pi history, global agent directory information leaks, cross-agent commands, uncontrolled costs. |
| **3 — Unscripted 2v2** | Two independent citizens per model family, separate natural starting locations, one real survival world. | **60 consecutive wall-clock minutes**, unaccelerated day/night, verified gameplay and auditable observations, natural food/shelter pressure, independent goals, honest failure records, no human rescue, no prewritten outcomes. | Any scripted enemy/leader/contact, admin interventions, unexplained time jumps, silently simulated physical work, fabricated achievement. |

**Gate numbering:** Gate 0 precedes all modifications. Existing historical Gate A/B references in the charter are superseded for this first-demo scope by the locked current 2v2 specification.

## Strict V1 scope

### Must have
- Exactly **4 citizens in the showcase**: two GPT-family / two Claude-family. Each has a distinct persistent agent identity, session and memory; no single AI controls the two citizens in one community.
- **One survival world**, two recorded and reasonably resource-comparable natural starting locations, with **empty inventories**, no gifted shelter/tools/food, no forced contact. An initial distance around **120–200 traversable blocks** is a planning hypothesis, not an untested game requirement.
- Every agent receives a comparable **neutral survival/autonomy objective**. Trade, war, agreements, migration, governance, friendship and isolation may emerge, but **none is guaranteed or directly assigned**.
- Physical actions through Minecraft, actual inventory/world verification, health/food/deaths/reconnects; demo uses **normal respawn, keepInventory=false**, preserving identity/memory.
- Explicit, **perspective-aware message delivery**: an agent only learns legitimately seen/heard/received information. Upstream team DMs and directory **are not sufficient** to prove cross-community natural contact. Introduce the smallest bounded local-speech or encounter adapter only if required; **no global cross-team telepathy**.
- Append-only event/decision/failure trace sufficient to reconstruct intention vs attempted tool action vs actual Minecraft outcome, actual game ticks/TPS, model identity, token counts/cost and human interventions.
- A recorded full **60-minute run** and reproducible experiment manifest. A peaceful run, no encounter or colony failure is valid **data**; it is **not** a game-winning requirement.

### Explicitly NOT in V1
- More than four citizens, automatic leaders, elections, governments, diplomacy bots, scripted factions or wars, territory claims, fixed victory/scoring systems.
- Economy/wallets/currency, paid human construction, complex automated blueprints, full advanced memory redesign, forced personality evolution.
- PIANO rewrite, JEV second model, CoreProtect integration, multi-provider benchmark tournament, custom observer dashboard redesign, custom Minecraft item/modpack or extra infrastructure.
- Training a model, indefinite paid API sessions, open host shell/network access, public production-server connection, modifying existing Windows worlds or merging old PRs.
- Claims that GPT/Claude model quality has been ranked from a single trial.

## Engineering decisions to check BEFORE implementation

1. **Harness is a full cognitive runtime.** Inspect `src/model/session.js`, `src/agent.js`, `src/tools/game/runtime.js`, `src/comms/mailbox-store.js`, `docs/configuration.md` and `docs/multi-agent.md`. Don't add a second controller issuing concurrent body actions. Prefer a tiny extension over a rewrite if its Pi loop and persistence suffice.
2. **Upstream version and patches.** Upstream tests/support are for Minecraft Java/Paper **1.21.6**; our existing repo documents **1.21.11**. Never assume plugin/protocol compatibility. Use a fresh 1.21.6 disposable world and unused ports, not our production **25565/25575** or existing World-Lab **25567/25577**.
3. **Sandbox.** Force `sandbox: none` and `sharedMachine: none` during the baseline. Audit available tools for residual `compute_js` or network/script actions and limit server access appropriately. No host shell fallback. No creative/op privileges, open RCON access or personal files available to the agent.
4. **Real money.** Development-plan coding-agent credits do **not** imply GPT/Claude API inference is free. No live model calls until the operator sets a strict per-provider dollar/token budget and authorizes keys to the isolated process. Never log credentials or publish private state.
5. **No model comparison conclusion.** Two different models and two starting sites introduce confounders. Record seed, positions, roster ordering, traits and models; later repeated counterbalanced trials are separate research.

## Parallel work ownership (first wave)

**One integrator owns cross-module decisions; only one operator owns live Paper processes/world.** These are assignments for developer agents, not claims they have been started.

| Worker | First assignment | Editable surface / constraint | Deliverable |
| --- | --- | --- | --- |
| **Codex — harness execution lead** | Read-only Windows protection inventory first; after confirmed backup, clone pinned upstream in **separate folder**; set up isolated 1.21.6 server and run upstream offline checks. | Owns **new isolated harness environment** and **one disposable world only**. No edits to existing Windows repo/world, no live paid calls without approval. | Commands, package/server versions, hash, smoke logs, pass/fail and blocker. |
| **Claude 1 — architecture reviewer** | Audit YC's runtime, Pi lifecycle, `toolsModule` surface, cancellation/respawn/reconnect, and differences from our current code. | Read-only, no live server. Do not design an unneeded new framework. | One-page **keep/extend/replace** recommendation and exact integration seams. |
| **Claude 2 — citizen independence & communication** | Design smallest per-citizen identity/state interface, neutral objectives and legitimate **local cross-community speech** without directory/DM leaks; write contract-level test cases. | Read-only initially; independent test/document branch only after ownership approval. No modifications to Codex's sandbox. | Minimal schema, sample neutral objective, 5–10 concrete tests. |
| **Grok bots — red team/research** | Independently challenge assumptions; search YC/Olam Labs material or X for harness caveats, measured costs, survival failure modes, version issues and model/API pitfalls. | Read-only. Findings need primary-source links and clear verified/unverified labels. | Top five factual risks with reproduction checks; **no speculative code rewrite**. |
| **Owner / integrator** | Decide gates; review evidence and isolated patches; authorize expenses; merge only reviewed work. | Sole approval authority. | Explicit **PASS / FAIL / BLOCKED** per gate and next smallest fix. |

**Do not start four implementation rewrites at once.** Codex can test isolated upstream while both Claudes inspect independent areas and Grok researches. The first cross-cutting integration only begins after Gate 1 gives a stable physical baseline.

## First-wave acceptance report template

Every worker replies with:

- **Scope:** exact assigned task and repository/branch/commit.
- **Changed files:** none or a full precise list; no misleading claims of integration.
- **Commands and tests:** exact commands; state whether mocked, offline, or **live real Minecraft**.
- **Evidence:** short log excerpts, timestamps and world/server details; physical world/inventory proof where applicable.
- **Security/cost:** sandbox mode, credentials handling, actual model tokens and charged cost if any.
- **Verdict:** PASS / FAIL / BLOCKED, known regressions, next smallest action.

**No completion percentages or "almost ready" claims.** No autonomous merges. No deleting local WIP. Stop on world/process collision or unauthorized API usage.

## Research note

YC/Olam Labs [Agents in Games](https://labs.ycombinator.com/projects/games/) reported a 50-agent survival experiment and identified **cross-team communication / mixed model family composition** as open questions. Those reports motivate this study but are **not evidence our prototype works**. Reuse their MIT source with required attribution and third-party notices.
