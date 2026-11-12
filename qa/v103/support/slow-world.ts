/* eslint-disable @typescript-eslint/no-explicit-any -- Independent fake-body QA fixture. */
// Controlled slow furnace and chest windows. Every operation writes a real packet name so the production guard can refuse it.
import { sleep, type OfflineBot } from "./offline-body.js";

export interface Op { kind: string; startedAt: number; doneAt?: number }

export class SlowFurnace {
  readonly ops: Op[] = [];
  input = 0; fuel = 0; out = 0; private readonly t0 = Date.now();
  constructor(private readonly bot: OfflineBot, private readonly producesAfterMs: number, private readonly d = { put: 30, take: 80, tail: 10 }) {}
  private async op(kind: string, ms: number, apply: () => void) {
    const o: Op = { kind, startedAt: Date.now() }; this.ops.push(o);
    this.bot._client.write("window_click", { kind });
    await sleep(ms); apply(); o.doneAt = Date.now();
    this.bot.mutations.push({ kind: `furnace.${kind}`, at: o.startedAt });
  }
  fuelItem() { return this.fuel ? { name: "coal", count: this.fuel, type: 3 } : null; }
  inputItem() { return this.input ? { name: "raw_iron", count: this.input, type: 1 } : null; }
  outputItem() { return this.out || (Date.now() - this.t0 >= this.producesAfterMs && this.input) ? { name: "iron_ingot", count: 1, type: 2 } : null; }
  putInput() { return this.op("putInput", this.d.put, () => { this.input = 1; }); }
  putFuel() { return this.op("putFuel", this.d.put, () => { this.fuel = 1; }); }
  takeOutput() { return this.op("takeOutput", this.d.take, () => { this.input = 0; this.out = 0; this.bot.give("iron_ingot", 1); }); }
  takeInput() { return this.op("takeInput", this.d.tail, () => { if (this.input) { this.input = 0; this.bot.give("raw_iron", 1); } }); }
  takeFuel() { return this.op("takeFuel", this.d.tail, () => { if (this.fuel) { this.fuel = 0; this.bot.give("coal", 1); } }); }
  close() { /* not a mutation */ }
}

export interface ChestOpts { item: string; type: number; withdrawMs?: number; depositMs?: number; lagMs?: number; stock?: number }
/** A chest whose withdraw/deposit take time; `lagMs` delays the citizen-inventory side of the transfer (server slot sync lag). */
export function installSlowChest(bot: OfflineBot, o: ChestOpts) {
  const st = { stock: o.stock ?? 4, windowClicks: [] as number[] };
  (bot as any).openContainer = async () => ({
    containerItems: () => (st.stock > 0 ? [{ name: o.item, count: st.stock, type: o.type }] : []),
    withdraw: async (_t: number, _m: null, count: number) => {
      bot._client.write("window_click"); st.windowClicks.push(Date.now());
      await sleep(o.withdrawMs ?? 120); st.stock -= count;
      if (o.lagMs) setTimeout(() => bot.give(o.item, count), o.lagMs); else bot.give(o.item, count);
    },
    deposit: async (_t: number, _m: null, count: number) => {
      bot._client.write("window_click"); st.windowClicks.push(Date.now());
      await sleep(o.depositMs ?? 120); st.stock += count;
      const slot = bot.slots.find((i) => i?.name === o.item); if (slot) slot.count -= count;
    },
    close() {},
  });
  return st;
}
