import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";
import { fail, ok, type Vec3 } from "@civ/shared";

const nav = vi.hoisted(() => ({ move: vi.fn() }));
vi.mock("./navigation.js", () => ({ navigationBackend: () => ({ navigateToPosition: nav.move }) }));
import { enterClaimedHouse } from "./enter-home.js";
import { executeReturnHome } from "./return-home-nav.js";

const home = { x: 10.5, y: 64, z: 0.5 };
function botAt(position: Vec3 = { x: 0.5, y: 64, z: 0.5 }): Bot {
  return {
    username: "HomeArrival", health: 20,
    entity: { position: { ...position }, yaw: 0, pitch: 0, onGround: true },
    time: { timeOfDay: 12000, age: 12000 }, supportFeature: () => false,
    blockAt: () => ({ name: "air", boundingBox: "empty" }),
    waitForTicks: async () => undefined, setControlState: vi.fn(), clearControlStates: vi.fn(),
  } as unknown as Bot;
}
const actions = [
  { name: "enter", run: (bot: Bot, signal?: AbortSignal, target = home, timeoutMs?: number) => enterClaimedHouse(bot, { interior: target, signal, timeoutMs }) },
  { name: "return", run: (bot: Bot, signal?: AbortSignal, target = home, timeoutMs?: number) => executeReturnHome(bot, { home: target, signal, timeoutMs }) },
];
describe("home navigation arrival guards", () => {
  beforeEach(() => { nav.move.mockReset(); nav.move.mockResolvedValue(fail("VERIFY_FAILED", "mocked non-arrival", 1, true)); });
  it.each(actions)("$name refuses cancellation even when already home", async action => {
    const controller = new AbortController();
    controller.abort();
    const result = await action.run(botAt(home), controller.signal);
    if (result.success) throw new Error("cancelled home action succeeded");
    expect(result.code).toBe("CANCELLED");
    expect(nav.move).not.toHaveBeenCalled();
  });
  it.each(actions)("$name refuses a retained dead body already home", async action => {
    const bot = botAt(home);
    bot.health = 0;
    const result = await action.run(bot);
    if (result.success) throw new Error("dead home action succeeded");
    expect(result.code).toBe("NOT_CONNECTED");
    expect(nav.move).not.toHaveBeenCalled();
  });
  it.each(actions)("$name refuses a configuring body already home", async action => {
    const bot = Object.assign(botAt(home), { _client: { state: "configuration" } });
    const result = await action.run(bot);
    if (result.success) throw new Error("configuring home action succeeded");
    expect(result.code).toBe("NOT_CONNECTED");
  });
  it.each(actions)("$name preserves cancellation over incidental physical arrival", async action => {
    const bot = botAt();
    const controller = new AbortController();
    nav.move.mockImplementation(async () => {
      Object.assign(bot.entity.position, home);
      controller.abort();
      return ok({ position: home, distance: 0 }, 1);
    });
    const result = await action.run(bot, controller.signal);
    if (result.success) throw new Error("cancelled movement reported home success");
    expect(result.code).toBe("CANCELLED");
  });
  it("does not report house entry after failed navigation far from the interior", async () => {
    const result = await enterClaimedHouse(botAt(), { interior: home });
    if (result.success) throw new Error("failed distant entry reported success");
    expect(result.code).toBe("INTERIOR_UNREACHABLE");
  });
  it("does not count horizontal proximity on another floor as interior entry", async () => {
    const result = await enterClaimedHouse(botAt({ ...home, y: 55 }), { interior: home });
    if (result.success) throw new Error("wrong-floor entry reported success");
    expect(result.code).toBe("INTERIOR_UNREACHABLE");
  });
  for (const action of actions) {
    it.each([NaN, Infinity])(`${action.name} rejects a non-finite home coordinate %s`, async x => {
      const result = await action.run(botAt(), undefined, { ...home, x });
      if (result.success) throw new Error("malformed home action succeeded");
      expect(result.code).toBe("INVALID_ARGUMENT");
      expect(nav.move).not.toHaveBeenCalled();
    });
    it.each([0, -1, NaN, Infinity])(`${action.name} rejects an invalid timeout %s before its arrival shortcut`, async timeoutMs => {
      const result = await action.run(botAt(home), undefined, home, timeoutMs);
      if (result.success) throw new Error("malformed home timeout succeeded");
      expect(result.code).toBe("INVALID_ARGUMENT");
      expect(nav.move).not.toHaveBeenCalled();
    });
  }
  it.each([NaN, Infinity])("refuses an invalid entrance coordinate %s in both home operations", async y => {
    const entrance = { ...home, y };
    const entered = await enterClaimedHouse(botAt(home), { interior: home, entrance });
    const returned = await executeReturnHome(botAt(home), { home, entrance });
    for (const result of [entered, returned]) {
      if (result.success) throw new Error("malformed entrance succeeded");
      expect(result.code).toBe("INVALID_ARGUMENT");
    }
    expect(nav.move).not.toHaveBeenCalled();
  });

});
