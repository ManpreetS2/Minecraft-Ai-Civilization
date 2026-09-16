import type { CognitionMode } from "./router.js";
import type { Goal } from "./goals.js";

export type DecisionLog = {
  citizenId: string;
  model?: string;
  mode: CognitionMode;
  latencyMs?: number;
  queueWaitMs?: number;
  accepted: boolean;
  rejectedReason?: string;
  normalized: boolean;
  goal?: Goal;
  reason?: string;
  contextAgeMs?: number;
  memoryCount: number;
  schemaError?: string;
  promptTokens?: number;
  evalTokens?: number;
  timestamp: string;
};

export class DecisionLogBuffer {
  private readonly entries: DecisionLog[] = [];

  constructor(private readonly max = 200) {}

  record(entry: DecisionLog): void {
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.shift();
  }

  list(limit = 50): DecisionLog[] {
    return this.entries.slice(-limit);
  }
}
