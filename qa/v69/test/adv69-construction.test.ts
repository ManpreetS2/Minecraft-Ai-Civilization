// Construction progress when the citizen is interrupted: production advanceBlueprintBuild on the repository's own
// controlled construction harness (fake bot + simulated world). Not physical proof.
import { afterEach, describe, expect, it } from "vitest";
import { abortedResult } from "../../../packages/shared/src/index.js";
import { WORKSHOP_CABIN_ID, getBlueprint, resolveMaterials } from "../../../packages/minecraft-knowledge/src/index.js";
import { advanceBlueprintBuild, createBuildSession, validateBuiltStructure } from "../../../packages/skills/src/blueprint-build.js";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "../../../packages/minecraft-adapter/src/index.js";
import { createProductionHarness, stubNavOk } from "../../../packages/agent-core/src/construction-production-harness.js";

afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

async function builtWorld(extras: string[] = ["chest", "lighting", "crafting_table"], blueprintId: string = WORKSHOP_CABIN_ID) {
  setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
  const inv = [{ name: "oak_planks", count: 200 }, { name: "oak_door", count: 1 }, { name: "chest", count: 1 }, { name: "torch", count: 4 }, { name: "crafting_table", count: 1 }];
  const harness = createProductionHarness({ inventory: inv });
  const origin = { x: 100, y: 70, z: 100 };
  const session = createBuildSession({
    blueprintId, origin, facing: "south",
    materials: resolveMaterials(getBlueprint(blueprintId)!, { oak_planks: 200, oak_door: 1, chest: 1, torch: 4, crafting_table: 1 }),
    extras,
  });
  session.stage = "FLOOR";
  for (let i = 0; i < 60 && session.status === "IN_PROGRESS"; i++) {
    const r = await advanceBlueprintBuild(harness.ctx, session, { maxPlacements: 60, liveValidate: false, forceNew: true });
    if (!r.success) break;
  }
  return { harness, session, origin };
}

