# Minecraft AI Civilization

**A research-focused multi-agent simulation exploring autonomous societies inside Minecraft.**

![Status](https://img.shields.io/badge/status-active_development-2563EB)
![Minecraft](https://img.shields.io/badge/Minecraft_Java-1.21.11-56A86D)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6)
![SQLite](https://img.shields.io/badge/SQLite-003B57)

What happens when persistent AI agents share a world, remember their experiences, and make decisions independently?

Minecraft AI Civilization is an experimental system for studying that question inside a shared Minecraft world. The project combines AI decision-making, persistent agent state, real game interaction, and observable social behavior.

The goal is not to script a village full of bots. It is to build the infrastructure through which individual citizens can survive, communicate, cooperate, disagree, and eventually develop a society through their own interactions.

> **Current status:** Individual Minecraft agent capabilities have passed isolated live tests, including farming, home navigation, personal storage, and bounded mining. The complete five-citizen autonomous simulation is still under integration and reliability testing. Recent local development is ahead of the code published in this repository.

## Overview

The first experiment centers on five persistent citizens:

**Atlas · Maya · Theo · Ava · Kai**

They share one Minecraft world and begin in a small, functional starter settlement. The initial houses, farm, and basic supplies are provided by the experimenter so that the first study can focus on physical reliability, independent decisions, and social interaction.

The citizens are intended to develop their own goals and relationships rather than begin with assigned occupations, predetermined friendships, or a scripted social structure.

The project is guided by four engineering principles:

| Principle | Approach |
| --- | --- |
| Individual autonomy | Each citizen should choose what to do using its own needs, observations, memories, and experiences. |
| Persistent identity | A citizen's identity and history remain separate from its temporary Minecraft connection or model inference session. |
| Physical grounding | Actions are executed through Minecraft and checked against actual world and inventory state. |
| Observable results | Experiments distinguish what an agent intended, what physically occurred, and what the human supplied or changed. |

The long-term research question is whether increasingly complex cooperation, specialization, relationships, economies, and institutions can emerge from these individual interactions.

## Architecture

The system separates **citizen decision-making** from **physical Minecraft execution**.

```text
                  SHARED MINECRAFT WORLD
                       Paper Server
                             │
                       Observations
                             ▼
                      CITIZEN STATE
                  Identity · Needs · Memory
                             │
                     High-level intention
                             ▼
                      TASK PLANNING
                    Bounded skill selection
                             │
                             ▼
                      MINEFLAYER BODY
                 Navigation · Item interaction
                    Gathering · Crafting
                             │
                             ▼
                     RESULT VERIFICATION
                  World state · Inventory
                             │
                             ▼
                    PERSISTENCE & EVENTS
                       SQLite · Logs

                 Local Observer Dashboard
```

### Independent citizens

The target architecture gives each citizen its own persistent state, limited knowledge, and decision-making context.

A citizen decides **what** it wants to accomplish and **why**. The physical execution layer determines **how** to carry out that intention using bounded Minecraft skills.

The current public prototype includes deterministic task planning and optional LLM-assisted decisions. Fully independent, citizen-owned goal selection across the complete five-agent simulation is still being integrated.

### Physical execution

Mineflayer connects active agents to the same Minecraft server. A deterministic skill layer handles movement, navigation, gathering, crafting, inventory interaction, and other game actions.

This separation avoids relying on language-model inference for every movement or block interaction.

Actions follow a verification-oriented workflow:

```text
Intention → Plan → Execute → Observe → Verify
                                      │
                           Success or recovery
```

An action is not considered successful simply because a model reports that it succeeded. The system must inspect the relevant Minecraft state, such as the block changed, item collected, or inventory updated.

### Persistent state and cognition

SQLite provides persistence for citizen identities, settlement records, events, memories, and relationships in the public prototype.

The longer-term cognition architecture will use each citizen's own observations and retrieved memories to support high-level choices. Routine physical tasks can continue through deterministic execution without a continuously running language model for every citizen.

The intended separation is:

**World truth ≠ citizen observation ≠ citizen belief.**

A citizen should not know the contents of an unopened chest or the location of hidden ore merely because that information exists on the server.

## Development progress

Development is currently focused on making individual Minecraft skills reliable before integrating them into a stable, independently acting group.

### Local live-test milestones

The following results are documented in the project's **September 19, 2026 local development checkpoint**. They were obtained in separate, controlled tests—not in a completed five-citizen civilization run.

| Capability | Documented result |
| --- | --- |
| Farming and food handling | A single bot planted, grew, harvested, and replanted a nine-cell wheat plot, collected eight wheat, and completed bread crafting, storage transfer, and eating. Crop growth was accelerated during this test; normal tick speed was restored afterward. |
| Home navigation and storage | A single bot traveled to its assigned home, passed through an already-open door, used its designated bed and personal chest, and retained its home claim after reconnecting. Access to another home's chest was denied, and a missing bed produced an explicit failure. |
| Natural-ore mining | A single bot observed and mined one naturally generated exposed coal ore, picked up the coal, and deposited it in an approved chest. The test used a provided wooden pickaxe; no ore or coal was artificially created for the result. |

These tests demonstrate specific physical capabilities. They do **not** establish autonomous job selection, general cave exploration, reliable navigation across all terrain, or coordinated five-citizen survival.

**Public repository note:** The latest local farming, home, mining, and fishing implementations are not all present in the current public branch. The table above reports local development results, not functionality guaranteed by a fresh clone of this repository.

### In progress

| Area | Current development focus |
| --- | --- |
| Navigation | Reliable one-block jumping, closed-door interaction, safe hazard avoidance, and recovery from blocked or unsafe routes. |
| Daily routines | Time-aware return from work to a citizen's own home and bed. |
| Resource skills | Integrating farming and mining with citizen decisions; live-testing fishing and related item handling. |
| Multi-agent execution | Running separate physical bodies concurrently with distinct identities, possessions, and goals. |
| Social behavior | Connecting individual intentions, memory, communication, and verified interactions without scripting the outcome. |

Fishing, several movement-recovery behaviors, and return-home routines have local implementations or unit tests but do not yet have complete live-test evidence. In particular, the documented one-block landing and lava-detour tests exposed failures that still require correction.

### Next milestone

The immediate objective is a reproducible **five-citizen survival and social experiment lasting at least three Minecraft days** without repeated human rescue.

Before that run, the project must establish safe physical execution, reliable return-home behavior, and concurrent interaction between distinct citizens.

The first experiment will record actual world and inventory changes, citizen communication, failures, intervention history, persistence, and performance. Successful social behavior must be observed—not manufactured for a demonstration.

## Technology

| Technology | Purpose |
| --- | --- |
| TypeScript / Node.js | Agent orchestration, simulation logic, and skill integration |
| Minecraft Java / Paper | Shared simulation environment |
| Mineflayer | Physical Minecraft agent interface |
| SQLite / better-sqlite3 | Persistent citizen and simulation state |
| Ollama | Optional local high-level model inference |
| Zod | Structured data validation |
| HTTP / WebSockets | Local observer dashboard and live updates |
| Vitest | Automated testing |
| pnpm | Monorepo and dependency management |

The project follows a local-first development approach. Minecraft execution, persistence, and optional inference can run on the development machine without maintaining a separate graphical Minecraft client or model instance for every citizen.

## Getting started

The public repository contains the experimental simulation foundation. It does not include the author's local world, test fixtures, runtime database, Paper server JAR, or unmerged local development work.

**Requirements:** Minecraft Java Edition 1.21.11, Java 21, Node.js 22+, pnpm, and a matching Paper server build. Ollama is optional.

```bash
git clone https://github.com/ManpreetS2/minecraft-ai-civilization.git
cd minecraft-ai-civilization
pnpm install
```

Follow the [Paper server setup guide](server/README.md) to configure the local server and accept the Minecraft EULA.

Copy `.env.example` to `.env`, review the configuration, and start the Paper server. Then run:

```bash
pnpm sim:start
```

Connect to Minecraft at `127.0.0.1:25565` and open the observer dashboard at `http://127.0.0.1:3000`.

The repository also provides a single-citizen developer CLI:

```bash
pnpm atlas
```

For development checks, use `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

**Security:** The example server uses offline authentication for local bot development. Keep the Minecraft server and observer dashboard restricted to your own machine. Do not expose this development configuration to the public internet.

## Future development plan

**The systems below are research and implementation goals, not features demonstrated by the current public repository.** Each stage depends on verifying the previous stage in the actual Minecraft world.

| Stage | Planned milestone |
| --- | --- |
| **1 — First settlement** | Stabilize five independent citizens in the shared starter village; verify everyday survival skills, persistent identities, truthful communication, and a multi-day social baseline. |
| **2 — Personal lives** | Let citizens choose their own homes and housemates, use their own beds and storage, remember significant events, form relationships, develop preferences, and change their goals through experience. |
| **3 — Building and livelihoods** | Let citizens propose new homes, farms, and infrastructure. They may build physically or commission optional human-installed structures; ownership, cost, real materials, and the human's contribution are recorded separately. |
| **4 — Economy and institutions** | Explore finite resource production, ownership, barter and negotiated prices, voluntary work contracts, and an authoritative ledger. Later, communities may form treasuries or their own decision-making institutions rather than receiving a predefined government or economy. |
| **5 — Multiple settlements and history** | Allow citizens to migrate, trade, cooperate, disagree, and transmit stories, customs, and institutional history across distinct communities in the same world. |
| **6 — Scaling** | Progress from a proven five-citizen run to 10–25, then 25–50, and eventually **up to 100 persistent living citizens**, with the number of simultaneously physical bots governed by measured performance. |

### Long-term research direction

**Citizen minds.** Each citizen should retain a distinct identity, selective memories, limited perceptions, evolving relationships, learned behavior, personal commitments, and its own interpretation of events. The LLM supports meaningful high-level choices; deterministic skills carry out physical actions. A citizen's memory should survive reconnection or replacement of the model serving an inference request.

**A society that is not pre-scripted.** Occupations, household arrangements, cooperation, disagreements, social norms, markets, leadership, and cultural practices should develop from individual choices and shared experiences. The simulation should not assign a compulsory farmer, leader, religion, or institutional outcome to make the story appear more advanced.

**A physical economy.** Buildings, farms, mining operations, item transfers, automation, and paid work must correspond to real Minecraft materials, items, or verified changes. The human may supply optional construction or automation as a recorded contractor, but human-installed infrastructure must never be presented as AI-built labor. Any future currency or contract system must prevent duplicated payments and imaginary resources.

**Persistent history.** The long-term design includes adult households, migration, deaths, changing relationships, and history carried forward by surviving citizens and records. New citizens would arrive as adults; reproduction and childhood simulation are outside the planned scope. A confirmed citizen death would be distinct from a disconnect, with development-time death behavior configured and documented separately.

**Scaling without 100 simultaneous LLMs.** The proposed ceiling is **100 living persistent citizens** across one shared world. The research plan is to keep identities and history persistent while eventually using a smaller set of fully physical Minecraft bodies for relevant nearby activity and lower-detail simulation where appropriate. Any simulated activity must be distinguished from actions physically performed in Minecraft. This is a scaling objective, **not current demonstrated capacity**.

A separate wilderness-from-zero study may follow the controlled starter-village experiment. It will not be presented as equivalent to the first run, where the experimenter supplied initial shelter and resources.

## Demo

*Gameplay footage and a documented five-citizen experiment will be added after the current integration milestone.*

Only real Minecraft captures and verified experiment results will be presented as demonstrations. Human-provided structures and resources will be identified separately from agent-executed work.

## References and attribution

This is an independent research and portfolio project, not affiliated with Mojang or Microsoft.

The system uses or draws on the following technologies and research:

- [Mineflayer / PrismarineJS](https://github.com/PrismarineJS/mineflayer) — Minecraft bot interfaces and supporting libraries.
- [PaperMC](https://papermc.io/) — Minecraft server infrastructure.
- [Ollama](https://ollama.com/) — Local model inference.
- [Generative Agents](https://github.com/joonspk-research/generative_agents) — Memory, reflection, and planning research.
- [Project Sid](https://arxiv.org/abs/2411.00114) — Research into large-scale agent-based social simulation.
- [Mindcraft](https://github.com/mindcraft-bots/mindcraft) — Studied as a Minecraft agent implementation reference; not presented as the source of this project's farming or mining implementations.

Referenced research findings are not claimed as results of this simulation.
