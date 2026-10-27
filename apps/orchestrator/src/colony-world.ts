import { COLONY_WORLD_POLICY, hostilePurgeCommands } from "@civ/shared";
import type { RconClient } from "./rcon.js";

export async function enableColonyMode(
  rcon: RconClient,
  options: { purgeHostiles?: boolean } = {},
): Promise<{ difficulty: string; purged: boolean }> {
  const difficultyText = await rcon.command("difficulty");
  if (/peaceful/i.test(difficultyText)) {
    await rcon.command(`difficulty ${COLONY_WORLD_POLICY.difficulty}`);
  }
  // Animals/villagers must still spawn. Mechanics tests may have left this false.
  await rcon.command("gamerule doMobSpawning true");
  const purge = options.purgeHostiles !== false && COLONY_WORLD_POLICY.purgeExistingHostilesOnce;
  if (purge) {
    for (const command of hostilePurgeCommands()) {
      await rcon.command(command).catch(() => undefined);
    }
  }
  return { difficulty: difficultyText, purged: purge };
}
