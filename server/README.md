# Paper 1.21.11 — local shared world

This folder is the **one** Minecraft Java server for the civilization. Do not create a separate Minecraft install per agent. Mineflayer bots are protocol clients, not graphical game instances.

The Paper jar, world, logs, cache, and generated runtime files are **not** in git. After cloning, recreate the server from this document.

## Requirements

- **Java:** Temurin OpenJDK **21** LTS (or another Java 21 JDK)
- **Minecraft / Paper:** Paper **1.21.11** build **132**
- **Jar filename (local):** `paper.jar` in this directory
- **Address:** `127.0.0.1:25565`

Download Paper from the official builds page:

https://papermc.io/downloads/paper?version=1.21.11

Save the build **132** jar as:

```
server/paper.jar
```

Stay on 1.21.11 until the project deliberately upgrades. Do not switch this server to Minecraft 26.x.

## Why 127.0.0.1 (not localhost)

On this development machine, connecting the Minecraft Java client to `localhost` produced a network-unreachable error. Use:

```
127.0.0.1:25565
```

for the human client, Mineflayer bots, and all local tooling.

## First-run EULA

Minecraft requires agreeing to the EULA.

1. Start the server once (it will exit after generating files).
2. Open `server/eula.txt`.
3. Set `eula=true` only if you agree: https://aka.ms/MinecraftEULA
4. Start the server again.

A template is in `eula.txt.example`.

## Configuration

Copy the development template if `server.properties` does not exist yet:

```bat
copy server.properties.example server.properties
```

Important local-development settings:

| Setting | Value | Why |
| --- | --- | --- |
| `server-port` | `25565` | Default Java edition port |
| `online-mode` | `false` | Lets Mineflayer bots join with offline usernames |
| `motd` | anything local | Optional |
| `max-players` | at least `20` | Human observer + five MVP citizens |

**Warning:** `online-mode=false` is **only** for this private local development environment. Do not expose the server to the public internet. Anyone who can reach it can join as any username.

The real `server.properties` on this PC is gitignored so machine-generated secrets (for example Paper's management-server secret) are never committed. Do not copy secrets into examples or scripts.

## Start

Windows (this machine):

```bat
cd server
start.bat
```

`start.bat` runs:

```bat
java -Xms4G -Xmx4G -jar paper.jar --nogui
```

`pnpm sim:start` from the repo root will also start Paper if port 25565 is closed and `AUTO_START_PAPER=true`.

## Stop safely

In the Paper console, type:

```
stop
```

Wait until it finishes saving the world. Do not kill the Java process if you can avoid it — that can corrupt region files.

## Human Minecraft client

1. Launch Minecraft **Java Edition** 1.21.11 (not Bedrock).
2. Multiplayer → Direct Connection → `127.0.0.1:25565`
3. You are an observer/debugger, not a citizen.

Useful commands after you op yourself from the Paper console (`op <your-username>`):

```
/gamemode spectator
/tp Atlas
/time query daytime
```

Do not automate Microsoft/Minecraft login. Sign in to the Java launcher yourself.

## Mineflayer bots

Bots connect as offline protocol clients to the same server:

- Host: `127.0.0.1`
- Port: `25565`
- Auth: `offline`
- Usernames: `Atlas`, `Maya`, `Theo`, `Ava`, `Kai`

```bat
pnpm atlas
pnpm sim:start
```

## Recreate after cloning this repository

1. Install Java 21 and Node.js 22+.
2. Clone the repo. The `server/` directory will contain README, `start.bat`, and `*.example` files only — no jar and no world.
3. Download Paper 1.21.11 build 132 and save it as `server/paper.jar`.
4. Copy `server.properties.example` → `server.properties`.
5. Run `start.bat` once, accept the EULA in `eula.txt`, run `start.bat` again.
6. From the repo root: `copy .env.example .env` then `pnpm install`.
7. Connect the Java client to `127.0.0.1:25565`.
8. Run `pnpm sim:start`.

Your existing local world on this development PC is intentionally not in git. Do not delete `server/world/` on a machine that already has a world you care about.
