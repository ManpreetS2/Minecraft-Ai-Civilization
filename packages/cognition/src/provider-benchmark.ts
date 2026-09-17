import { loadConfig } from "@civ/shared";
import { evaluateCognitionVectors } from "./vector-eval.js";
import { COGNITION_VECTORS } from "./vectors.js";
import { BENCHMARK_SCENARIOS } from "./fixtures.js";
import { completeContext, scoreHeuristic, type ScenarioScore } from "./benchmark.js";
import { buildDeliberationMessages } from "./prompt.js";
import { detectEmergencyReflex } from "./reflex.js";
import { resolveCognitionConfig } from "./config.js";
import { OllamaBackend } from "./ollama-backend.js";
import { OpenAICompatibleBackend } from "./openai-compat.js";
import { decideWithFallback, factsFromContext } from "./routed-inference.js";
import { isExperimentalAutoModel } from "./inference-route.js";
import { ollamaTags } from "./ollama-client.js";
import type { InferenceBackend } from "./chat-backend.js";

export type ProviderProfile = {
  id: string;
  provider: "ollama" | "openai_compat";
  model: string;
};

export type ProviderBenchRow = {
  profile: string;
  n: number;
  schemaValidRate: number;
  factConsistencyRate: number;
  goalValidRate: number;
  noLlmCorrectRate: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  failureRate: number;
  fallbackCount: number;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return sorted[mid] ?? 0;
}

export function summarizeProviderRows(rows: Array<ScenarioScore & { fallbackCount?: number; factOk?: boolean; noLlmOk?: boolean; profile: string }>): ProviderBenchRow[] {
  const profiles = [...new Set(rows.map((row) => row.profile))];
  return profiles.map((profile) => {
    const subset = rows.filter((row) => row.profile === profile);
    const latencies = subset.map((row) => row.latencyMs);
    return {
      profile,
      n: subset.length,
      schemaValidRate: subset.filter((row) => row.validSchema).length / subset.length,
      factConsistencyRate: subset.filter((row) => row.factOk !== false).length / subset.length,
      goalValidRate: subset.filter((row) => row.validGoal).length / subset.length,
      noLlmCorrectRate: subset.filter((row) => row.noLlmOk !== false).length / subset.length,
      medianLatencyMs: median(latencies),
      p95LatencyMs: percentile(latencies, 95),
      failureRate: subset.filter((row) => !row.ok).length / subset.length,
      fallbackCount: subset.reduce((sum, row) => sum + (row.fallbackCount ?? 0), 0),
    };
  });
}

export async function scoreBackendProfile(
  profile: ProviderProfile,
  backend: InferenceBackend,
  timeoutMs: number,
  contextSize: number,
): Promise<Array<ScenarioScore & { fallbackCount?: number; factOk?: boolean; noLlmOk?: boolean; profile: string }>> {
  const out: Array<ScenarioScore & { fallbackCount?: number; factOk?: boolean; noLlmOk?: boolean; profile: string }> = [];
  for (const scenario of BENCHMARK_SCENARIOS) {
    const started = Date.now();
    const reflex = detectEmergencyReflex(scenario.view);
    if (reflex) {
      const heuristic = scoreHeuristic(scenario);
      out.push({
        ...heuristic,
        profile: profile.id,
        noLlmOk: Boolean(scenario.expectReflex),
        factOk: true,
        fallbackCount: 0,
      });
      continue;
    }
    const ctx = completeContext(scenario.context, scenario.settlementNeeds);
    const messages = buildDeliberationMessages(ctx, contextSize);
    try {
      const decided = await decideWithFallback({
        route: profile.provider === "ollama" ? "LOCAL" : "CLOUD",
        backends: { [profile.provider]: backend },
        facts: factsFromContext(ctx),
        requestFor: () => ({
          system: messages.system,
          user: messages.user,
          model: profile.model,
          timeoutMs,
          contextSize,
        }),
      });
      const validGoal = scenario.acceptableGoals.includes(decided.value.goal);
      out.push({
        scenario: scenario.id,
        model: decided.model,
        profile: profile.id,
        ok: validGoal,
        validSchema: true,
        validGoal,
        normalized: true,
        unknownGoal: false,
        latencyMs: Date.now() - started,
        goal: decided.value.goal,
        usedContext: true,
        fallbackCount: decided.fallbackCount,
        factOk: true,
        noLlmOk: !scenario.expectReflex,
      });
    } catch (error) {
      out.push({
        scenario: scenario.id,
        model: profile.model,
        profile: profile.id,
        ok: false,
        validSchema: false,
        validGoal: false,
        normalized: false,
        unknownGoal: true,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        usedContext: true,
        fallbackCount: 0,
        factOk: false,
        noLlmOk: !scenario.expectReflex,
      });
    }
  }
  return out;
}

