export const INFERENCE_ROUTES = ["LOCAL", "CLOUD", "LOCAL_THEN_CLOUD", "CLOUD_THEN_LOCAL"] as const;
export type InferenceRoute = (typeof INFERENCE_ROUTES)[number];
export type ProviderKind = "ollama" | "openai_compat";

export const DEFAULT_INFERENCE_ROUTE: InferenceRoute = "LOCAL";

/**
 * Explicit provider order. Cloud is never inserted unless the route says so.
 */
export function providerOrder(route: InferenceRoute): ProviderKind[] {
  switch (route) {
    case "CLOUD":
      return ["openai_compat"];
    case "LOCAL_THEN_CLOUD":
      return ["ollama", "openai_compat"];
    case "CLOUD_THEN_LOCAL":
      return ["openai_compat", "ollama"];
    case "LOCAL":
    default:
      return ["ollama"];
  }
}

export function parseInferenceRoute(raw: unknown): InferenceRoute {
  if (typeof raw === "string" && INFERENCE_ROUTES.includes(raw as InferenceRoute)) {
    return raw as InferenceRoute;
  }
  return DEFAULT_INFERENCE_ROUTE;
}

export function isExperimentalAutoModel(model: string): boolean {
  return model.trim().toLowerCase() === "auto";
}
