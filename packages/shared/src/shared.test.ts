import { describe, expect, it } from "vitest";
import { fail, ok } from "./action-result.js";
import { loadConfig } from "./config.js";
import { createEvent, EventBus } from "./events.js";
import { formatSimEvent, presentEvent } from "./format-event.js";
import { relationshipPercent } from "./friendly-names.js";
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
    expect(cfg.OLLAMA_ROUTINE_MODEL).toBe("qwen3.5:9b");
    expect(cfg.OLLAMA_MAX_CONCURRENCY).toBe(1);
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

describe("event presentation", () => {
  it("formats task and death events into readable sentences", () => {
    const started = formatSimEvent(
      createEvent("TaskStarted", { task: "gather_wood", reason: "the settlement needs more wood" }, "citizen_atlas"),
    );
    expect(started.headline).toBe("Atlas started gathering wood.");
    expect(started.subtext).toMatch(/Reason: the settlement needs more wood/i);

    const failed = formatSimEvent(
      createEvent(
        "TaskFailed",
        { task: "gather_wood", error: "moveTo timed out heading to 6 75 44" },
        "citizen_ava",
      ),
    );
    expect(failed.headline).toBe("Ava couldn't gather wood.");
    expect(failed.subtext).toMatch(/Movement stopped after no progress was made/);
    expect(failed.kind).toBe("failure");

    const connected = formatSimEvent(createEvent("CitizenConnected", {}, "citizen_theo"));
    expect(connected.headline).toBe("Theo entered the world.");

    const talk = formatSimEvent(
      createEvent("ConversationOccurred", { other: "Kai", message: "Kai, here. Eat." }, "citizen_maya"),
    );
    expect(talk.headline).toBe("Maya spoke with Kai.");
    expect(talk.subtext).toBe("Kai, here. Eat.");

    const llm = formatSimEvent(
      createEvent("LLMDecisionMade", { goal: "gather_food", reason: "Hunger is low" }, "citizen_atlas"),
    );
    expect(llm.headline).toBe("Atlas reconsidered what to do.");
    expect(llm.subtext).toMatch(/Goal: Gather food/);
    expect(llm.icon).toBe("🧠");
    expect(llm.importance).toBe("NORMAL");
  });

  it("falls back for unknown events without crashing", () => {
    const presented = presentEvent({
      type: "ResourceLocated",
      timestamp: new Date().toISOString(),
      citizenId: "citizen_atlas",
      payload: { x: 1 },
    });
    expect(presented.headline).toBe("Atlas: Resource located.");
    expect(presented.technical.type).toBe("ResourceLocated");
  });

  it("keeps raw event data in technical details", () => {
    const event = createEvent("ErrorOccurred", { error: "bot exploded" }, "citizen_ava");
    const presented = formatSimEvent(event);
    expect(presented.technical.type).toBe("ErrorOccurred");
    expect(presented.technical.payload).toEqual({ error: "bot exploded" });
    expect(relationshipPercent(0.22)).toBe(22);
  });
});
