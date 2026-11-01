import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CognitionPrompt } from "@civ/cognition";
import type { MinecraftBody } from "@civ/minecraft-adapter";
import type { BodyObservation } from "@civ/shared";
import { AgentManager } from "./manager.js";
import type { CivilizationStore } from "./store.js";
import { config as baseConfig, legacyFixture, secret } from "./sec001-migration-qa/fixture.js";
const capture = vi.hoisted(() => ({ prompts: [] as CognitionPrompt[] }));
vi.mock("@civ/cognition", async (original) => ({
  ...(await original<typeof import("@civ/cognition")>()),
  createCognition: () => ({
    name: "independent-qa-capture",
    async decide(prompt: CognitionPrompt) {
      capture.prompts.push(structuredClone(prompt));
      return { goal: "explore", priority: 0.5, reason: "offline" };
    },
  }),
}));
vi.mock("./planner.js", async (original) => ({
  ...(await original<typeof import("./planner.js")>()),
  planCitizen: () => ({
    task: "observe",
    goal: "offline",
    source: "planner",
    reason: "no physical actions",
  }),
}));
const config = {
  ...baseConfig,
  COMMUNITIES_JSON: JSON.stringify([
    { id: "gpt", memberIds: ["GPT-A", "GPT-B"] },
    { id: "claude", memberIds: ["Claude-A", "Claude-B"] },
  ]),
};
const fixtures: ReturnType<typeof legacyFixture>[] = [];
function fixture(includeUnverified = true) {
  const f = legacyFixture(includeUnverified);
  fixtures.push(f);
  return f;
}
beforeEach(() => {
  capture.prompts.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) f.cleanup();
});
async function request(db: CivilizationStore, reader = "Claude-A") {
  const manager = new AgentManager(config, db);
  const observation: BodyObservation = {
    username: reader,
    connected: true,
    spawned: true,
    health: 20,
    food: 10,
    inventory: [],
    players: [],
    nearby: [],
  };
  const body = {
    connected: true,
    isDeceased: () => false,
    isAwaitingRespawn: () => false,
    observe: () => observation,
    getBot: () => null,
  } satisfies Pick<
    MinecraftBody,
    "connected" | "isDeceased" | "isAwaitingRespawn" | "observe" | "getBot"
  >;
  const citizen: ReturnType<AgentManager["list"]>[number] = {
    record: db.getCitizen(reader)!,
    body: body as unknown as MinecraftBody,
    busy: false,
    lastLlmAt: 0,
    lastChatAt: 0,
  };
  const before = capture.prompts.length;
  await manager["tickCitizen"](citizen, db.getSettlement(), []);
  await vi.waitFor(() => expect(manager.pendingOps()).toBe(0));
  expect(capture.prompts).toHaveLength(before + 1);
  return capture.prompts.at(-1)!;
}
describe("Independent migrated SQLite -> actual manager cognition QA", () => {
  it("migrated flagged fact and exact-derived memory cannot reach manager cognition, including after restart", async () => {
    // This focused fixture omits source-free note/paraphrase inputs BEFORE migration.
    // Other negative scenarios retain them. No historical rows are deleted to obtain this result.
    const f = fixture(false);
    let s = f.open();
    for (let cycle = 0; cycle < 2; cycle++) {
      const prompt = await request(s);
      expect(JSON.stringify(prompt)).not.toContain(secret);
      expect(prompt.memories.join("\n")).toContain("own verified observation");
      expect(s.getDeliveredEventIds("Claude-A").has("leaked-camp")).toBe(true);
      expect(s.listQuarantinedFacts("Claude-A").map((f) => f.id)).toContain("f-poison");
      if (cycle === 0) {
        s.close();
        s = f.open();
      }
    }
  });

  it("SECURITY REGRESSION: unverified legacy non-event poison must not reach actual manager memory", async () => {
    const s = fixture().open();
    const prompt = await request(s);
    expect(prompt.memories.join("\n")).not.toContain(`${secret} copied without source identity`);
  });

  it("SECURITY CONTRACT GAP: paraphrased historical poison must not reach actual manager memory", async () => {
    const s = fixture().open();
    const prompt = await request(s);
    expect(prompt.memories.join("\n")).not.toContain(
      "Their secret base is at east 137 and north 211",
    );
  });

  it("SECURITY REGRESSION: suspicion replacement must not inherit manager observed-fact eligibility", async () => {
    const s = fixture().open();
    s.upsertPersistentFact({
      id: "replacement",
      citizenId: "Claude-A",
      factKey: "event:private-owner",
      content: "QA unverified replacement",
      kind: "suspicion",
    });
    expect((await request(s)).memories).not.toContain("QA unverified replacement");
  });

  it("correctly flagged poison is absent for the other reader and private memory ownership remains separate", async () => {
    const s = fixture().open();
    const prompt = await request(s, "Claude-B");
    expect(JSON.stringify(prompt)).not.toContain(secret);
    // Ownership alone no longer authenticates a legacy memory's origin.
    expect(prompt.memories.join("\n")).not.toContain("Claude-B private plan");
    expect(s.db.prepare("SELECT content FROM memories WHERE id='m-other'").get()).toEqual({
      content: "Claude-B private plan",
    });
    expect(prompt.memories.join("\n")).not.toContain("I personally observed a river");
  });
});
