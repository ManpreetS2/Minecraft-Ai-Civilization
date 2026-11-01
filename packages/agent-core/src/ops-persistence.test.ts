import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { EventBus, createEvent, fail, ok } from "@civ/shared";
import { CivilizationStore } from "./store.js";
import { DirectiveBoard } from "./directives.js";
import { SettlementRuntime } from "./settlement-runtime.js";
import {
  LAST_OUTCOME_META_PREFIX,
  lastOutcomeFrom,
  loadCitizenLastOutcome,
  persistCitizenLastOutcome,
  shouldBackoffToObserve,
} from "./task-recovery.js";
import type { PlannedTask } from "./planner.js";

/**
 * OPS-001 (persistence + restore after a restart). A "restart" is store.close() + a new CivilizationStore on the
 * same file, or (for crashes) a second connection opened while the first is never closed. Offline, temp dirs only.
 */
const tmpDirs: string[] = [];
const mkTmp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // best effort (Windows may still hold a handle)
    }
  }
});
const dbPath = (tag: string) => join(mkTmp(`ops-persist-${tag}-`), "civ.sqlite");
const citizens = [
  { id: "citizen_atlas", name: "Atlas" },
  { id: "citizen_maya", name: "Maya" },
];
const board = (store: CivilizationStore) => new DirectiveBoard(store, new EventBus(), () => true, () => "run-1");
const plan = (over: Partial<PlannedTask> = {}): PlannedTask => ({
  goal: "gather_wood",
  task: "gather_wood",
  action: "mineBlock",
  source: "planner",
  reason: "t",
  priority: 0.5,
  ...over,
});

