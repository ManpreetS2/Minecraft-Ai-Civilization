import { z } from "zod";

export const GOALS = [
  "gather_food",
  "gather_wood",
  "mine_stone",
  "craft_tools",
  "build_shelter",
  "help_citizen",
  "deposit",
  "rest",
  "explore",
  "defend",
] as const;

export const DecisionSchema = z.object({
  goal: z.enum(GOALS),
  priority: z.number().min(0).max(1),
  reason: z.string().min(1).max(280),
  targetCitizenId: z.string().optional(),
});

export type HighLevelDecision = z.infer<typeof DecisionSchema>;

export type CognitionPrompt = {
  citizenName: string;
  health?: number;
  hunger?: number;
  occupation?: string;
  inventory: string[];
  settlementNeeds: string[];
  memories: string[];
  nearbyCitizens: string[];
};

export type CognitionProvider = {
  readonly name: string;
  decide(prompt: CognitionPrompt, timeoutMs?: number): Promise<HighLevelDecision>;
};

export function validateDecision(input: unknown): HighLevelDecision {
  return DecisionSchema.parse(input);
}

export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) {
    throw new Error("No JSON object in model output");
  }
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}
