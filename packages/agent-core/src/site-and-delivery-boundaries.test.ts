import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEvent, loadConfig, withAudience } from "@civ/shared";
import { CivilizationStore } from "./store.js";
import { buildCitizenContextPack } from "./citizen-context.js";
import { listDiscoveredSites, parseDiscoveredSites, rememberDiscoveredSite, type DiscoveredSite } from "./discovered-sites.js";
import { sitesKnownTo } from "./community-comms.js";
const stores: CivilizationStore[] = []; const dirs: string[] = [];
const open = (path = ":memory:") => { const s = new CivilizationStore(path); stores.push(s); return s; };
const config = loadConfig({ DEMO_PROFILE: "none", HUMAN_DIRECTIVES_ENABLED: "false" });
const audit = { actor: "orchestrator-config" as const, reason: "offline boundary fixture" };
const site = (citizenId: string): DiscoveredSite => ({ citizenId, kind: "ore", origin: { x: 1, y: 64, z: 2 }, seenAt: "2026-01-01T00:00:00.000Z" });
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("private discoveries and deferred acknowledgement", () => {
  it("preserves two bodies' independent observation of the same world resource", () => {
    const s = open(); rememberDiscoveredSite(s, site("citizen_atlas")); rememberDiscoveredSite(s, site("citizen_maya"));
    const known = listDiscoveredSites(s); expect(known).toHaveLength(2);
    expect(sitesKnownTo(s, "citizen_atlas", known, true)).toEqual([site("citizen_atlas")]);
    expect(sitesKnownTo(s, "citizen_theo", known, true)).toEqual([]);
    expect(sitesKnownTo(s, "citizen_maya", known, true)).toEqual([site("citizen_maya")]);
  });

  it("refuses non-finite site coordinates without rewriting existing metadata", () => {
    const s = open(); rememberDiscoveredSite(s, site("citizen_atlas")); const before = s.getMeta("discovered_resource_sites");
    expect(() => rememberDiscoveredSite(s, { ...site("citizen_maya"), origin: { x: 1, y: Infinity, z: 2 } })).toThrow();
    expect(s.getMeta("discovered_resource_sites")).toBe(before);
  });

  it("ignores malformed stored coordinates rather than passing NaN routes to the planner", () => {
    expect(parseDiscoveredSites(JSON.stringify([{ ...site("citizen_atlas"), origin: { x: 1, z: 2 } }]))).toEqual([]);
    expect(parseDiscoveredSites(JSON.stringify([{ ...site("citizen_atlas"), stand: { x: 1, y: null, z: 2 } }]))).toEqual([]);
  });

  it("keeps low urgency events available across SQLite restart until cognition acknowledges", () => {
    const dir = mkdtempSync(join(tmpdir(), "t3-deferred-")); dirs.push(dir); const path = join(dir, "fixture.sqlite");
    let s = open(path); const e = createEvent("TaskCompleted", { message: "own route observation", visibility: { class: "actor_private" } }, "citizen_atlas");
    s.appendEvent(e);
    const pack = buildCitizenContextPack({ store: s, config, citizenId: "citizen_atlas", deferDelivery: true });
    expect(pack.bulletin.deliveredEventIds).toContain(e.id); expect(s.getDeliveredEventIds("citizen_atlas")).not.toContain(e.id);
    s.close(); s = open(path);
    const retried = buildCitizenContextPack({ store: s, config, citizenId: "citizen_atlas", deferDelivery: true });
    expect(retried.bulletin.deliveredEventIds).toContain(e.id); retried.acknowledge();
    expect(s.getDeliveredEventIds("citizen_atlas")).toContain(e.id);
    expect(buildCitizenContextPack({ store: s, config, citizenId: "citizen_atlas", deferDelivery: true }).bulletin.deliveredEventIds).not.toContain(e.id);
  });

  it("rechecks audience on acknowledgement after a membership change", () => {
    const s = open(); s.upsertCommunity("north", "North", audit, "2026-01-01T00:00:00.000Z");
    s.addCommunityMember("north", "citizen_atlas", audit, "2026-01-01T00:00:00.000Z");
    s.addCommunityMember("north", "citizen_maya", audit, "2026-01-01T00:00:00.000Z");
    const e = createEvent("ConversationOccurred", withAudience({ message: "heard while affiliated" }, "settlement_public", { scope: "community", communityId: "north" }), "citizen_maya");
    s.appendEvent(e); const pack = buildCitizenContextPack({ store: s, config, citizenId: "citizen_atlas", deferDelivery: true });
    expect(pack.bulletin.deliveredEventIds).toContain(e.id);
    s.removeCommunityMember("north", "citizen_atlas", audit);
    expect(pack.acknowledge()).toEqual([]); expect(s.getDeliveredEventIds("citizen_atlas")).not.toContain(e.id);
  });
});
