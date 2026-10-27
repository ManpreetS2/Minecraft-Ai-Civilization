/**
 * Documented local price table for estimated cost safeguards.
 * Not a guarantee of OpenAI billing totals — reconcile against provider invoices separately.
 * Prices are USD per 1M tokens (approximate list rates for planning).
 */
export type CloudModelPrice = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

/** Explicit allowlist of models the OpenAI adapter may call. */
export const OPENAI_ALLOWED_MODELS = [
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  "gpt-4o",
  "gpt-4o-2024-08-06",
  "gpt-4.1-mini",
  "gpt-4.1",
] as const;

export type OpenAiAllowedModel = (typeof OPENAI_ALLOWED_MODELS)[number];

export const OPENAI_MODEL_PRICES: Record<string, CloudModelPrice> = {
  "gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  "gpt-4o-mini-2024-07-18": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  "gpt-4o": { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
  "gpt-4o-2024-08-06": { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
  "gpt-4.1-mini": { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
  "gpt-4.1": { inputPerMillionUsd: 2.0, outputPerMillionUsd: 8.0 },
};

export function isAllowedOpenAiModel(model: string): model is OpenAiAllowedModel {
  return (OPENAI_ALLOWED_MODELS as readonly string[]).includes(model);
}

export function estimateCloudCostUsd(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const price = OPENAI_MODEL_PRICES[params.model] ?? OPENAI_MODEL_PRICES["gpt-4o-mini"]!;
  const input = (Math.max(0, params.inputTokens) / 1_000_000) * price.inputPerMillionUsd;
  const output = (Math.max(0, params.outputTokens) / 1_000_000) * price.outputPerMillionUsd;
  return Number((input + output).toFixed(8));
}
