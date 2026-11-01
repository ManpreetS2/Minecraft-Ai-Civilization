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

function priceForModel(model: string): CloudModelPrice | undefined {
  if (!Object.hasOwn(OPENAI_MODEL_PRICES, model)) return undefined;
  const price = OPENAI_MODEL_PRICES[model]!;
  const valid = [price.inputPerMillionUsd, price.outputPerMillionUsd].every((rate) => Number.isFinite(rate) && rate > 0);
  return valid ? price : undefined;
}

export function hasCloudModelPrice(model: string): boolean {
  return priceForModel(model) !== undefined;
}

function rawCostUsd(price: CloudModelPrice, inputTokens: number, outputTokens: number): number {
  const input = (Math.max(0, inputTokens) / 1_000_000) * price.inputPerMillionUsd;
  const output = (Math.max(0, outputTokens) / 1_000_000) * price.outputPerMillionUsd;
  return input + output;
}

export function estimateCloudCostUsd(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const price = priceForModel(params.model);
  if (!price) {
    throw new Error(`No configured price for model '${params.model}'`);
  }
  return Number(rawCostUsd(price, params.inputTokens, params.outputTokens).toFixed(8));
}

/** Rounded up so it can never sit below estimateCloudCostUsd for the same counts. NaN when unpriced. */
export function boundCloudAttemptCostUsd(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const price = priceForModel(params.model);
  if (!price) return Number.NaN;
  return Math.ceil(rawCostUsd(price, params.inputTokens, params.outputTokens) * 1e8) / 1e8;
}
