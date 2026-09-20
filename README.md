# Minecraft AI Civilization Simulator

**A persistent, multi-agent Minecraft Java simulation exploring how citizens survive, cooperate, and develop a settlement in one shared world.**

![Status: experimental](https://img.shields.io/badge/status-experimental-orange) ![Minecraft Java](https://img.shields.io/badge/Minecraft%20Java-1.21.11-56A86D) ![TypeScript](https://img.shields.io/badge/TypeScript-monorepo-3178C6)

> **Project status:** Experimental local prototype. The repository includes a five-citizen simulation, persistent SQLite state, rule-based survival and task planning, an optional local Ollama decision provider, and an observer dashboard. The goal is emergent civilization; a fully independent, multi-generation society is **not** implemented or demonstrated here.

## The idea

Citizens share a Paper Minecraft world. Each has a physical Mineflayer bot, a persistent identity, a set of bounded actions, and a decision loop. The human observes and supplies tools/infrastructure rather than scripting every citizen's decisions.

```text
                 Paper 1.21.11 world
                        |
               Mineflayer bot bodies
                        |
         skills -> observation -> verification
                        |
          orchestrator + citizen planner
             /                 \
  SQLite identities,       optional Ollama
  events and memory        high-level advice
             \                 /
               observer dashboard
```

### What is in the code today

- **Five-citizen prototype:** orchestrates Atlas, Maya, Theo, Ava, and Kai in the same world.
- **Persistent state:** SQLite stores citizen identities, settlement data, events, memories, relationships, and decision-call logs.
- **Bounded Minecraft actions:** movement, gathering, inventory interactions, and a simple shelter-building workflow, with structured results and failure handling.
- **Decision layers:** deterministic survival and task planning; optional local Ollama deliberation for occasional high-level goals. The simulation can run without an LLM.
- **Observer dashboard:** a local web interface showing citizen status, goals, settlement resources, events, memories, and performance.

These are *implemented components*, not a guarantee that five citizens will always survive, build successfully, or exhibit sophisticated social behavior. See [MVP milestones](docs/MVP.md) for the target behaviors and [architecture](docs/ARCHITECTURE.md) for the design.

### Planned / not yet complete

Citizen-directed selection of new buildings, expanded construction blueprints, human-provided automation, larger settlements, long-term family and generational dynamics, and scaling beyond the initial five-citizen prototype are future work. Do not interpret the architecture document as a list of finished features.

## Tech stack

TypeScript, Node.js 22+, pnpm, Paper 1.21.11, Mineflayer, SQLite (`better-sqlite3`), optional Ollama, and a local HTTP/WebSocket dashboard. Java 21 is required for the Paper server.

## Run locally (Windows)

**Prerequisites:** Minecraft Java Edition **1.21.11**, Java **21**, Node.js **22+**, pnpm, and a local copy of the matching Paper server jar. The Paper jar, Minecraft world, private player data, runtime logs, and local database are intentionally **not** in Git.

1. Follow [server setup](server/README.md). Download the specified Paper build from the official Paper site, save it as `server/paper.jar`, copy the example server properties, and accept the Minecraft EULA yourself. **Keep this offline-auth development server on your own machine; never expose it to the internet.**
2. From the project root, copy `.env.example` to `.env` and review the settings.
3. Install dependencies with `pnpm install`.
4. Start Paper using `server/start.bat`, then run `pnpm sim:start` in another terminal. Optionally, `AUTO_START_PAPER=true` can launch it from the orchestrator when the port is closed.
5. Connect your Minecraft Java client to `127.0.0.1:25565`. View the observer dashboard at `http://127.0.0.1:3000`.

The starter world is **not** distributed. Your settlement layout and outcomes may differ from the author's local world. See [developer notes](docs/DEVELOPER.md).

Optional: Set `LLM_ENABLED=true` and run the local Ollama model specified in `.env` to enable high-level LLM deliberation. Without it, the deterministic planner remains active.

## Developer commands

| Command | Purpose |
| --- | --- |
| `pnpm sim:start` | Run the five-citizen orchestrator and local dashboard |
| `pnpm atlas` | Run one citizen with a CLI |
| `pnpm build` | Compile workspace packages |
| `pnpm typecheck` | Check TypeScript |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run Vitest tests |

## Repository map

- `apps/orchestrator`: simulation loop, local dashboard server, Atlas CLI
- `apps/dashboard`: local observer UI
- `packages/agent-core`: citizen records, SQLite persistence, planner, executor
- `packages/minecraft-adapter` and `packages/skills`: Minecraft bodies and bounded actions
- `packages/cognition`, `packages/memory`, `packages/society`: optional high-level decision-making, memory, social simulation
- `server`: setup instructions and safe example configuration

## Security and attribution

This is a **local research/portfolio prototype**, not a hardened public multiplayer service. Offline Minecraft authentication and the dashboard are intended for **loopback-only** use. Do not forward ports or deploy this setup to a publicly reachable host. Agents do not receive arbitrary shell or filesystem execution.

The project uses Minecraft, Paper, Mineflayer, and optionally Ollama; it is an independent experiment and is not affiliated with Mojang or Microsoft.

**Demo media:** A real gameplay clip or screenshot will be added after it is captured from a local run. No simulated or staged screenshot is presented as a working demo.
