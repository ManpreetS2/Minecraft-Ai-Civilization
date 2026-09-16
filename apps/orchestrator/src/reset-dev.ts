import { loadEnv } from "./env.js";
import { loadConfig, resolveFromRoot } from "@civ/shared";
import { parseResetArgs, resetDevelopmentState } from "@civ/agent-core";

function usage(): void {
  console.log(`Development reset

Deletes the local simulation database used for development.

  pnpm sim:reset-dev -- --yes
      Reset development SQLite (citizens, events, memories, settlement).
      Does NOT delete the Minecraft world.

  pnpm sim:reset-dev -- --yes --world
      ALSO delete the Paper world directory. Destructive. Explicit flag required.

This command never runs unless --yes is present.
`);
}

function main(): void {
  const flags = parseResetArgs(process.argv.slice(2));
  if (process.argv.includes("--help") || process.argv.includes("-h") || !flags.yes) {
    usage();
    if (!flags.yes) {
      console.error("Refusing to reset without --yes.");
      process.exitCode = 1;
    }
    return;
  }
  loadEnv();
  const config = loadConfig();
  const result = resetDevelopmentState({
    yes: flags.yes,
    world: flags.world,
    dbPath: resolveFromRoot(config.DATABASE_PATH),
    worldDir: resolveFromRoot("server/world"),
  });
  console.log(result.message);
  for (const path of result.deleted) {
    console.log(`  deleted ${path}`);
  }
  if (!result.ok) process.exitCode = 1;
}

main();
