export type CloudDecisionRecord = {
  id: string;
  citizenId?: string;
  citizenName: string;
  provider: string;
  model: string;
  requestId?: string;
  trigger: string;
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  ok: boolean;
  failureReason?: string;
  acceptedGoal?: string;
  rejectedGoal?: string;
  httpStatus?: number;
};

export class CloudDecisionLedger {
  private readonly records: CloudDecisionRecord[] = [];

  constructor(private readonly maxRecent = 200) {}

  push(record: CloudDecisionRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxRecent) {
      this.records.shift();
    }
  }

  recent(limit = 50): CloudDecisionRecord[] {
    return this.records.slice(-limit);
  }

  /** Redacted JSON for tests/logs — never includes API keys. */
  toRedactedJson(limit = 20): string {
    return JSON.stringify(this.recent(limit));
  }
}
