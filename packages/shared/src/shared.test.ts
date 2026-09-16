import { describe, expect, it } from "vitest";
import { fail, ok } from "./action-result.js";
import { loadConfig } from "./config.js";
import { createEvent, EventBus } from "./events.js";
import { distance, vec3 } from "./vec3.js";

describe("action result helpers", () => {
  it("builds success and failure objects", () => {
    expect(ok({ x: 1 }, 12)).toEqual({ success: true, data: { x: 1 }, durationMs: 12 });
    const failed = fail("PATH_BLOCKED", "no path", 40, true);
    expect(failed.success).toBe(false);
    expect(failed.code).toBe("PATH_BLOCKED");
    expect(failed.retryable).toBe(true);
  });
});

describe("vec3", () => {
  it("computes distance", () => {
    expect(distance(vec3(0, 0, 0), vec3(3, 4, 0))).toBe(5);
  });
});

describe("config", () => {
  it("defaults to local offline Paper 1.21.11", () => {
    const cfg = loadConfig({});
    expect(cfg.MINECRAFT_HOST).toBe("127.0.0.1");
    expect(cfg.MINECRAFT_PORT).toBe(25565);
    expect(cfg.MINECRAFT_VERSION).toBe("1.21.11");
    expect(cfg.MINECRAFT_AUTH_MODE).toBe("offline");
    expect(cfg.LLM_ENABLED).toBe(false);
  });
});

describe("event bus", () => {
  it("keeps recent events and notifies listeners", () => {
    const bus = new EventBus(3);
    const seen: string[] = [];
    bus.on((e) => seen.push(e.type));
    bus.emit(createEvent("CitizenConnected", { name: "Atlas" }, "citizen_atlas"));
    bus.emit(createEvent("TaskStarted", { task: "gather_wood" }, "citizen_atlas"));
    expect(seen).toEqual(["CitizenConnected", "TaskStarted"]);
    expect(bus.getRecent()).toHaveLength(2);
  });
});
