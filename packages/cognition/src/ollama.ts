import type { CognitionPrompt, CognitionProvider, HighLevelDecision } from "./schema.js";
import { extractJson, validateDecision } from "./schema.js";

export class OllamaProvider implements CognitionProvider {
  readonly name = "ollama";

  constructor(
    private readonly host: string,
    private readonly model: string,
  ) {}

  async decide(prompt: CognitionPrompt, timeoutMs = 15_000): Promise<HighLevelDecision> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.host.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: "json",
          messages: [
            {
              role: "system",
              content:
                "You are a high-level advisor for one Minecraft citizen. Reply with JSON only: {\"goal\",\"priority\",\"reason\"}. Do not include hidden chain-of-thought. Reason must be one short sentence.",
            },
            {
              role: "user",
              content: formatPrompt(prompt),
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Ollama HTTP ${response.status}`);
      }
      const body = (await response.json()) as { message?: { content?: string } };
      const content = body.message?.content ?? "";
      return validateDecision(extractJson(content));
    } finally {
      clearTimeout(timer);
    }
  }
}

export function formatPrompt(prompt: CognitionPrompt): string {
  return [
    `Citizen: ${prompt.citizenName}`,
    `Health: ${prompt.health ?? "unknown"} Hunger: ${prompt.hunger ?? "unknown"}`,
    `Occupation: ${prompt.occupation ?? "unassigned"}`,
    `Inventory: ${prompt.inventory.slice(0, 12).join(", ") || "empty"}`,
    `Settlement needs: ${prompt.settlementNeeds.join(", ") || "none"}`,
    `Nearby citizens: ${prompt.nearbyCitizens.join(", ") || "none"}`,
    `Relevant memories: ${prompt.memories.slice(0, 5).join(" | ") || "none"}`,
    "Choose the single most useful high-level goal.",
  ].join("\n");
}