describe("OPS-001 restart: world state round trip", () => {
  it("memories, relationships, events, delivered-event ids, persistent facts and meta all survive a reopen", () => {
    const path = dbPath("rt");
    const a = new CivilizationStore(path);
    a.addMemory({ id: "m1", citizenId: "citizen_atlas", kind: "episodic", content: "found a cave", importance: 0.9, createdAt: "2026-10-31T10:00:00.000Z", relatedCitizenId: "citizen_maya" });
    a.addMemory({ id: "m2", citizenId: "citizen_atlas", kind: "recent", content: "ate bread", importance: 0.2, createdAt: "2026-10-31T10:05:00.000Z" });
    a.saveRelationship({ citizenId: "citizen_atlas", otherId: "citizen_maya", trust: 0.7, affection: 0.4, respect: 0.6, resentment: 0.1, familiarity: 0.5 });
    a.appendEvent(createEvent("ResourceCollected", { item: "oak_log", count: 2 }, "citizen_atlas"));
    a.markEventsDelivered("citizen_atlas", ["evt-1", "evt-2"]);
    a.upsertPersistentFact({ id: "f1", citizenId: "citizen_atlas", factKey: "cave", content: "cave at 10,12,3" });
    a.setMeta("runId", "run-xyz");
    a.close();

    const b = new CivilizationStore(path);
    expect(b.getMemories("citizen_atlas").map((m) => m.id)).toEqual(["m1", "m2"]); // importance DESC
    expect(b.getMemories("citizen_atlas")[0]?.relatedCitizenId).toBe("citizen_maya");
    expect(b.getMemories("citizen_maya")).toEqual([]);
    expect(b.getRelationship("citizen_atlas", "citizen_maya")).toMatchObject({ trust: 0.7, respect: 0.6 });
    expect(b.recentEvents(10)).toHaveLength(1);
    expect(b.recentEvents(10)[0]?.payload).toEqual({ item: "oak_log", count: 2 });
    expect([...b.getDeliveredEventIds("citizen_atlas")].sort()).toEqual(["evt-1", "evt-2"]);
    expect(b.getDeliveredEventIds("citizen_maya").size).toBe(0);
    expect(b.listPersistentFacts("citizen_atlas")[0]?.content).toBe("cave at 10,12,3");
    expect(b.getMeta("runId")).toBe("run-xyz");
    b.close();
  });

  it("reopening never re-seeds over saved citizens (name, goal, task, action, position survive; seed is INSERT OR IGNORE)", () => {
    const path = dbPath("seed");
    const a = new CivilizationStore(path);
    const maya = a.getCitizen("citizen_maya");
    if (!maya) throw new Error("missing maya");
    maya.status = "online";
    maya.currentGoal = "gather_wood";
    maya.currentTask = "gather_wood";
    maya.currentAction = "mineBlock";
    maya.lastKnownPosition = { x: 4, y: 70, z: -8 };
    a.upsertCitizen(maya);
    a.close();
    for (let i = 0; i < 3; i += 1) {
      const again = new CivilizationStore(path);
      expect(again.getCitizens()).toHaveLength(5);
      expect(again.getCitizen("citizen_maya")).toMatchObject({ status: "online", currentTask: "gather_wood", currentAction: "mineBlock", lastKnownPosition: { x: 4, y: 70, z: -8 } });
      again.close();
    }
  });

  it("personality is rolled once and never silently rerolled after a restart", () => {
    const path = dbPath("pers");
    const a = new CivilizationStore(path);
    expect(a.ensurePersonality("citizen_kai", '{"bold":1}')).toBe(true);
    a.close();
    const b = new CivilizationStore(path);
    expect(b.ensurePersonality("citizen_kai", '{"bold":0}')).toBe(false);
    expect(b.getCitizen("citizen_kai")?.personalityJson).toBe('{"bold":1}');
    b.close();
  });

  it("home claim (home, membership, bed, chest, citizen.homeId) is restored atomically", () => {
    const path = dbPath("home");
    const a = new CivilizationStore(path);
    a.writeHomeClaim({
      home: { id: "home_1", dimension: "overworld", origin: { x: 10, y: 64, z: 10 }, entrance: { x: 10, y: 64, z: 12 }, createdAt: "2026-10-31T09:00:00.000Z", updatedAt: "2026-10-31T09:00:00.000Z" } as never,
      membership: { citizenId: "citizen_atlas", homeId: "home_1", bed: { x: 11, y: 64, z: 11 }, personalChest: { x: 12, y: 64, z: 11 }, storageAccess: "personal", createdAt: "2026-10-31T09:00:00.000Z" } as never,
    });
    a.close();
    const b = new CivilizationStore(path);
    expect(b.getCitizen("citizen_atlas")?.homeId).toBe("home_1");
    expect(b.getMembership("citizen_atlas")).toMatchObject({ homeId: "home_1", bed: { x: 11, y: 64, z: 11 } });
    expect(b.bedClaimOwner({ x: 11, y: 64, z: 11 })).toBe("citizen_atlas");
    expect(b.personalChestOwner({ x: 12, y: 64, z: 11 })).toBe("citizen_atlas");
    b.leaveHome("citizen_atlas");
    b.close();
    const c = new CivilizationStore(path);
    expect(c.getCitizen("citizen_atlas")?.homeId).toBeUndefined();
    expect(c.bedClaimOwner({ x: 11, y: 64, z: 11 })).toBeUndefined(); // a 'left' membership no longer owns the bed
    c.close();
  });
});

