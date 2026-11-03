import { describe, expect, it } from "vitest";
import {
  assertMineAllowed,
  checkPropertyPermission,
  isOrdinaryResource,
  looksProtected,
  PropertyRegistry,
  type PropertyRecord,
} from "./property.js";

function chest(over: Partial<PropertyRecord> & Pick<PropertyRecord, "id" | "kind">): PropertyRecord {
  return {
    position: { x: 0, y: 64, z: 0 },
    protectFromBreak: true,
    protectFromAccess: true,
    ...over,
  };
}

describe("property safety failure matrix", () => {
  const registry = new PropertyRegistry();

  it("own personal chest vs another citizen's chest", () => {
    registry.clear();
    registry.register(
      chest({
        id: "atlas-chest",
        kind: "personal_chest",
        ownerCitizenId: "citizen_atlas",
        position: { x: 10, y: 64, z: 10 },
      }),
    );
    registry.register(
      chest({
        id: "kai-chest",
        kind: "personal_chest",
        ownerCitizenId: "citizen_kai",
        position: { x: 20, y: 64, z: 20 },
      }),
    );
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_atlas",
        action: "access_container",
        target: { x: 10, y: 64, z: 10 },
      }).allowed,
    ).toBe(true);
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_atlas",
        action: "access_container",
        target: { x: 20, y: 64, z: 20 },
      }).allowed,
    ).toBe(false);
  });

  it("unclaimed house / communal / fixture chests", () => {
    registry.clear();
    registry.register(chest({ id: "u", kind: "unclaimed_house_chest", position: { x: 1, y: 64, z: 1 } }));
    registry.register(chest({ id: "c", kind: "communal_storage", position: { x: 2, y: 64, z: 2 } }));
    registry.register(
      chest({ id: "f", kind: "fixture_chest", fixtureTag: "fishing", position: { x: 3, y: 64, z: 3 } }),
    );
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_maya",
        action: "access_container",
        target: { x: 1, y: 64, z: 1 },
      }).allowed,
    ).toBe(false);
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_maya",
        action: "access_container",
        target: { x: 2, y: 64, z: 2 },
      }).allowed,
    ).toBe(true);
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_maya",
        action: "access_container",
        target: { x: 3, y: 64, z: 3 },
      }).allowed,
    ).toBe(false);
  });

  it("claimed beds and house walls", () => {
    registry.clear();
    registry.register({
      id: "atlas-bed",
      kind: "claimed_bed",
      ownerCitizenId: "citizen_atlas",
      position: { x: 8, y: 64, z: 8 },
      protectFromBreak: true,
      protectFromAccess: true,
    });
    registry.register({
      id: "wall",
      kind: "home_structure",
      ownerCitizenId: "citizen_atlas",
      position: { x: 12, y: 65, z: 12 },
      protectFromBreak: true,
      protectFromAccess: false,
    });
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_atlas",
        action: "use_bed",
        target: { x: 8, y: 64, z: 8 },
      }).allowed,
    ).toBe(true);
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_kai",
        action: "use_bed",
        target: { x: 8, y: 64, z: 8 },
      }).allowed,
    ).toBe(false);
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_kai",
        action: "path_dig",
        target: { x: 12, y: 65, z: 12 },
        blockName: "oak_planks",
      }).code,
    ).toBe("PATH_BLOCKED");
  });

  it("allows ordinary stone/logs outside protected structure", () => {
    registry.clear();
    expect(isOrdinaryResource("stone")).toBe(true);
    expect(isOrdinaryResource("oak_log")).toBe(true);
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_kai",
        action: "break_block",
        target: { x: 100, y: 64, z: 100 },
        blockName: "stone",
      }).allowed,
    ).toBe(true);
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_kai",
        action: "break_block",
        target: { x: 101, y: 64, z: 100 },
        blockName: "oak_log",
      }).allowed,
    ).toBe(true);
  });

  it("protected block between bot and target / pathfinder shortcut", () => {
    registry.clear();
    registry.register(
      chest({
        id: "atlas-chest",
        kind: "personal_chest",
        ownerCitizenId: "citizen_atlas",
        position: { x: 50, y: 64, z: 50 },
      }),
    );
    const behind = assertMineAllowed(registry, "citizen_kai", { x: 50, y: 64, z: 51 }, "stone");
    expect(behind.allowed).toBe(false);
    expect(behind.code).toBe("PATH_BLOCKED");
  });

  it("stale ownership and missing ownership fail closed", () => {
    registry.clear();
    registry.register(
      chest({
        id: "stale",
        kind: "personal_chest",
        ownerCitizenId: "citizen_atlas",
        stale: true,
        position: { x: 7, y: 64, z: 7 },
      }),
    );
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_atlas",
        action: "access_container",
        target: { x: 7, y: 64, z: 7 },
      }).allowed,
    ).toBe(false);

    expect(looksProtected("chest")).toBe(true);
    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_kai",
        action: "access_container",
        target: { x: 9, y: 64, z: 9 },
        blockName: "chest",
      }).allowed,
    ).toBe(false);

    expect(
      checkPropertyPermission(registry, {
        citizenId: "citizen_kai",
        action: "path_dig",
        target: { x: 11, y: 64, z: 11 },
        // incomplete metadata
      }).allowed,
    ).toBe(false);
  });

  it("cancellation during permission check is honest", () => {
    registry.clear();
    const decision = checkPropertyPermission(registry, {
      citizenId: "citizen_kai",
      action: "break_block",
      target: { x: 1, y: 64, z: 1 },
      blockName: "stone",
      cancelled: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("CANCELLED");
  });
});