export async function runProviderBenchmark(options: {
  runLocal: boolean;
  runCloud: boolean;
  allowAuto: boolean;
}): Promise<{ markdown: string; rows: ProviderBenchRow[]; deferred: string[] }> {
  const deferred: string[] = [];
  const cfg = resolveCognitionConfig(loadConfig(process.env));
  const vectorEval = evaluateCognitionVectors(COGNITION_VECTORS);
  const rows: Array<ScenarioScore & { fallbackCount?: number; factOk?: boolean; noLlmOk?: boolean; profile: string }> =
    BENCHMARK_SCENARIOS.map((scenario) => ({
      ...scoreHeuristic(scenario),
      profile: "heuristic",
      factOk: true,
      noLlmOk: scenario.expectReflex ? Boolean(detectEmergencyReflex(scenario.view)) : true,
      fallbackCount: 0,
    }));

  if (options.runLocal) {
    const tags = await ollamaTags(cfg.host);
    const present = tags.some((name) => name.includes("qwen3.5:9b") || name.startsWith(cfg.routineModel));
    if (!present) {
      deferred.push("local Ollama qwen3.5:9b is not listed by /api/tags");
    } else {
      const backend = new OllamaBackend(cfg.host);
      rows.push(
        ...(await scoreBackendProfile(
          { id: "ollama:qwen3.5:9b", provider: "ollama", model: cfg.routineModel },
          backend,
          Math.min(cfg.timeoutMs, 20_000),
          cfg.contextSize,
        )),
      );
    }
  } else {
    deferred.push("local Ollama bakeoff skipped (busy or not requested)");
  }

  if (options.runCloud) {
    if (!cfg.openaiCompat.baseUrl || !cfg.openaiCompat.routineModel) {
      deferred.push("cloud bakeoff skipped: OPENAI_COMPAT_BASE_URL / OPENAI_COMPAT_ROUTINE_MODEL unset");
    } else if (isExperimentalAutoModel(cfg.openaiCompat.routineModel) && !options.allowAuto) {
      deferred.push("cloud bakeoff skipped: model=auto is experimental; set a fixed OPENAI_COMPAT_ROUTINE_MODEL");
    } else {
      const backend = new OpenAICompatibleBackend({
        baseUrl: cfg.openaiCompat.baseUrl,
        apiKey: cfg.openaiCompat.apiKey,
        routineModel: cfg.openaiCompat.routineModel,
      });
      rows.push(
        ...(await scoreBackendProfile(
          { id: `openai_compat:${cfg.openaiCompat.routineModel}`, provider: "openai_compat", model: cfg.openaiCompat.routineModel },
          backend,
          Math.min(cfg.openaiCompat.timeoutMs, 20_000),
          cfg.contextSize,
        )),
      );
    }
  } else {
    deferred.push("cloud bakeoff skipped (not requested)");
  }

  const summary = summarizeProviderRows(rows);
  const markdown = [
    "# Cognition provider benchmark",
    "",
    `Deterministic vector eval: ${vectorEval.passed}/${COGNITION_VECTORS.length} passed.`,
    "",
    ...summary.map(
      (row) =>
        `## ${row.profile}\n- n=${row.n}\n- schema-valid=${(row.schemaValidRate * 100).toFixed(0)}%\n- fact-consistency=${(row.factConsistencyRate * 100).toFixed(0)}%\n- goal-valid=${(row.goalValidRate * 100).toFixed(0)}%\n- NO_LLM=${(row.noLlmCorrectRate * 100).toFixed(0)}%\n- median latency=${row.medianLatencyMs.toFixed(0)} ms\n- p95 latency=${row.p95LatencyMs.toFixed(0)} ms\n- failure rate=${(row.failureRate * 100).toFixed(0)}%\n- fallback count=${row.fallbackCount}`,
    ),
    "",
    deferred.length ? `Deferred:\n${deferred.map((line) => `- ${line}`).join("\n")}` : "",
    "",
    "Do not treat one backend as better until both live profiles have completed.",
  ].join("\n");
  return { markdown, rows: summary, deferred };
}