describe("OPS-001 restart: crash (no close) and in-flight writes", () => {
  it("committed writes are visible to a second connection even though the first was never closed (WAL)", () => {
    const path = dbPath("crash");
    const crashed = new CivilizationStore(path);
    crashed.setMeta("k", "before-crash");
    crashed.markDeceased("citizen_theo", "2026-10-31T11:00:00.000Z", { x: 1, y: 2, z: 3 });
    // process dies here: crashed.close() is never called
    const restarted = new CivilizationStore(path);
    expect(restarted.getMeta("k")).toBe("before-crash");
    expect(restarted.isDeceased("citizen_theo")).toBe(true);
    restarted.close();
    crashed.close();
  });

  it("markEventsDelivered is idempotent: re-delivering an id keeps the FIRST delivered_at and never duplicates (INSERT OR IGNORE)", () => {
    const path = dbPath("idem");
    const store = new CivilizationStore(path);
    store.markEventsDelivered("citizen_atlas", ["evt-1", "evt-2"], "2026-10-31T10:00:00.000Z");
    store.markEventsDelivered("citizen_atlas", ["evt-2", "evt-3", "evt-3"], "2026-10-31T11:00:00.000Z");
    store.markEventsDelivered("citizen_maya", ["evt-2"], "2026-10-31T12:00:00.000Z"); // same event id, other citizen: independent
    store.close();
    const raw = new Database(path, { readonly: true });
    const rows = raw.prepare(`SELECT citizen_id, event_id, delivered_at FROM citizen_event_delivery ORDER BY citizen_id, event_id`).all();
    raw.close();
    expect(rows).toEqual([
      { citizen_id: "citizen_atlas", event_id: "evt-1", delivered_at: "2026-10-31T10:00:00.000Z" },
      { citizen_id: "citizen_atlas", event_id: "evt-2", delivered_at: "2026-10-31T10:00:00.000Z" }, // NOT overwritten by the 11:00 re-delivery
      { citizen_id: "citizen_atlas", event_id: "evt-3", delivered_at: "2026-10-31T11:00:00.000Z" },
      { citizen_id: "citizen_maya", event_id: "evt-2", delivered_at: "2026-10-31T12:00:00.000Z" },
    ]);
    const again = new CivilizationStore(path);
    expect([...again.getDeliveredEventIds("citizen_atlas")].sort()).toEqual(["evt-1", "evt-2", "evt-3"]);
    again.close();
  });

  it("a multi-row write is all-or-nothing: a failing markEventsDelivered batch leaves nothing half-applied", () => {
    const path = dbPath("txn");
    const store = new CivilizationStore(path);
    // A non-string id makes better-sqlite3 throw mid-transaction after the first insert succeeded.
    expect(() => store.markEventsDelivered("citizen_atlas", ["ok-1", { bad: true } as never])).toThrow();
    expect(store.getDeliveredEventIds("citizen_atlas").size).toBe(0);
    store.close();
  });

  it("writes through safeWrite after shutdown are refused and never reach disk", () => {
    const path = dbPath("late");
    const store = new CivilizationStore(path);
    store.close();
    expect(store.safeWrite("late-meta", () => store.setMeta("late", "1"))).toEqual({ ok: false, reason: "closed" });
    const reopened = new CivilizationStore(path);
    expect(reopened.getMeta("late")).toBeUndefined();
    reopened.close();
  });

  it("a persisted death stays dead across several restarts and cannot be un-killed by an 'online' upsert", () => {
    const path = dbPath("dead");
    const a = new CivilizationStore(path);
    a.markDeceased("citizen_ava", "2026-10-31T11:00:00.000Z", { x: 0, y: 64, z: 0 });
    a.close();
    for (let i = 0; i < 2; i += 1) {
      const s = new CivilizationStore(path);
      const ava = s.getCitizen("citizen_ava");
      if (!ava) throw new Error("missing");
      expect(ava.status).toBe("dead");
      ava.status = "online";
      s.upsertCitizen(ava);
      expect(s.getCitizen("citizen_ava")?.status).toBe("dead");
      s.close();
    }
  });
});

