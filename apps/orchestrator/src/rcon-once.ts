/**
 * One-shot Paper RCON CLI for local MechProbe / world inspection.
 *
 *   pnpm --filter @civ/orchestrator rcon "list"
 *   pnpm --filter @civ/orchestrator rcon "data get entity MechProbe SelectedItem"
 *
 * Connects to 127.0.0.1:25575 with the mechanics password. Not a citizen tool.
 */
import { RconClient } from "./rcon.js";

const cmds = process.argv.slice(2);
if (cmds.length === 0) {
  console.error('usage: pnpm --filter @civ/orchestrator rcon "<command>"...');
  process.exit(1);
}

const r = await RconClient.connect("127.0.0.1", 25575, "civ-mechanics-rcon");
for (const command of cmds) {
  const out = await r.command(command);
  console.log(`> ${command}`);
  if (out.trim()) console.log(out.slice(0, 800));
}
r.close();
