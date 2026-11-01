import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExperimentEvidenceJournal,
  type ExperimentAttempt,
  type ExperimentObservation,
} from "./experiment-evidence.js";
const dirs: string[] = [];
const journals: ExperimentEvidenceJournal[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "t3-journal-"));
  dirs.push(dir);
  const path = join(dir, "operator.jsonl");
  const j = new ExperimentEvidenceJournal(path, "offline", new Set(["a", "b"]), "offline");
  journals.push(j);
  return { j, path };
}
const attempt = (action: ExperimentAttempt["action"] = "gather"): ExperimentAttempt => ({
  action,
  decisionSource: "model",
  decisionEventId: "decision-a",
  expectedItem: "oak_log",
});
const observation = (over: Partial<ExperimentObservation> = {}): ExperimentObservation => ({
  successReported: true,
  beforeInventory: {},
  afterInventory: { oak_log: 1 },
  worldChanges: [],
  ...over,
});
afterEach(() => {
  for (const j of journals.splice(0)) j.close(false);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("operator evidence, correlated actions and physical witnesses", () => {
  it("records attempted, verified, unverified, failed and interrupted work separately", () => {
    const { j } = fixture();
    const a = j.forCitizen("a");
    a.observe(a.attempt(attempt()), observation());
    a.observe(a.attempt(attempt()), observation({ afterInventory: {} }));
    a.observe(
      a.attempt(attempt()),
      observation({ successReported: false, afterInventory: {}, failureCode: "PATH_BLOCKED" }),
    );
    a.attempt(attempt());
    j.close(false);
    expect(j.operatorSummary()).toMatchObject({
      attempted: 4,
      verified: 1,
      unverified: 1,
      failed: 1,
      incompleteActions: 1,
      mode: "offline",
    });
  });

  it("rejects cross-actor attribution, duplicate observations and unknown citizens", () => {
    const { j } = fixture();
    const a = j.forCitizen("a");
    const id = a.attempt(attempt());
    expect(() => j.forCitizen("b").observe(id, observation())).toThrow(/correlation/);
    a.observe(id, observation());
    expect(() => a.observe(id, observation())).toThrow(/correlation/);
    expect(() => j.forCitizen("model-forged")).toThrow(/unknown/);
  });

  it("never verifies placement from a model success claim without inventory and world effects", () => {
    const { j } = fixture();
    const a = j.forCitizen("a");
    const input = { ...attempt("place"), target: { x: 1, y: 64, z: 1 } };
    a.observe(a.attempt(input), observation());
    a.observe(
      a.attempt(input),
      observation({
        beforeInventory: { oak_log: 1 },
        afterInventory: {},
        worldChanges: [{ position: input.target, before: "air", after: "oak_log" }],
      }),
    );
    expect(j.operatorSummary()).toMatchObject({ verified: 1, unverified: 1 });
  });

  it("does not verify phantom calorie restoration", () => {
    const { j } = fixture();
    const a = j.forCitizen("a");
    a.observe(
      a.attempt({ ...attempt("eat"), expectedItem: "bread" }),
      observation({
        beforeInventory: { bread: 1 },
        afterInventory: { bread: 1 },
        hungerBefore: 10,
        hungerAfter: 15,
      }),
    );
    a.observe(
      a.attempt({ ...attempt("eat"), expectedItem: "bread" }),
      observation({
        beforeInventory: { bread: 1 },
        afterInventory: {},
        hungerBefore: 10,
        hungerAfter: 15,
      }),
    );
    expect(j.operatorSummary()).toMatchObject({ verified: 1, unverified: 1 });
  });

  it("uses measured arrival and speech delivery recipients rather than requested targets", () => {
    const { j } = fixture();
    const a = j.forCitizen("a");
    a.observe(
      a.attempt({ ...attempt("move"), target: { x: 10, y: 64, z: 10 } }),
      observation({ position: { x: 0, y: 64, z: 0 } }),
    );
    a.observe(a.attempt(attempt("speech")), observation({ authorizedRecipients: [] }));
    expect(j.operatorSummary().unverified).toBe(2);
  });

  it("logs lifecycle and measured TPS without inventing an absent server metric", () => {
    const { j, path } = fixture();
    j.forCitizen("a").lifecycle("death");
    j.forCitizen("a").lifecycle("respawn");
    j.recordTick(30);
    j.recordTick(40, 19.8);
    j.recordIntervention("operator_stop");
    j.close(false);
    const rows = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows.filter((r) => r.kind === "tick")).toMatchObject([
      { durationMs: 30 },
      { measuredTps: 19.8 },
    ]);
    expect(rows.find((r) => r.kind === "tick")).not.toHaveProperty("measuredTps");
    expect(j.operatorSummary()).toMatchObject({ deaths: 1, respawns: 1, interventions: 1 });
  });

  it("rejects raw secrets and prompts instead of logging arbitrary payloads", () => {
    const { j, path } = fixture();
    expect(() =>
      j.forCitizen("a").attempt({ ...attempt(), apiKey: "private-token" } as ExperimentAttempt),
    ).toThrow();
    j.close(false);
    expect(readFileSync(path, "utf8")).not.toContain("private-token");
  });

  it("preserves prior evidence and chains every complete JSON row", () => {
    const { j, path } = fixture();
    j.forCitizen("a").observe(j.forCitizen("a").attempt(attempt()), observation());
    j.close(true);
    let prior = "";
    const rows = readFileSync(path, "utf8").trim().split("\n");
    rows.forEach((line, i) => {
      const { hash, ...row } = JSON.parse(line);
      expect(row.seq).toBe(i + 1);
      expect(row.previousHash).toBe(prior);
      expect(hash).toBe(createHash("sha256").update(JSON.stringify(row)).digest("hex"));
      prior = hash;
    });
    expect(
      () => new ExperimentEvidenceJournal(path, "offline", new Set(["a"]), "offline"),
    ).toThrow();
    expect(() => j.recordTick(1)).toThrow(/closed/);
  });
});

it("requires consumed ingredients as well as gained output to verify crafting", () => {
  const { j } = fixture();
  const a = j.forCitizen("a");
  a.observe(
    a.attempt({ ...attempt("craft"), expectedItem: "oak_planks" }),
    observation({ beforeInventory: { oak_log: 1 }, afterInventory: { oak_log: 1, oak_planks: 4 } }),
  );
  a.observe(
    a.attempt({ ...attempt("craft"), expectedItem: "oak_planks" }),
    observation({ beforeInventory: { oak_log: 1 }, afterInventory: { oak_planks: 4 } }),
  );
  expect(j.operatorSummary()).toMatchObject({ verified: 1, unverified: 1 });
});

it("invalidates an in-flight receipt when its citizen dies", () => {
  const { j } = fixture();
  const a = j.forCitizen("a");
  const id = a.attempt(attempt());
  a.lifecycle("death");
  a.lifecycle("respawn");
  expect(() => a.observe(id, observation())).toThrow(/correlation/);
  expect(j.operatorSummary()).toMatchObject({ incompleteActions: 0, interrupted: 1 });
});