describe("OPS-001 restart: directives", () => {
  it("an ACTIVE directive is still active for its citizen after a restart; cancel persists too", () => {
    const path = dbPath("dir");
    const a = new CivilizationStore(path);
    const issued = board(a).issue({ target: "Atlas", mode: "DIRECTIVE", instruction: "Atlas get some wood", citizens });
    expect(issued.ok).toBe(true);
    a.close();

    const b = new CivilizationStore(path);
    const bb = board(b);
    const active = bb.activeFor("citizen_atlas");
    expect(active?.status).toBe("ACTIVE");
    expect(bb.activeFor("citizen_maya")).toBeUndefined();
    bb.cancelForCitizen("citizen_atlas", "user cancelled");
    b.close();

    const c = new CivilizationStore(path);
    const cc = board(c);
    expect(cc.activeFor("citizen_atlas")).toBeUndefined();
    const [row] = c.listDirectives();
    expect(row?.status).toBe("CANCELLED");
    expect(row?.completedAt).toBeTruthy();
    expect(row?.failureReason).toBe("user cancelled");
    c.close();
  });

  // FIXED (OPS-002): activeFor / suggestionsFor / cancelForCitizen searched only the newest 40 rows (LIMIT 40), so an ACTIVE
  // directive older than that was invisible and the citizen silently stopped obeying it. They now select by status (ACTIVE or
  // PENDING) with no row limit; the 40-row window remains only for display (list()).
  it("an ACTIVE directive older than the 40 newest is still seen by activeFor / suggestionsFor, and cancelForCitizen cancels it", () => {
    const store = new CivilizationStore(dbPath("window"));
    const base = Date.parse("2026-10-31T00:00:00.000Z");
    store.saveDirective({ id: "old-active", targetIds: ["citizen_atlas"], mode: "DIRECTIVE", rawText: "Atlas get wood", parsedIntent: "gather_wood", status: "ACTIVE", createdAt: new Date(base).toISOString(), outcomes: { citizen_atlas: "ACTIVE" } });
    for (let i = 1; i <= 40; i += 1) {
      store.saveDirective({ id: `done-${i}`, targetIds: ["citizen_maya"], mode: "DIRECTIVE", rawText: "x", parsedIntent: "gather_wood", status: "COMPLETED", createdAt: new Date(base + i * 1000).toISOString(), outcomes: { citizen_maya: "COMPLETED" } });
    }
    store.saveDirective({ id: "old-pending-suggestion", targetIds: ["citizen_atlas"], mode: "SUGGESTION", rawText: "Atlas try fishing", parsedIntent: "gather_wood", status: "PENDING", createdAt: new Date(base - 1000).toISOString(), outcomes: { citizen_atlas: "PENDING" } });
    expect(board(store).list().map((d) => d.id)).not.toContain("old-active"); // the display window is still 40
    expect(board(store).activeFor("citizen_atlas")?.id).toBe("old-active");
    expect(board(store).suggestionsFor("citizen_atlas").map((d) => d.id)).toEqual(["old-pending-suggestion"]);
    expect(board(store).activeFor("citizen_maya")).toBeUndefined(); // completed ones stay closed
    // no hidden row limit on the status query either: 45 NEWER open directives for someone else must not push it out
    for (let i = 0; i < 45; i += 1) {
      store.saveDirective({ id: `open-${i}`, targetIds: ["citizen_theo"], mode: "DIRECTIVE", rawText: "x", parsedIntent: "gather_wood", status: "ACTIVE", createdAt: new Date(base + 100_000 + i * 1000).toISOString(), outcomes: { citizen_theo: "ACTIVE" } });
    }
    expect(store.listDirectivesByStatus(["ACTIVE", "PENDING"])).toHaveLength(47);
    expect(board(store).activeFor("citizen_atlas")?.id).toBe("old-active");
    expect(board(store).cancelForCitizen("citizen_atlas", "user cancelled").map((d) => d.id).sort()).toEqual(["old-active", "old-pending-suggestion"]);
    expect(store.getDirective("old-active")?.status).toBe("CANCELLED");
    expect(board(store).activeFor("citizen_atlas")).toBeUndefined();
    store.close();
  });

  // FIXED (OPS-002): listDirectives used to JSON.parse every row unguarded, so ONE corrupt/truncated row made it throw and
  // DirectiveBoard.list/activeFor/cancelForCitizen with it. Corrupt rows are now skipped and logged.
  it("one corrupt directive row is skipped (and logged), not fatal: the valid ones survive the restart", () => {
    const path = dbPath("corrupt-dir");
    const a = new CivilizationStore(path);
    a.saveDirective({ id: "good", targetIds: ["citizen_atlas"], mode: "DIRECTIVE", rawText: "Atlas get wood", parsedIntent: "gather_wood", status: "ACTIVE", createdAt: "2026-10-31T10:00:00.000Z", outcomes: { citizen_atlas: "ACTIVE" } });
    a.close();
    const raw = new Database(path);
    raw.prepare(`INSERT INTO human_directives (id, json, created_at) VALUES ('bad', '{"id":"bad","tar', '2026-10-31T11:00:00.000Z')`).run();
    raw.close();
    const b = new CivilizationStore(path);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(b.listDirectives().map((d) => d.id)).toEqual(["good"]);
      expect(board(b).activeFor("citizen_atlas")?.id).toBe("good");
      expect(b.getDirective("bad")).toBeUndefined(); // by-id read of the corrupt row: undefined, not a throw
      expect(() => board(b).mark("bad", "CANCELLED")).not.toThrow();
      expect(() => board(b).cancel("bad")).not.toThrow();
      expect(b.listDirectivesByStatus(["ACTIVE"]).map((d) => d.id)).toEqual(["good"]);
      expect(logged.mock.calls.some((c) => String(c[0]).includes("corrupt directive row"))).toBe(true);
    } finally {
      logged.mockRestore();
    }
    b.close();
  });
});

