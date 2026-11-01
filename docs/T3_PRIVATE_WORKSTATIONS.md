# Private workstation metadata boundary

Base: draft #29, 6f402f79fea6584d7cef57032b867f0ccffe5e2c. Branch: agents/t3-private-workstation-boundaries.

Actual defect: knownCraftingTable/knownChest read settlement_first coordinates and used blockAt as if a block existing proved the citizen knew its location. Every community could inherit legacy or rival workstation metadata. rememberWorkstation/forgetWorkstation also wrote/deleted the same global cache without an actor.

In community mode, reads now use only the caller's owned or explicitly granted physical assets, require current authenticated membership and known dimension, and verify the actual block before returning it. Teammates receive no automatic private metadata. Missing blocks do not permit deleting another citizen's record. Actor-free legacy cache writes/deletes throw before touching originals. Legacy single-settlement behavior remains tested. Natural world discovery through skill findBlock is unchanged; ownership is not inferred from mere visibility, and no new asset-registration shortcut is introduced.

Red replay: 7 failed / 1 passed across eight cases. Green: original eight plus a native SQLite restart/revoke case pass; five legacy workstation tests pass. Positive real manager/startup physical capability replays remain passing (26 focused before the added restart case). Installed Mineflayer 4.39.0 game.js was inspected read-only: its game.dimension strips the minecraft prefix; helpers accept that canonical form and fail closed for unknown/different dimensions.

This is supporting integration, not a complete scoped executor. Protected executor's legacy remember/forget calls lack actor provenance and now refuse in community mode; review must wire authenticated ownership APIs after verified placement. The original executor inventory aggregate reproducer remains red. Direct communal chest permission checks and other global settlement reads require separate review; this package does not claim to fix them.

No guard, Minecraft adapter, executor or provider implementation edits. All fixtures disposable. No server/provider calls, production migrations or merges. Full verification is recorded in the checkpoint and ignored artifacts/campaign/workstations-*.log.

Checkpoint: full workspace 1930 passed / 0 failed / 2 skipped (175 files), typecheck/lint/build/diff check pass. Fourteen focused workstation/legacy/restart tests pass. The full command's Vitest process exit was explicitly captured as 0 to avoid PowerShell's expected-stderr redirection ambiguity. Existing global executor isolation reproducer is still a blocker outside these capability counts.
