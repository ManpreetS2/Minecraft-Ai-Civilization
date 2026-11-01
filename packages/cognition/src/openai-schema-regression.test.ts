import { describe, expect, it, vi } from "vitest";
import { CloudBudgetGate } from "./cloud-budget.js";
import { GOALS } from "./goals.js";
import { OpenAiResponsesProvider } from "./openai-responses.js";
import { validateCognitionDecision, validateDecision, type HighLevelDecision } from "./schema.js";

const prompt = {
  citizenName: "A",
  health: 20,
  hunger: 12,
  inventory: [],
  settlementNeeds: [],
  memories: [],
  nearbyCitizens: [],
};

function providerReturning(output: unknown) {
  const fetchImpl = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify(output),
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200 },
      ),
  );
  const provider = new OpenAiResponsesProvider({
    apiKey: "sk-test-offline",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    timeoutMs: 1000,
    maxOutputTokens: 128,
    maxRetries: 0,
    budget: new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 50, spendAllowanceUsd: 1 }),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { provider, fetchImpl };
}

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  [keyword: string]: unknown;
};

async function sentFormat() {
  const { provider, fetchImpl } = providerReturning({
    goal: "rest",
    priority: 0.1,
    reason: "x",
    targetCitizenId: null,
  });
  await provider.decide(prompt);
  const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
    text: { format: { type: string; strict: boolean; schema: JsonSchema } };
  };
  return body.text.format;
}

/** Keywords from the OpenAI Structured Outputs supported-schema list that this schema may use. */
const SUPPORTED_KEYWORDS = new Set([
  "type",
  "description",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "minimum",
  "maximum",
]);

function schemaNodes(node: JsonSchema): JsonSchema[] {
  return [node, ...Object.values(node.properties ?? {}).flatMap(schemaNodes)];
}

describe("strict Structured Outputs request schema (offline shape check only)", () => {
  it("sends a strict json_schema format", async () => {
    await expect(sentFormat()).resolves.toMatchObject({ type: "json_schema", strict: true });
  });

  it("requires exactly the declared properties on every object", async () => {
    const { schema } = await sentFormat();
    for (const node of schemaNodes(schema).filter((n) => n.properties)) {
      expect([...(node.required ?? [])].sort()).toEqual(Object.keys(node.properties!).sort());
      expect(node.additionalProperties).toBe(false);
    }
  });

  it("uses only keywords the strict schema list supports", async () => {
    const { schema } = await sentFormat();
    for (const node of schemaNodes(schema)) {
      for (const keyword of Object.keys(node)) {
        expect(SUPPORTED_KEYWORDS, `unsupported keyword ${keyword}`).toContain(keyword);
      }
    }
  });

  it("declares targetCitizenId as a required nullable string and offers every goal", async () => {
    const { schema } = await sentFormat();
    expect(schema.required).toContain("targetCitizenId");
    expect(schema.properties?.targetCitizenId?.type).toEqual(["string", "null"]);
    expect(schema.properties?.goal?.enum).toEqual([...GOALS]);
  });
});

describe("provider null to internal optional normalization (mock-only)", () => {
  it("omits targetCitizenId when the provider sends null", async () => {
    const { provider } = providerReturning({
      goal: "gather_food",
      priority: 0.8,
      reason: "Hungry",
      targetCitizenId: null,
    });
    const decision = await provider.decide(prompt);
    expect(decision).toEqual({ goal: "gather_food", priority: 0.8, reason: "Hungry" });
    expect("targetCitizenId" in decision).toBe(false);
  });

  it("keeps a real target, trimmed, in the optional internal field", async () => {
    const { provider } = providerReturning({
      goal: "help_citizen",
      priority: 0.5,
      reason: "Maya needs wood",
      targetCitizenId: "  citizen_maya  ",
    });
    const decision: HighLevelDecision = await provider.decide(prompt);
    const target: string | undefined = decision.targetCitizenId;
    expect(target).toBe("citizen_maya");
  });

  it.each([
    ["empty string", ""],
    ["whitespace", "   "],
    ["wrong type", 7],
  ])("omits a target given as %s", (_description, targetCitizenId) => {
    const decision = validateDecision({
      goal: "rest",
      priority: 0.1,
      reason: "x",
      targetCitizenId,
    });
    expect("targetCitizenId" in decision).toBe(false);
  });

  it("still accepts a response with the field absent, as older mocks send", () => {
    expect(validateDecision({ goal: "rest", priority: 0.1, reason: "x" })).toEqual({
      goal: "rest",
      priority: 0.1,
      reason: "x",
    });
  });

  it("does not let null satisfy a social goal that requires a target", () => {
    expect(() =>
      validateCognitionDecision({
        goal: "socialize",
        priority: 0.5,
        reason: "chat",
        targetCitizenId: null,
      }),
    ).toThrow(/targetCitizenId/);
  });

  it.each(GOALS.map((goal) => [goal]))("parses goal %s with a null target", async (goal) => {
    const { provider } = providerReturning({
      goal,
      priority: 0.5,
      reason: "ok",
      targetCitizenId: null,
    });
    await expect(provider.decide(prompt)).resolves.toEqual({ goal, priority: 0.5, reason: "ok" });
  });

  it("rejects a goal outside the allowlist even with a valid schema shape", async () => {
    const { provider } = providerReturning({
      goal: "teleport_home",
      priority: 0.5,
      reason: "warp",
      targetCitizenId: null,
    });
    await expect(provider.decide(prompt)).rejects.toThrow();
  });
});