describe("OPS-001 restart: in-memory runtime state is NOT persisted", () => {
  // CONFIRMED (OPS-001): claims.ts:99 ClaimBoard and :22 ReservationBook are plain Maps owned by SettlementRuntime
  // (settlement-runtime.ts:5-6); nothing writes them to the store. After a restart every tree/ore claim and every
  // construction reservation is gone. Reasonable for TTL'd claims, but a mid-build material reservation is lost and
  // two citizens can race for the same stock. Characterisation of the contract.
  it("a fresh SettlementRuntime after restart has no claims or reservations (they were never saved)", () => {
    const before = new SettlementRuntime();
    expect(before.claims.tryClaim("tree", "1,64,1", "citizen_atlas", 60_000)).toBe(true);
    before.reservations.reserve("citizen_atlas", "construction", "oak_planks", 40, 600_000);
    expect(before.reservations.reservedOf("oak_planks")).toBe(40);

    const after = new SettlementRuntime();
    expect(after.claims.ownerOf("tree", "1,64,1")).toBeUndefined();
    expect(after.claims.tryClaim("tree", "1,64,1", "citizen_maya", 60_000)).toBe(true);
    expect(after.reservations.reservedOf("oak_planks")).toBe(0);
  });

  it("the SQLite reservation table (store.reserve) DOES persist, and only clearReservations(citizen) frees it", () => {
    const path = dbPath("resv");
    const a = new CivilizationStore(path);
    expect(a.reserve("bed", "citizen_atlas", "11,64,11")).toBe(true);
    expect(a.reserve("bed", "citizen_maya", "11,64,11")).toBe(false);
    a.close();
    const b = new CivilizationStore(path);
    expect(b.activeReservations()).toEqual([{ kind: "bed", resource: "11,64,11", citizenId: "citizen_atlas" }]);
    expect(b.reserve("bed", "citizen_maya", "11,64,11")).toBe(false); // stale reservation from the previous run still blocks
    b.clearReservations("citizen_atlas");
    expect(b.reserve("bed", "citizen_maya", "11,64,11")).toBe(true);
    b.close();
  });
});

