# Local developer notes

## Connect

Use **`127.0.0.1:25565`**. On this machine `localhost` has produced a network-unreachable error.

The Paper server is configured with `online-mode=false` so Mineflayer bots can join with offline usernames. This world is private/local only.

## Start Paper

```bat
cd server
start.bat
```

`pnpm sim:start` will start Paper itself when port 25565 is closed and `AUTO_START_PAPER=true`.

Do not upgrade this server to Minecraft 26.x until we choose to.

## Human observer

You are not a citizen. The simulation should not treat your account as population.

Useful commands after joining:

```
/gamemode spectator
/gamemode survival
/tp Atlas
/tp Maya
/time query daytime
/weather clear
```

Op yourself from the Paper console if needed:

```
op <your-username>
```

Known human username from this world's usercache: `Shadowskiii1`.

## Atlas CLI

```bat
pnpm atlas
```

Commands: `help`, `state`, `players`, `inventory`, `say`, `goto`, `follow`, `stop`, `nearby`, `quit`.

## Simulation

```bat
pnpm sim:start
```

Expected console:

```
Simulation ready
Minecraft server: 127.0.0.1:25565
Dashboard: http://127.0.0.1:3000
```

## Spawn protection

Vanilla spawn protection (16 blocks) blocks non-ops from placing/breaking near world spawn. The settlement planner prefers a site outside that radius. If building still fails, from the Paper console:

```
op Atlas
op Maya
op Theo
op Ava
op Kai
```

or set `spawn-protection=0` in `server/server.properties` and restart Paper.

## Paper RCON (one-shot)

```
pnpm --filter @civ/orchestrator rcon "list"
pnpm --filter @civ/orchestrator rcon "time query daytime"
```

Uses `127.0.0.1:25575` and the mechanics RCON password. This is a developer CLI, not a citizen skill.

## LLM

Cognition is optional. Intended local routine model: `qwen3.5:9b` via `OLLAMA_ROUTINE_MODEL`. `qwen3.5:4b` remains a faster bring-up option. Deep reflection (`OLLAMA_REFLECTION_MODEL=gpt-oss:20b`) is off unless `OLLAMA_REFLECTION_ENABLED=true` and the model is actually available.

Set `LLM_ENABLED=true` (or `OLLAMA_ENABLED=true`) in `.env` for occasional high-level decisions. The deterministic planner still runs if the model is down. See [COGNITION.md](./COGNITION.md).
