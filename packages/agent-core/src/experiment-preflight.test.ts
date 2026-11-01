import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXPERIMENT_RELEASE_BLOCKERS,
  validateExperimentPreflight,
  type ExperimentManifest,
} from "./experiment-preflight.js";
const dirs: string[] = [];
function fixture(stage: "1v1" | "2v2" = "2v2") {
  const dir = mkdtempSync(join(tmpdir(), "t3-preflight-"));
  dirs.push(dir);
  const root = join(dir, "isolated");
  mkdirSync(root);
  const sourceSha = "a".repeat(40);
  const m: ExperimentManifest = {
    experimentId: "offline-fixture",
    sourceSha,
    stage,
    durationMinutes: stage === "2v2" ? 60 : 10,
    worldSeed: "deterministic-test-only",
    sites: [
      { communityId: "north", x: 0, y: 64, z: 0, biome: "forest" },
      { communityId: "south", x: 100, y: 64, z: 100, biome: "plains" },
    ],
    citizens: Array.from({ length: stage === "2v2" ? 4 : 2 }, (_, i) => ({
      id: `c${i}`,
      communityId: i % 2 ? "south" : "north",
      personalitySeed: `seed-${i}`,
      family: i % 2 ? "claude" : "gpt",
      model: i % 2 ? "claude-mock" : "gpt-mock",
      sessionId: `session-${i}`,
      inventoryVerified: true,
      inventory: [],
      shelterVerifiedAbsent: true,
    })),
    server: {
      version: "1.21.6",
      paperBuild: 48,
      difficulty: "normal",
      keepInventory: false,
      hardcore: false,
      doDaylightCycle: true,
      doMobSpawning: true,
      doMobLoot: true,
    },
    paths: {
      runRoot: root,
      world: join(root, "world"),
      database: join(root, "state.sqlite"),
      evidence: join(root, "evidence"),
    },
    budget: { ceilingUsd: 1, accountingEnabled: true, unknownUsageFailClosed: true },
    recording: { enabled: true, audience: "operator_only" },
    humanDirectives: [],
    privacyReplay: { sourceSha, passed: 220, failed: 0, skipped: 0 },
  };
  return { m, protectedPaths: [join(dir, "production")], dir };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("offline experiment preflight refuses false live readiness", () => {
  it.each(["1v1", "2v2"] as const)(
    "accepts a valid %s configuration but retains all release gates",
    (stage) => {
      const { m, protectedPaths } = fixture(stage);
      const result = validateExperimentPreflight(m, protectedPaths);
      expect(result.configurationValid).toBe(true);
      expect(result.configurationErrors).toEqual([]);
      expect(result.readyForLive).toBe(false);
      expect(result.status).toBe("NOT_READY");
      expect(result.releaseBlockers).toEqual([...EXPERIMENT_RELEASE_BLOCKERS]);
    },
  );

  it.each<[string, (m: ExperimentManifest) => void]>([
    ["CITIZEN_COUNT", (m) => m.citizens.pop()],
    [
      "DUPLICATE_CITIZEN",
      (m) => {
        m.citizens[1]!.id = m.citizens[0]!.id;
      },
    ],
    [
      "SHARED_MODEL_SESSION",
      (m) => {
        m.citizens[1]!.sessionId = m.citizens[0]!.sessionId;
      },
    ],
    [
      "PROVIDER_FAMILY_BALANCE",
      (m) => {
        m.citizens[1]!.family = "gpt";
      },
    ],
    [
      "STARTING_COMMUNITIES",
      (m) => {
        m.citizens[0]!.communityId = "other";
      },
    ],
    [
      "COMMUNITY_SITES",
      (m) => {
        m.sites[1]!.communityId = "unknown";
      },
    ],
    [
      "STARTING_SITES_IN_HEARING_RANGE",
      (m) => {
        m.sites[1]!.x = 0;
        m.sites[1]!.z = 0;
      },
    ],
    [
      "DEMO_DURATION",
      (m) => {
        m.durationMinutes = 59;
      },
    ],
    [
      "EMPTY_START_UNVERIFIED",
      (m) => {
        m.citizens[0]!.inventoryVerified = false;
      },
    ],
    [
      "EMPTY_START_UNVERIFIED",
      (m) => {
        m.citizens[0]!.inventory = [{ name: "bread", count: 1 }];
      },
    ],
    [
      "STARTER_SHELTER_UNVERIFIED",
      (m) => {
        m.citizens[0]!.shelterVerifiedAbsent = false;
      },
    ],
    [
      "SERVER_PIN",
      (m) => {
        m.server.version = "1.21.11";
      },
    ],
    [
      "SERVER_PIN",
      (m) => {
        m.server.paperBuild = 49;
      },
    ],
    [
      "SURVIVAL_RULES",
      (m) => {
        m.server.keepInventory = true;
      },
    ],
    [
      "SURVIVAL_RULES",
      (m) => {
        m.server.hardcore = true;
      },
    ],
    [
      "SURVIVAL_RULES",
      (m) => {
        m.server.doDaylightCycle = false;
      },
    ],
    [
      "SURVIVAL_RULES",
      (m) => {
        m.server.difficulty = "peaceful";
      },
    ],
    [
      "COST_ACCOUNTING",
      (m) => {
        m.budget.unknownUsageFailClosed = false;
      },
    ],
    [
      "OPERATOR_RECORDING",
      (m) => {
        m.recording.audience = "citizen_shared";
      },
    ],
    [
      "HUMAN_DIRECTIVES",
      (m) => {
        m.humanDirectives = ["build home now"];
      },
    ],
    [
      "PRIVACY_REPLAY",
      (m) => {
        m.privacyReplay.failed = 1;
      },
    ],
    [
      "PRIVACY_REPLAY",
      (m) => {
        m.privacyReplay.sourceSha = "b".repeat(40);
      },
    ],
  ])("rejects %s", (code, mutate) => {
    const { m, protectedPaths } = fixture();
    mutate(m);
    const result = validateExperimentPreflight(m, protectedPaths);
    expect(result.configurationErrors).toContain(code);
    expect(result.configurationValid).toBe(false);
    expect(result.readyForLive).toBe(false);
  });

  it("does not derive community permission from a provider family", () => {
    const { m, protectedPaths } = fixture();
    m.citizens[1]!.family = "gpt";
    m.citizens[2]!.family = "claude";
    expect(validateExperimentPreflight(m, protectedPaths).configurationValid).toBe(true);
  });

  it("rejects secret fields without echoing their values", () => {
    const { m, protectedPaths } = fixture();
    const result = validateExperimentPreflight(
      { ...m, apiKey: "sk-secret-never-print" },
      protectedPaths,
    );
    expect(result.configurationErrors).toEqual(["INVALID_MANIFEST"]);
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });

  it.each(["sibling", "overlap", "protected", "relative", "missing-protection"])(
    "refuses %s path isolation failure",
    (kind) => {
      const { m, protectedPaths, dir } = fixture();
      if (kind === "sibling") m.paths.world = join(dir, "isolated-other", "world");
      if (kind === "overlap") m.paths.database = join(m.paths.world, "state.sqlite");
      if (kind === "protected") protectedPaths.push(m.paths.runRoot);
      if (kind === "relative") m.paths.database = "data/civilization.sqlite";
      if (kind === "missing-protection") protectedPaths.length = 0;
      expect(validateExperimentPreflight(m, protectedPaths).configurationErrors).toContain(
        "PATH_ISOLATION",
      );
    },
  );

  it("resolves an existing junction before checking a nonexistent database destination", () => {
    const { m, protectedPaths, dir } = fixture();
    const outside = join(dir, "production");
    mkdirSync(outside);
    const link = join(m.paths.runRoot, "alias");
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    m.paths.database = join(link, "new.sqlite");
    expect(validateExperimentPreflight(m, protectedPaths).configurationErrors).toContain(
      "PATH_ISOLATION",
    );
  });
});