describe("OPS-001 restart: last-outcome persistence feeds failure backoff", () => {
  it("a failure streak accumulated before a restart keeps counting after it and trips the backoff", () => {
    const path = dbPath("streak");
    const a = new CivilizationStore(path);
    const f = fail("BLOCK_NOT_FOUND", "none", 1, true);
    let last = lastOutcomeFrom(plan(), f);
    last = lastOutcomeFrom(plan(), f, last);
    persistCitizenLastOutcome(a, "citizen_atlas", last);
    expect(shouldBackoffToObserve(last)).toBe(false);
    a.close();

    const b = new CivilizationStore(path);
    const restored = loadCitizenLastOutcome(b, "citizen_atlas");
    expect(restored?.streak).toBe(2);
    const third = lastOutcomeFrom(plan(), f, restored);
    expect(third.streak).toBe(3);
    expect(shouldBackoffToObserve(third)).toBe(true);
    b.close();
  });

  it("a success after restart clears the persisted streak", () => {
    const store = new CivilizationStore(dbPath("clear"));
    persistCitizenLastOutcome(store, "citizen_atlas", { task: "gather_wood", action: "mineBlock", success: false, code: "BLOCK_NOT_FOUND", streak: 2 });
    const restored = loadCitizenLastOutcome(store, "citizen_atlas");
    const success = lastOutcomeFrom(plan(), ok({ name: "oak_log", collected: 1, position: { x: 0, y: 0, z: 0 } }, 1), restored);
    expect(success.streak).toBe(0);
    expect(success.success).toBe(true);
    store.close();
  });

  it("unparseable or wrongly-shaped persisted outcomes restore as 'no outcome' instead of throwing", () => {
    const store = new CivilizationStore(dbPath("garbage"));
    for (const raw of ["{not json", "null", "42", "[]", '{"task":1,"action":"x"}', '{"task":"a"}']) {
      store.setMeta(`${LAST_OUTCOME_META_PREFIX}citizen_atlas`, raw);
      expect(loadCitizenLastOutcome(store, "citizen_atlas")).toBeUndefined();
    }
    expect(loadCitizenLastOutcome(store, "citizen_nobody")).toBeUndefined();
    store.close();
  });

  // FIXED (OPS-002): a persisted outcome from an older schema (no `streak`) loads as valid with streak === undefined, and
  // lastOutcomeFrom computed `previous.streak + 1` = NaN; NaN >= 3 is false so backoff could never fire again for that task.
  // A missing / non-finite streak now counts as 0.
  it("a persisted outcome missing `streak` restarts the count at 1 (no NaN), and backoff still fires 2 failures later", () => {
    const store = new CivilizationStore(dbPath("nan"));
    store.setMeta(`${LAST_OUTCOME_META_PREFIX}citizen_atlas`, JSON.stringify({ task: "gather_wood", action: "mineBlock", success: false, code: "BLOCK_NOT_FOUND" }));
    const restored = loadCitizenLastOutcome(store, "citizen_atlas");
    expect(restored?.streak).toBe(0); // validated on load: a missing streak is 0, never undefined/NaN
    for (const bad of [null, "3", -4, Number.NaN, {}, [2]]) {
      store.setMeta(`${LAST_OUTCOME_META_PREFIX}citizen_maya`, JSON.stringify({ task: "gather_wood", action: "mineBlock", success: false, streak: bad }));
      expect(loadCitizenLastOutcome(store, "citizen_maya")?.streak, JSON.stringify(bad)).toBe(0);
    }
    store.setMeta(`${LAST_OUTCOME_META_PREFIX}citizen_maya`, JSON.stringify({ task: "gather_wood", action: "mineBlock", success: false, streak: 2 }));
    expect(loadCitizenLastOutcome(store, "citizen_maya")?.streak).toBe(2);
    const next = lastOutcomeFrom(plan(), fail("BLOCK_NOT_FOUND", "none", 1, true), restored);
    expect(next.streak).toBe(1);
    const f = fail("BLOCK_NOT_FOUND", "none", 1, true);
    const third = lastOutcomeFrom(plan(), f, lastOutcomeFrom(plan(), f, next));
    expect(third.streak).toBe(3);
    expect(shouldBackoffToObserve(third)).toBe(true);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "2" as never, null as never]) {
      expect(lastOutcomeFrom(plan(), f, { task: "gather_wood", action: "mineBlock", success: false, streak: bad }).streak).toBe(1);
    }
    store.close();
  });
});
