import { extractJson, validateCognitionDecision, type CognitionDecision } from "./schema.js";
import { validateReflectionProposal, type ReflectionProposal } from "./reflection-schema.js";
import { guardDecisionFacts, personalEdibleCount, type VerifiedFacts } from "./fact-guards.js";
import type { ChatRequest, InferenceBackend } from "./chat-backend.js";
import { providerOrder, type InferenceRoute, type ProviderKind } from "./inference-route.js";
import type { CognitionContext } from "@civ/psychology";

export type RoutedAttempt = {
  provider: string;
  model: string;
  error?: string;
};

export type RoutedSuccess<T> = {
  value: T;
  provider: string;
  model: string;
  fallbackCount: number;
  attempted: RoutedAttempt[];
  promptTokens?: number;
  evalTokens?: number;
  normalized: true;
};

export async function decideWithFallback(args: {
  backends: Partial<Record<ProviderKind, InferenceBackend>>;
  route: InferenceRoute;
  requestFor: (backend: InferenceBackend) => ChatRequest;
  facts?: VerifiedFacts;
  secrets?: string[];
}): Promise<RoutedSuccess<CognitionDecision>> {
  return runValidated(args, (content) => {
    const decision = validateCognitionDecision(extractJson(content));
    if (args.facts) {
      const guarded = guardDecisionFacts({ goal: decision.goal, reason: decision.reason, facts: args.facts });
      if (!guarded.ok) {
        throw new Error(`FACT_GUARD:${guarded.violations[0]?.code ?? "INVENTED_FACT"}`);
      }
    }
    return decision;
  });
}

export async function reflectWithFallback(args: {
  backends: Partial<Record<ProviderKind, InferenceBackend>>;
  route: InferenceRoute;
  requestFor: (backend: InferenceBackend) => ChatRequest;
  secrets?: string[];
}): Promise<RoutedSuccess<ReflectionProposal>> {
  return runValidated(args, (content) => validateReflectionProposal(extractJson(content)));
}

async function runValidated<T>(
  args: {
    backends: Partial<Record<ProviderKind, InferenceBackend>>;
    route: InferenceRoute;
    requestFor: (backend: InferenceBackend) => ChatRequest;
    secrets?: string[];
  },
  parse: (content: string) => T,
): Promise<RoutedSuccess<T>> {
  const order = providerOrder(args.route)
    .map((kind) => args.backends[kind])
    .filter((backend): backend is InferenceBackend => Boolean(backend?.configured));
  if (order.length === 0) {
    throw new Error("No inference backend is configured for this route.");
  }
  const attempted: RoutedAttempt[] = [];
  let lastError: unknown;
  for (const [index, backend] of order.entries()) {
    const request = args.requestFor(backend);
    try {
      const chat = await backend.chat(request);
      const value = parse(chat.content);
      attempted.push({ provider: backend.name, model: chat.model });
      return {
        value,
        provider: backend.name,
        model: chat.model,
        fallbackCount: index,
        attempted,
        promptTokens: chat.promptTokens,
        evalTokens: chat.evalTokens,
        normalized: true,
      };
    } catch (error) {
      attempted.push({
        provider: backend.name,
        model: request.model,
        error: redact(error instanceof Error ? error.message : String(error), args.secrets ?? []),
      });
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All inference backends failed validation.");
}

export function factsFromContext(ctx: CognitionContext): VerifiedFacts {
  const personalInventory = ctx.inventorySummary.map((line) => {
    const match = line.match(/^(.*?)(?:\s+x(\d+))?$/i);
    return { name: (match?.[1] ?? line).trim(), count: Number(match?.[2] ?? 1) };
  });
  return {
    hunger: ctx.immediateNeeds.hunger,
    health: ctx.immediateNeeds.health,
    personalInventory,
    nearbyHostiles: ctx.nearbyWorldState.entities
      .filter((name) => /creeper|zombie|skeleton|spider|enderman/i.test(name))
      .map((name) => ({ name, distance: 6 })),
  };
}

export function personalFoodFromContext(ctx: CognitionContext): number {
  return personalEdibleCount(factsFromContext(ctx).personalInventory);
}

function redact(text: string, secrets: string[]): string {
  let next = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) next = next.split(secret).join("[redacted]");
  }
  return next.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}