describe("reason limits removed from the wire schema still hold (mock-only)", () => {
  it("truncates a reason over 280 characters", () => {
    const decision = validateDecision({
      goal: "rest",
      priority: 0.1,
      reason: "r".repeat(400),
      targetCitizenId: null,
    });
    expect(decision.reason).toHaveLength(280);
  });

  it.each(["", "   "])("rejects an empty reason: %j", (reason) => {
    expect(() =>
      validateDecision({ goal: "rest", priority: 0.1, reason, targetCitizenId: null }),
    ).toThrow();
  });
});

describe("combined SEC-001 and cloud wire contract", () => {
  it("declares nullable communication with all nested properties required", async () => {
    const { schema } = await sentFormat();
    expect(schema.required).toContain("communication");
    const communication = schema.properties?.communication;
    expect(communication?.type).toEqual(["object", "null"]);
    expect(communication?.properties?.toCitizen?.type).toEqual(["string", "null"]);
    expect(communication?.properties?.bulletinLine?.type).toEqual(["integer", "null"]);
  });

  it("omits a null intent without disturbing the goal or cost settlement", async () => {
    const { provider } = providerReturning({
      goal: "rest",
      priority: 0.1,
      reason: "x",
      targetCitizenId: null,
      communication: null,
    });
    await expect(provider.decide(prompt)).resolves.toEqual({
      goal: "rest",
      priority: 0.1,
      reason: "x",
    });
    expect(provider.budgetSnapshot).toMatchObject({
      requestsUsed: 1,
      inFlight: 0,
      reservedUsd: 0,
      heldUsd: 0,
      closed: false,
    });
  });

  it.each(["say", "announce_to_community"])(
    "normalizes nullable optional fields for %s",
    async (kind) => {
      const { provider } = providerReturning({
        goal: "rest",
        priority: 0.1,
        reason: "x",
        targetCitizenId: null,
        communication: { kind, message: "Hello", toCitizen: null, bulletinLine: null },
      });
      await expect(provider.decide(prompt)).resolves.toMatchObject({
        communication: { kind, message: "Hello" },
      });
    },
  );

  it("preserves a directed bulletin share", () => {
    expect(
      validateDecision({
        goal: "rest",
        reason: "x",
        communication: {
          kind: "share_bulletin_line",
          message: "Observed tree",
          toCitizen: "Maya",
          bulletinLine: 1,
        },
      }).communication,
    ).toEqual({
      kind: "share_bulletin_line",
      message: "Observed tree",
      toCitizen: "Maya",
      bulletinLine: 1,
    });
  });

  it.each([
    { kind: "share_bulletin_line", message: "x", toCitizen: null, bulletinLine: null },
    { kind: "say", message: "x".repeat(201), toCitizen: null, bulletinLine: null },
    { kind: "run_shell", message: "x", toCitizen: null, bulletinLine: null },
  ])("drops malformed communication while retaining a safe goal", (communication) => {
    expect(
      validateDecision({ goal: "rest", reason: "x", communication }).communication,
    ).toBeUndefined();
  });

  it("does not accept model-supplied attribution in the internal intent", () => {
    expect(
      validateDecision({
        goal: "rest",
        reason: "x",
        communication: {
          kind: "say",
          message: "x",
          toCitizen: null,
          bulletinLine: null,
          actorId: "victim",
          communityId: "rival",
        },
      }).communication,
    ).toEqual({ kind: "say", message: "x" });
  });
});
