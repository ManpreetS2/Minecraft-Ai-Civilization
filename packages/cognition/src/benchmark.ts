import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, workspaceRoot } from "@civ/shared";
import { BENCHMARK_SCENARIOS, type BenchmarkScenario } from "./fixtures.js";
import { heuristicDeliberation } from "./heuristic-deliberation.js";
import { ollamaChat, ollamaTags, parseModelJson } from "./ollama-client.js";
import { buildDeliberationMessages } from "./prompt.js";
import { detectEmergencyReflex } from "./reflex.js";
import { validateCognitionDecision, type CognitionDecision } from "./schema.js";
import type { CognitionContext } from "@civ/psychology";
import { resolveCognitionConfig } from "./config.js";

export type ScenarioScore = {
  scenario: string;
  model: string;
  ok: boolean;
  validSchema: boolean;
  validGoal: boolean;
  normalized: boolean;
  unknownGoal: boolean;
  latencyMs: number;
  goal?: string;
  error?: string;
  usedContext: boolean;
};

export function completeContext(partial: BenchmarkScenario["context"], needs: string[]): CognitionContext {
  return {
    citizen: partial.citizen,
    immediateNeeds: partial.immediateNeeds ?? { concerns: [] },
    currentGoal: partial.currentGoal,
    currentTask: partial.currentTask,
    inventorySummary: partial.inventorySummary ?? [],
    nearbyWorldState: partial.nearbyWorldState ?? { entities: [] },
    mood: partial.mood ?? {
      citizenId: partial.citizen.id,
      moodValence: 0,
      stress: 0.2,
      fear: 0,
      anger: 0,
      sadness: 0,
      positiveAffect: 0.4,
      confidence: 0.4,
      currentConcerns: [],
      updatedAt: "2026-09-16T12:00:00.000Z",
    },
    activeAffect: partial.activeAffect ?? { dominant: "neutral", intensity: 0 },
    relevantMemories: partial.relevantMemories ?? [],
    relevantSocialBeliefs: partial.relevantSocialBeliefs ?? [],
    activityFamiliarity: partial.activityFamiliarity ?? {},
    learnedAssociations: partial.learnedAssociations ?? [],
    habits: partial.habits ?? [],
    recentImportantEvents: partial.recentImportantEvents ?? [],
    settlementNeeds: partial.settlementNeeds ?? needs,
    uncertainty: partial.uncertainty ?? 0.3,
    uncertainties: partial.uncertainties ?? [],
  };
}

export function scoreHeuristic(scenario: BenchmarkScenario): ScenarioScore {
  const started = Date.now();
  const reflex = detectEmergencyReflex(scenario.view);
  if (reflex) {
    return {
      scenario: scenario.id,
      model: "reflex",
      ok: Boolean(scenario.expectReflex),
      validSchema: true,
      validGoal: scenario.acceptableGoals.includes(reflex.goal),
      normalized: false,
      unknownGoal: false,
      latencyMs: Date.now() - started,
      goal: reflex.goal,
      usedContext: false,
    };
  }
  const ctx = completeContext(scenario.context, scenario.settlementNeeds);
  const decision = heuristicDeliberation(ctx);
  return scoreDecision("heuristic", scenario, decision, Date.now() - started, false);
}

function scoreDecision(
  model: string,
  scenario: BenchmarkScenario,
  decision: CognitionDecision,
  latencyMs: number,
  normalized: boolean,
): ScenarioScore {
  const validGoal = scenario.acceptableGoals.includes(decision.goal);
  return {
    scenario: scenario.id,
    model,
    ok: validGoal,
    validSchema: true,
    validGoal,
    normalized,
    unknownGoal: false,
    latencyMs,
    goal: decision.goal,
    usedContext: scenario.context.relevantMemories?.length ? decision.reason.length > 0 : true,
  };
}

export async function scoreLiveModel(model: string, scenario: BenchmarkScenario, host: string, timeoutMs: number, contextSize: number): Promise<ScenarioScore> {
  const started = Date.now();
  const reflex = detectEmergencyReflex(scenario.view);
  if (scenario.expectReflex && reflex) {
    return scoreHeuristic(scenario);
  }
  const ctx = completeContext(scenario.context, scenario.settlementNeeds);
  const messages = buildDeliberationMessages(ctx, contextSize);
  let parsed: unknown;
  try {
    const chat = await ollamaChat({
      host,
      model,
      system: messages.system,
      user: messages.user,
      timeoutMs,
      contextSize,
    });
    parsed = parseModelJson(chat.content);
    const decision = validateCognitionDecision(parsed);
    return scoreDecision(model, scenario, decision, Date.now() - started, true);
  } catch (error) {
    return {
      scenario: scenario.id,
      model,
      ok: false,
      validSchema: false,
      validGoal: false,
      normalized: false,
      unknownGoal: true,
      latencyMs: Date.now() - started,
      error: `${error instanceof Error ? error.message : String(error)}${parsed === undefined ? "" : ` | raw=${JSON.stringify(parsed).slice(0, 240)}`}`,
      usedContext: false,
    };
  }
}

export function summarize(scores: ScenarioScore[]): string {
  const models = [...new Set(scores.map((s) => s.model))];
  const lines = ["# Cognition benchmark", ""];
  for (const model of models) {
    const rows = scores.filter((s) => s.model === model);
    const ok = rows.filter((s) => s.ok).length;
    const schema = rows.filter((s) => s.validSchema).length;
    const avg = rows.reduce((sum, s) => sum + s.latencyMs, 0) / Math.max(1, rows.length);
    lines.push(`## ${model}`);
    lines.push(`- fixture pass: ${ok}/${rows.length}`);
    lines.push(`- schema valid: ${schema}/${rows.length}`);
    lines.push(`- mean latency: ${avg.toFixed(0)} ms`);
    lines.push("");
  }
  lines.push("This report does not score hidden chain-of-thought.");
  lines.push("Qwen 9B is the intended routine default only after live fixture latency/schema look acceptable.");
  return lines.join("\n");
}

export async function runBenchmark(): Promise<{ scores: ScenarioScore[]; markdown: string }> {
  const scores: ScenarioScore[] = BENCHMARK_SCENARIOS.map(scoreHeuristic);
  const cfg = resolveCognitionConfig(loadConfig(process.env));
  const available = await ollamaTags(cfg.host);
  const candidates = [cfg.routineModel, "qwen3.5:4b"].filter((name, i, all) => all.indexOf(name) === i);
  if (process.env.COGNITION_BENCH_ALL === "true") {
    candidates.push("qwen3:14b", cfg.reflectionModel);
  }
  for (const model of candidates) {
    const present = available.some((name) => name === model || name.startsWith(`${model}:`) || name.startsWith(model));
    if (!present) continue;
    for (const scenario of BENCHMARK_SCENARIOS) {
      scores.push(await scoreLiveModel(model, scenario, cfg.host, Math.min(cfg.timeoutMs, 20_000), cfg.contextSize));
    }
  }
  return { scores, markdown: summarize(scores) };
}

export function writeBenchmarkArtifacts(
  scores: ScenarioScore[],
  markdown: string,
  dir = resolve(workspaceRoot(), "artifacts"),
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "cognition-benchmark.json"), JSON.stringify({ generatedAt: new Date().toISOString(), scores }, null, 2));
  writeFileSync(resolve(dir, "cognition-benchmark.md"), markdown);
}
