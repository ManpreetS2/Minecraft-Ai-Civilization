import { describe, expect, it } from "vitest";
import { loadConfig } from "@civ/shared";
import {
  evaluateOneCitizenLaunch,
  formatDryRunReport,
  parseArgs,
} from "./one-citizen.js";

function safeConfig(over: Record<string, string> = {}) {
  return loadConfig({
    MINECRAFT_HOST: "127.0.0.1",
    MINECRAFT_PORT: "25567",
    DATABASE_PATH: "./data/world-lab-civilization.sqlite",
    SIM_CITIZEN_COUNT: "1",
    AUTO_START_PAPER: "false",
    SIM_ASSIGN_WORK_ROLES: "false",
    LLM_ENABLED: "true",
    LLM_PROVIDER: "ollama",
    LLM_MODEL: "qwen3.5:4b",
    ...over,
  });
}

describe("launcher guard matrix", () => {
  it("parses dry-run by default", () => {
    expect(parseArgs([]).dryRun).toBe(true);
    expect(parseArgs(["--live"]).dryRun).toBe(false);
  });

  it("MUST REFUSE forbidden ports, civilization sqlite, counts, paper, roles, probes, host", () => {
    for (const port of [25565, 25566]) {
      const plan = evaluateOneCitizenLaunch(
        { dryRun: true, citizen: "Atlas", port, databasePath: "./data/world-lab-civilization.sqlite" },
        safeConfig({ MINECRAFT_PORT: String(port) }),
      );
      expect(plan.violations.some((v) => v.code === "FORBIDDEN_PORT")).toBe(true);
    }

    const civDb = evaluateOneCitizenLaunch(
      { dryRun: true, citizen: "Atlas", databasePath: "./data/civilization.sqlite" },
      safeConfig({ DATABASE_PATH: "./data/civilization.sqlite" }),
    );
    expect(civDb.violations.some((v) => v.code === "FORBIDDEN_DB")).toBe(true);

    for (const count of ["0", "2", "5"]) {
      const plan = evaluateOneCitizenLaunch({ dryRun: true, citizen: "Atlas" }, safeConfig({ SIM_CITIZEN_COUNT: count }));
      expect(plan.violations.some((v) => v.code === "CITIZEN_COUNT")).toBe(true);
    }

    expect(
      evaluateOneCitizenLaunch({ dryRun: true, citizen: "Atlas" }, safeConfig({ AUTO_START_PAPER: "true" })).violations.some(
        (v) => v.code === "AUTO_START_PAPER",
      ),
    ).toBe(true);

    expect(
      evaluateOneCitizenLaunch(
        { dryRun: true, citizen: "Atlas" },
        safeConfig({ SIM_ASSIGN_WORK_ROLES: "true" }),
      ).violations.some((v) => v.code === "ASSIGN_WORK_ROLES"),
    ).toBe(true);

    expect(
      evaluateOneCitizenLaunch({ dryRun: true, citizen: "probe_bot" }, safeConfig()).violations.some(
        (v) => v.code === "PROBE_IDENTITY",
      ),
    ).toBe(true);

    expect(
      evaluateOneCitizenLaunch(
        { dryRun: true, citizen: "Atlas", databasePath: "./data/random.sqlite" },
        safeConfig({ DATABASE_PATH: "./data/random.sqlite" }),
      ).violations.some((v) => v.code === "MISSING_WORLD_LAB_DB"),
    ).toBe(true);

    expect(
      evaluateOneCitizenLaunch(
        { dryRun: true, citizen: "Atlas", host: "192.168.1.10" },
        safeConfig({ MINECRAFT_HOST: "192.168.1.10" }),
      ).violations.some((v) => v.code === "UNEXPECTED_HOST"),
    ).toBe(true);
  });

  it("MUST ACCEPT dry-run only for 127.0.0.1 / 25567 / world-lab db / Atlas / paper false / roles false", () => {
    const plan = evaluateOneCitizenLaunch(
      {
        dryRun: true,
        citizen: "Atlas",
        host: "127.0.0.1",
        port: 25567,
        databasePath: "./data/world-lab-civilization.sqlite",
      },
      safeConfig(),
    );
    expect(plan.safe).toBe(true);
    expect(plan.worldMutation).toBe(false);
    expect(plan.liveConnectAttempted).toBe(false);
    expect(plan.willStartPaper).toBe(false);
    const report = formatDryRunReport(plan);
    expect(report).toContain("dry-run");
    expect(report).toContain("25567");
    expect(report).toContain("world-lab-civilization.sqlite");
    expect(report).toContain("Atlas");
    expect(report).toContain("live connect:       NO");
  });

  it("never attempts live connect even when guards pass", () => {
    const plan = evaluateOneCitizenLaunch(
      {
        dryRun: false,
        citizen: "Atlas",
        host: "127.0.0.1",
        port: 25567,
        databasePath: "./data/world-lab-civilization.sqlite",
      },
      safeConfig(),
    );
    expect(plan.safe).toBe(true);
    expect(plan.liveConnectAttempted).toBe(false);
    expect(plan.worldMutation).toBe(false);
    expect(formatDryRunReport(plan)).toContain("will not connect");
  });
});