describe("cancellation during FINAL_VALIDATION must not turn a finished build into a permanently BLOCKED one", () => {
  it("control: the harness builds the structure to COMPLETE with static validation", async () => {
    const { session } = await builtWorld();
    expect(session.status).toBe("COMPLETE");
  });

  for (const [label, when] of [["first approach move", 1], ["entrance door / interior move", 2], ["final move out", 4]] as const) {
    it(`abort lands on navigation call #${when} (${label}) of live validation: session stays IN_PROGRESS and the result is CANCELLED/INTERRUPTED`, async () => {
      const { harness, session } = await builtWorld();
      const ctl = new AbortController(); let calls = 0;
      const nav = { ...stubNavOk() } as Record<string, any>;
      for (const k of ["navigateToPosition", "navigateNear", "navigateToInteractWithBlock", "navigateToPlaceBlock"]) {
        const ok = nav[k];
        nav[k] = async (...a: unknown[]) => { calls += 1; if (calls === when) { ctl.abort(); return abortedResult(1); } return ok(...a); };
      }
      setNavigationBackend(nav as unknown as NavigationBackend);
      session.status = "IN_PROGRESS"; session.stage = "FINAL_VALIDATION"; session.failures = [];
      const r = await advanceBlueprintBuild({ ...harness.ctx, signal: ctl.signal, timeoutMs: 5000 } as never, session, { liveValidate: true });
      console.log("FINAL_VALIDATION_CANCEL", label, "calls=", calls, "result=", r.success ? "success" : r.code, "session.status=", session.status, "failures=", JSON.stringify(session.failures));
      expect(ctl.signal.aborted).toBe(true);
      expect(session.status).toBe("IN_PROGRESS");
      expect(!r.success && ["CANCELLED", "INTERRUPTED"].includes(r.code)).toBe(true);
    });
  }

  it("progress is preserved and resumable: after a cancelled validation the next call completes the build", async () => {
    const { harness, session } = await builtWorld();
    const ctl = new AbortController(); let first = true;
    const nav = { ...stubNavOk() } as Record<string, any>;
    for (const k of ["navigateToPosition", "navigateNear", "navigateToInteractWithBlock", "navigateToPlaceBlock"]) { const ok = nav[k]; nav[k] = async (...a: unknown[]) => { if (first) { first = false; ctl.abort(); return abortedResult(1); } return ok(...a); }; }
    setNavigationBackend(nav as unknown as NavigationBackend);
    session.status = "IN_PROGRESS"; session.stage = "FINAL_VALIDATION";
    await advanceBlueprintBuild({ ...harness.ctx, signal: ctl.signal, timeoutMs: 5000 } as never, session, { liveValidate: true });
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    if (session.status === "BLOCKED") console.log("RESUME_AFTER_CANCEL session is BLOCKED; advance cannot resume");
    const again = await advanceBlueprintBuild({ ...harness.ctx, signal: undefined, timeoutMs: 5000 } as never, session, { liveValidate: false });
    expect(again.success).toBe(true);
    expect(session.status).toBe("COMPLETE");
  });


  for (const when of [1, 2, 3, 4]) {
    it(`[QA69-M1] WITHOUT any workstation (basic_shelter_v1): abort on navigation call #${when} of live validation must still be CANCELLED/INTERRUPTED and leave the session IN_PROGRESS`, async () => {
      const { harness, session } = await builtWorld([], "basic_shelter_v1");
      console.log("SHELTER_BUILT status=", session.status, "stage=", session.stage, "placed=", session.placed);
      expect(session.status).toBe("COMPLETE");
      const ctl = new AbortController(); let calls = 0;
      const nav = { ...stubNavOk() } as Record<string, any>;
      for (const k of ["navigateToPosition", "navigateNear", "navigateToInteractWithBlock", "navigateToPlaceBlock"]) {
        const okFn = nav[k];
        nav[k] = async (...a: unknown[]) => { calls += 1; if (calls === when) { ctl.abort(); return abortedResult(1); } return okFn(...a); };
      }
      setNavigationBackend(nav as unknown as NavigationBackend);
      session.status = "IN_PROGRESS"; session.stage = "FINAL_VALIDATION"; session.failures = [];
      const r = await advanceBlueprintBuild({ ...harness.ctx, signal: ctl.signal, timeoutMs: 5000 } as never, session, { liveValidate: true });
      console.log("NO_CHEST_VALIDATION_CANCEL when=", when, "calls=", calls, "result=", r.success ? "success" : r.code, "session.status=", session.status, "failures=", JSON.stringify(session.failures));
      expect(ctl.signal.aborted).toBe(true);
      expect(session.status).toBe("IN_PROGRESS");
      expect(!r.success && ["CANCELLED", "INTERRUPTED"].includes(r.code)).toBe(true);
    });
  }

  it("a cancelled shelter validation reloads as IN_PROGRESS and can finish", async () => {
    for (const [blueprintId, extras] of [["basic_shelter_v1", []], [WORKSHOP_CABIN_ID, ["chest", "lighting", "crafting_table"]]] as const) {
      const { harness, session } = await builtWorld([...extras], blueprintId);
      expect(session.status).toBe("COMPLETE");
      const ctl = new AbortController();
      let calls = 0;
      const nav = { ...stubNavOk() } as Record<string, any>;
      for (const k of ["navigateToPosition", "navigateNear", "navigateToInteractWithBlock", "navigateToPlaceBlock"]) {
        const okFn = nav[k];
        nav[k] = async (...a: unknown[]) => { calls += 1; if (calls === 1) { ctl.abort(); return abortedResult(1); } return okFn(...a); };
      }
      setNavigationBackend(nav as unknown as NavigationBackend);
      session.status = "IN_PROGRESS"; session.stage = "FINAL_VALIDATION"; session.failures = [];
      const interrupted = await advanceBlueprintBuild({ ...harness.ctx, signal: ctl.signal, timeoutMs: 5000 } as never, session, { liveValidate: true });
      expect(interrupted.success).toBe(false);
      expect(session.status).toBe("IN_PROGRESS");
      const reloaded = JSON.parse(JSON.stringify(session));
      setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
      const again = await advanceBlueprintBuild({ ...harness.ctx, timeoutMs: 5000 } as never, reloaded, { liveValidate: false });
      expect(again.success).toBe(true);
      expect(reloaded.status).toBe("COMPLETE");
    }
  });

  it("a genuine (non-cancel) validation failure still BLOCKS: the fix must not hide real failures", async () => {
    const { harness, session } = await builtWorld();
    const nav = { ...stubNavOk(), navigateToPosition: async () => ({ success: false, code: "PATH_BLOCKED", error: "no path", retryable: true, durationMs: 1 }), navigateNear: async () => ({ success: false, code: "PATH_BLOCKED", error: "no path", retryable: true, durationMs: 1 }) };
    setNavigationBackend(nav as unknown as NavigationBackend);
    session.status = "IN_PROGRESS"; session.stage = "FINAL_VALIDATION";
    const r = await advanceBlueprintBuild({ ...harness.ctx, timeoutMs: 5000 } as never, session, { liveValidate: true });
    expect(r.success).toBe(false); expect(session.status).toBe("BLOCKED");
    void validateBuiltStructure;
  });
});
