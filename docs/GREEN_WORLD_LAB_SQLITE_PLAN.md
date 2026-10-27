# GREEN — WORLD-LAB SQLite initialization plan (not executed)

Date: 2026-09-20  
Status: **INITIALIZED 2026-09-20.** User approved creating only `./data/world-lab-civilization.sqlite`. The file was created empty via `CivilizationStore`. `data/civilization.sqlite` was not opened for writes. `pnpm sim:start` was not started. Homes remain unclaimed. Communal storage was left unset.

RED confirmed `data/civilization.sqlite` is **live-civ** data (roster `home_id` NULL, last positions ~220–250, 72, 160s, last written 2026-09-17). That file is the wrong world and the wrong identity store for WORLD-LAB Site C. It must not be reused, copied, or migrated into a lab database.

## Proposed path (existing env var, new file)

Reuse `DATABASE_PATH`. Do **not** add a new env var.

| Role | Path | Action until user approves |
| --- | --- | --- |
| Live civilization (do not touch) | `./data/civilization.sqlite` | Leave as-is. Default in `.env.example` stays this path. |
| Proposed WORLD-LAB identity store | `./data/world-lab-civilization.sqlite` | **Do not create** until the user approves this plan verbatim. |

After approval, a one-citizen WORLD-LAB run would set:

```
DATABASE_PATH=./data/world-lab-civilization.sqlite
```

and leave live-civ on `./data/civilization.sqlite`.

## Non-destructive initialization (after approval only)

1. Create an **empty** file at `./data/world-lab-civilization.sqlite` by constructing `CivilizationStore` against that new path. Schema (including `homes` / `home_memberships`) is created by the store. `DEFAULT_CITIZENS` are `INSERT OR IGNORE` as offline rows with **no** `home_id` and **no** last positions from live-civ.
2. Do **not** copy, attach, dump, or migrate `data/civilization.sqlite`.
3. Do **not** copy live-civ `last_x/y/z`, `settlement.storage` (`244,74,164`), or any live-civ events/memories.
4. Leave `settlement.storage` **unset** until a later explicit step points it at the tannery communal chest **`-1038,65,839`**. Walking a pond/mine fixture must never set this (fixture denylist).
5. Leave all home claims empty. Do **not** pre-assign H1 (or any house) to Kai, Atlas, or a harness identity.
6. Do **not** reset WORLD-LAB Paper, chests, or playerdata as part of sqlite init.

## What this plan does not authorize

- Opening live-civ sqlite as the WORLD-LAB store
- `sim:reset-dev` against live-civ or WORLD-LAB
- Copying HomeProbe’s temp `homes.sqlite` into either file
- Launching the one-citizen integration run
- `pnpm sim:start`

Wait for an explicit user sentence approving this path and the empty-file init before creating `data/world-lab-civilization.sqlite`.
