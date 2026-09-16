# Minecraft AI Civilization

Autonomous artificial civilization inside one shared Minecraft Java world.

Minecraft bodies, citizen identities, and cognition are separate. A disconnected bot is not a dead citizen.

## Current local environment

- Paper **1.21.11** build 132 (`server/paper.jar`)
- Connect the human client to **`127.0.0.1:25565`** (avoid `localhost` on this machine)
- `online-mode=false` so Mineflayer development bots can use offline usernames
- Stay on 1.21.11 until we deliberately upgrade

## Quick start

1. Start Paper if it is not already running:

```bat
cd server
start.bat
```

2. Copy environment defaults:

```bat
copy .env.example .env
```

3. Install and run:

```bat
pnpm install
pnpm atlas
```

Atlas developer CLI (one physical citizen, no AI):

```
help
state
players
inventory
say <message>
goto <x> <y> <z>
follow <name>
stop
nearby
quit
```

First Settlement simulation (five citizens + dashboard):

```bat
pnpm sim:start
```

Then open:

- Minecraft: `127.0.0.1:25565`
- Dashboard: `http://127.0.0.1:3000`

Human observer commands (in Minecraft):

```
/gamemode spectator
/tp Atlas
```

See [docs/DEVELOPER.md](docs/DEVELOPER.md).

## Workspace commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run orchestrator in watch mode |
| `pnpm atlas` | Single-citizen Atlas CLI |
| `pnpm sim:start` | Five-citizen simulation + dashboard |
| `pnpm build` | Compile all packages |
| `pnpm typecheck` | TypeScript no-emit check |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest |

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/MVP.md](docs/MVP.md).

## Safety

Simulation agents act only through bounded Minecraft skills. They do not get shell, filesystem, or arbitrary code execution.
