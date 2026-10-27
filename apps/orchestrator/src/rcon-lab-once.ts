import { RconClient } from "./rcon.js";

const host = process.env.HOME_TEST_HOST ?? "127.0.0.1";
const port = Number(process.env.HOME_TEST_RCON_PORT ?? "25577");
const password = process.env.HOME_TEST_RCON_PASSWORD ?? "civ-world-lab-rcon";
const cmds = process.argv.slice(2);
if (cmds.length === 0) {
  console.error("usage: tsx src/rcon-lab-once.ts <command>...");
  process.exit(1);
}
const r = await RconClient.connect(host, port, password, 6000);
for (const command of cmds) {
  const out = await r.command(command, 8000);
  console.log(`> ${command}`);
  console.log(out.trim() || "(empty)");
}
r.close();
