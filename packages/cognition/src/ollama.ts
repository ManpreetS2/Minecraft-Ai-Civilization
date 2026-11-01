import { sanitizePromptText } from "@civ/shared";
import type { CognitionPrompt, CognitionProvider, HighLevelDecision } from "./schema.js";
import { extractJson, validateDecision } from "./schema.js";

export class OllamaProvider implements CognitionProvider {
  readonly name = "ollama";

  constructor(
    private readonly host: string,
    private readonly model: string,
  ) {}

  async decide(prompt: CognitionPrompt, timeoutMs = 45_000): Promise<HighLevelDecision> {
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
          think: false,
          options: { temperature: 0.2, num_predict: 96 },
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

/** Room for 5 retrieved memories, 8 persistent facts and a few human suggestions, so one group cannot displace another. */
const MAX_PROMPT_MEMORIES = 16;

export function formatPrompt(prompt: CognitionPrompt): string {
  return [
    `Citizen: ${prompt.citizenName}`,
    prompt.sharedObjective ? `Shared objective: ${prompt.sharedObjective}` : "",
    prompt.personalityContext ?? "",
    `Health: ${prompt.health ?? "unknown"} Hunger: ${prompt.hunger ?? "unknown"}`,
    `Occupation: ${prompt.occupation ?? "unassigned"}`,
    `Inventory: ${prompt.inventory.slice(0, 12).join(", ") || "empty"}`,
    `Settlement needs: ${prompt.settlementNeeds.join(", ") || "none"}`,
    `Nearby citizens: ${prompt.nearbyCitizens.join(", ") || "none"}`,
    prompt.bulletin ?? "",
    `Relevant memories: ${prompt.memories.slice(0, MAX_PROMPT_MEMORIES).map(sanitizePromptText).join(" | ") || "none"}`,
    prompt.gameFacts?.length ? `Relevant Minecraft facts:\n- ${prompt.gameFacts.slice(0, 8).join("\n- ")}` : "",
    prompt.communicationGuide ?? "",
    "Choose the single most useful high-level goal.",
  ]
    .filter(Boolean)
    .join("\n");
}
