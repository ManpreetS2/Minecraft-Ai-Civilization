import { describe, expect, it } from "vitest";
import {
  ActionTracer,
  endTrace,
  inventoryDelta,
  redactTraceValue,
  startTrace,
} from "./action-trace.js";

describe("action trace invariants", () => {
  it("keeps one correlation id through the preferred phase sequence", () => {
    const tracer = new ActionTracer();
    const seen: string[] = [];
    const stamps: number[] = [];
    tracer.on((t) => {
      seen.push(t.phase);
      stamps.push(Date.parse(t.startedAt));
    });

    const actionId = "act-corr-1";
    let trace = startTrace({
      actionId,
      taskId: "task-food",
      citizenId: "citizen_atlas",
      citizenName: "Atlas",
      phase: "DECISION",
      reason: "Need food",
      optionsConsidered: ["gather_food", "mine_stone"],
      selectedAction: "gather_food",
      modelProvider: "nvidia",
      modelName: "meta/llama",
      fallbackUsed: true,
      details: { apiKey: "SECRET", prompt: "x".repeat(1000) },
    });
    tracer.emit(trace);
    trace = { ...trace, phase: "PLAN", selectedAction: "gatherFood" };
    tracer.emit(trace);
    trace = { ...trace, phase: "SKILL_START", target: { x: 1, y: 64, z: 2 } };
    tracer.emit(trace);
    trace = endTrace(trace, "SKILL_RESULT", {
      navigationResult: "ok",
      permissionResult: "allowed",
      workComplete: false,
      failureCode: "ACCESS_DENIED",
      elapsedMs: -3,
    });
    tracer.emit(trace);
    expect(trace.workComplete).toBe(false);
    expect(trace.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(trace.failureCode).toBe("ACCESS_DENIED");

    trace = endTrace(trace, "WORLD_VERIFICATION", {
      inventoryDelta: inventoryDelta([{ name: "apple", count: 0 }], [{ name: "apple", count: 1 }]),
    });
    tracer.emit(trace);
    tracer.emit(endTrace(trace, "MEMORY_EVENT_UPDATE"));

    expect(seen).toEqual([
      "DECISION",
      "PLAN",
      "SKILL_START",
      "SKILL_RESULT",
      "WORLD_VERIFICATION",
      "MEMORY_EVENT_UPDATE",
    ]);
    expect(tracer.getRecent().every((t) => t.actionId === actionId)).toBe(true);
    expect(tracer.getRecent().every((t) => t.citizenId === "citizen_atlas")).toBe(true);
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]!).toBeGreaterThanOrEqual(stamps[i - 1]!);
    }
    const line = tracer.formatLine(trace);
    expect(line).toContain("fallback");
    expect(line).not.toContain("SECRET");
    expect(JSON.stringify(tracer.getRecent()[0]?.details)).not.toContain("SECRET");
    expect(String(tracer.getRecent()[0]?.details?.prompt ?? "").length).toBeLessThanOrEqual(240);
  });

  it("does not convert failure into success and drops per-tick spam", () => {
    const tracer = new ActionTracer();
    const failed = endTrace(
      startTrace({ actionId: "a2", citizenName: "Kai", phase: "SKILL_START" }),
      "SKILL_RESULT",
      { failureCode: "PATH_BLOCKED", workComplete: true },
    );
    expect(failed.workComplete).toBe(false);
    tracer.emit({ ...failed, details: { tick: true } });
    expect(tracer.getRecent()).toHaveLength(0);
    expect(tracer.droppedTickNoise).toBe(1);
    expect(redactTraceValue({ authorization: "Bearer abc", ok: true })).toEqual({
      authorization: "[REDACTED]",
      ok: true,
    });
  });
});
