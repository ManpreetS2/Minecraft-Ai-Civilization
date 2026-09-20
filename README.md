# Minecraft AI Civilization

**A persistent, multi-agent society experiment inside Minecraft.**

What happens when five AI citizens share a world, remember their experiences, and make their own choices? This project explores that question through a real Minecraft server, persistent agent state, bounded game actions, and observable outcomes—not scripted stories presented as emergent behavior.

![Status: experimental](https://img.shields.io/badge/status-experimental-orange) ![Minecraft Java](https://img.shields.io/badge/Minecraft_Java-1.21.11-56A86D) ![TypeScript](https://img.shields.io/badge/TypeScript-monorepo-3178C6)

> **Current status:** An experimental five-citizen prototype is available in this repository. The independent, citizen-led society described below is the **research direction**, not a claim that autonomous civilization, long-term households, or an economy already work. Live behavior depends on the local Paper world and must be verified in-game.

## The experiment

**Option A — a small starter village in a spacious, mostly vanilla world.** The human supplies an accessible settlement with homes, beds, a modest farm, shared storage, real starting resources, and room to expand. Five persistent citizens—**Atlas, Maya, Theo, Ava, and Kai**—then interact within it.

The starting village is explicitly **human-provided**. It is not credited to the AI. Citizens should eventually choose their own activities, relationships, living arrangements, and future building projects rather than receive preset jobs, leadership, or social outcomes.

| Experimental principle | What it means |
| --- | --- |
| Individual agency | Each citizen forms intentions from its own needs, observations, memories, and interactions. A shared shortage is information, not an order from a central AI. |
| Physical accountability | Items, buildings, farming, and mining count only when verified in the Minecraft world or inventories. Generated narration is not proof of success. |
| Limited knowledge | Citizens should not know hidden ores, unopened chest contents, or another citizen's private state without actually observing or learning about them. |
| Human as contractor | Citizens may propose a building, choose a site, and accept or reject a quote. The human may install an approved vanilla-block structure, but this must be logged as human construction. |
| Measurable experiments | Record the initial world, provided supplies, interventions, failures, and observed interactions. Avoid scripting an outcome and calling it emergent. |

### World and construction direction

- Start with a reproducible, survival-friendly plains/valley area near a forest, river, and accessible natural resources. Keep paths, doors, beds, and storage usable by the bot bodies.
- Provide three simple starter houses with at least five reachable beds, a small farm, shared crafting/storage, and open plots. Record the seed, gamerules, inventories, and all human-provided structures.
- Later, let citizens **request** a house, farm, warehouse, or automation service. A construction contract should record its cost, accepted terms, owner, physical placement, and verified completion.
- Allow optional human-installed, vanilla-mechanics automation only with real inputs and measurable real output. A hopper farm must not create imaginary resources or be reported as independent AI labor.

**The contractor catalog, citizen-chosen construction, economic settlement, and automation workflows are planned—not delivered features of this public prototype.**

## Architecture

The core distinction is **what a citizen chooses** versus **how a Minecraft body executes it**.

```text
              Paper 1.21.11 — shared Minecraft world
                             │ observations
                             ▼
                    Citizen state / goals
                       │             ▲
           high-level intention   verified result
                       ▼             │
              Planner + bounded skills
                             │
                      Mineflayer body
                             │
                     Real world action
                             │
                  Inventory / block checks

     SQLite: identities · settlement · memories · events
     Optional Ollama: high-level decision support
     Local dashboard: state · actions · events · performance
```

Routine movement and interaction should use deterministic skills rather than spending an LLM call on every block. The longer-term design is for each citizen's persistent identity and experience to inform its own decisions; the model is a temporary reasoning tool, not the citizen's memory or an omniscient manager.

**Current implementation boundary:** The checked-in code has deterministic survival/task planning and shared settlement needs, plus optional local Ollama deliberation. Fully independent citizen-owned choices, reliable physical autonomy, and richer social memory remain development goals.

## What is implemented vs. planned

| In this repository | Target / not yet established |
| --- | --- |
| TypeScript/pnpm workspace, five-citizen orchestrator, single-citizen CLI | A verified, independently deciding five-citizen society across a multi-day live run |
| Paper/Mineflayer integration, bounded action and planning modules | Reliable end-to-end doors, own-home navigation, sleeping, mining, farming, and coordinated resource transfers |
| SQLite records for citizens, settlement state, events, memories, and relationships | Citizen-selected households, permissions-aware personal storage, changing beliefs, and lasting social institutions |
| Optional Ollama decision provider and local observer dashboard | Citizen-requested human construction, physical automation, market contracts, and multi-settlement economy |

These are code-level capabilities and targets; they do **not** imply that every action succeeds in a real world. A successful unit test is not a live Minecraft acceptance test. Local experimental work described in the design plan may be ahead of the public branch.

## Next milestone

1. **Set up a reproducible starter world.** Record terrain, starting buildings/resources, server rules, and human interventions.
2. **Validate one physical bot.** Test traversable doors, safe path recovery, known/unknown storage interactions, actual item pickup, eating, sleeping, and honest failure reporting.
3. **Run five citizens together.** Observe at least three Minecraft days without repeated human rescue. Capture real inventory/world changes, conversations and recipients, decisions, failures, model latency, and server performance.
4. **Document an actual social interaction.** A request, response, cooperation, disagreement, or verified resource transfer counts; invented dialogue does not.
5. **Expand in controlled stages.** Only after the baseline works, test one citizen-requested building and one physically producing automated farm. A separate wilderness-from-zero experiment comes later.

**Long-term research:** Individual households, contracts, trade, culture, institutions, migration, and multiple communities in the same world. The proposed ceiling is **100 persistent living citizens**, using selective physical simulation rather than 100 continuously running LLMs. This is an architectural target, **not current capacity**.

## Run locally

**Requirements:** Minecraft Java Edition **1.21.11**, Java **21**, Node.js **22+**, pnpm, and the matching Paper server jar. The Paper jar, author's world, local database, logs, and credentials are not included.

1. Follow the [local Paper setup instructions](server/README.md), place the matching jar at `server/paper.jar`, copy the example server configuration, and accept the Minecraft EULA yourself.
2. Copy `.env.example` to `.env` and review the settings.
3. Run `pnpm install`.
4. Start Paper with `server/start.bat`, then run `pnpm sim:start` in another terminal. The documented auto-start option is also available.
5. Connect the Minecraft Java client to `127.0.0.1:25565`; open the observer at `http://127.0.0.1:3000`.

Set up a compatible local Ollama model and enable `LLM_ENABLED=true` if you want optional model deliberation. The included deterministic/heuristic path can run without it.

**Security:** The example server uses offline authentication for local bot testing. Keep the Minecraft server and dashboard **loopback-only**; do not port-forward or expose either to the internet.

| Command | Purpose |
| --- | --- |
| `pnpm sim:start` | Run the local prototype and dashboard |
| `pnpm atlas` | Run the single-citizen CLI |
| `pnpm build` / `pnpm typecheck` | Compile / check TypeScript |
| `pnpm lint` / `pnpm test` | Lint / run automated tests |

### Codebase

- [`apps/orchestrator`](apps/orchestrator) — simulation loop, local dashboard server, single-citizen CLI.
- [`apps/dashboard`](apps/dashboard) — local observer UI.
- [`packages/agent-core`](packages/agent-core) — citizen records, SQLite, planning, and execution.
- [`packages/minecraft-adapter`](packages/minecraft-adapter) and [`packages/skills`](packages/skills) — bot bodies, navigation, bounded Minecraft actions.
- [`packages/cognition`](packages/cognition), [`packages/memory`](packages/memory), [`packages/society`](packages/society) — cognition, memory, and social modules.

See [architecture](docs/ARCHITECTURE.md), [original MVP notes](docs/MVP.md), and [developer setup](docs/DEVELOPER.md). The updated **Option A** research direction above supersedes any older implied milestone order in those documents.

## Demo and research evidence

**Gameplay footage and an experiment log are still to be added.** Only real captures from the running Minecraft environment should be presented as evidence. Concept art and starter-village layouts are design illustrations—not screenshots of AI-built structures.

When documenting a run, distinguish citizen intention from completed action, human-installed infrastructure from AI work, and observed results from unverified model claims.

## Credits

Independent research/portfolio project; not affiliated with Mojang or Microsoft. Built with or informed by [Paper](https://papermc.io/), [Mineflayer / PrismarineJS](https://github.com/PrismarineJS/mineflayer), [Ollama](https://ollama.com/), [Generative Agents](https://github.com/joonspk-research/generative_agents), and [Project Sid](https://arxiv.org/abs/2411.00114). External research findings are not presented as results of this simulation.
