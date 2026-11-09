// Child process: REAL mineflayer@4.39.0 lib/plugins/digging.js driven under the PRODUCTION action boundary/guard.
// Everything except the digging plugin is a stub bot (no network, no server). Prints a JSON line and exits.
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createActionBoundary } from "../../../packages/agent-core/src/action-boundary.js";
import { fail } from "../../../packages/shared/src/index.js";

const req = createRequire(join(process.cwd(), "packages/minecraft-adapter/package.json"));
const inject = req("mineflayer/lib/plugins/digging.js") as (bot: unknown) => void;
const { Vec3 } = req("vec3") as { Vec3: new (x: number, y: number, z: number) => unknown };
const mode = process.argv[2] ?? "abandon-no-stop"; // abandon-no-stop | abandon-with-stop
const wire: string[] = [];
const client = { write(name: string) { wire.push(name); } };
const bot: any = new EventEmitter();
Object.assign(bot, {
  entity: { position: new (Vec3 as any)(0, 64, 0), eyeHeight: 1.62, onGround: true }, _client: client, _updateBlockState() {}, blockAt: () => null,
  heldItem: null, game: { gameMode: "survival" }, getEquipmentDestSlot: () => 5, inventory: { slots: [] }, lookAt: async () => undefined,
  // mirrors mineflayer's swingArm, which writes arm_animation through bot._client
  swingArm() { bot._client.write("arm_animation", { hand: 0 }); },
});
inject(bot);
bot.digTime = () => 5_000;
const block = { position: new (Vec3 as any)(1, 64, 0), diggable: true };
const boundary = createActionBoundary(() => client);
const abort = new AbortController();
const run = boundary.run("dig", async (signal) => {
  const dig = bot.dig(block, "ignore"); dig.catch(() => undefined);
  await new Promise((r) => signal.addEventListener("abort", r, { once: true }));
  if (mode === "abandon-with-stop") bot.stopDigging();
  return fail("CANCELLED", "cancelled", 1, false);
}, { signal: abort.signal, timeoutMs: 10_000, graceMs: 50 });
setTimeout(() => abort.abort(), 60);
await run;
await new Promise((r) => setTimeout(r, 900)); // mineflayer's 350 ms swing interval fires twice if the dig is still live
console.log(JSON.stringify({ survived: true, wire }));
process.exit(0);
