import { randomUUID } from "node:crypto";
import {
  isDirectiveIntent,
  isDirectiveMode,
  parseHumanDirective,
  resolveDirectiveTargets,
  type DirectiveMode,
  type DirectiveStatus,
  type HumanDirective,
} from "./directives.js";

export class DirectiveBoard {
  private readonly items = new Map<string, HumanDirective>();

  constructor(private readonly enabled = true) {}

  list(): HumanDirective[] {
    return [...this.items.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  get(id: string): HumanDirective | undefined {
    return this.items.get(id);
  }

  create(input: {
    rawText: string;
    mode: DirectiveMode | string;
    selectedIds: string[];
    citizens: Array<{ id: string; name: string }>;
  }): { ok: true; directive: HumanDirective } | { ok: false; error: string; status?: number } {
    if (!this.enabled) return { ok: false, error: "Human directives are disabled.", status: 403 };
    if (!isDirectiveMode(input.mode)) return { ok: false, error: "Unknown directive mode.", status: 400 };
    const parsed = parseHumanDirective(input.rawText, input.citizens);
    if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
    if (!isDirectiveIntent(parsed.intent)) return { ok: false, error: "Unsafe intent.", status: 400 };
    const resolved = resolveDirectiveTargets(parsed, input.citizens, input.selectedIds);
    if (!resolved.ok) return { ok: false, error: resolved.error, status: 400 };
    const assistTargetId = parsed.assistName
      ? input.citizens.find((c) => c.name === parsed.assistName)?.id
      : undefined;
    const now = new Date().toISOString();
    const directive: HumanDirective = {
      id: randomUUID(),
      targetIds: resolved.targetIds,
      mode: input.mode,
      rawText: input.rawText.trim(),
      parsedIntent: parsed.intent,
      item: parsed.item,
      assistTargetId,
      status: "ACTIVE",
      createdAt: now,
      outcomes: Object.fromEntries(resolved.targetIds.map((id) => [id, "ACTIVE" as DirectiveStatus])),
    };
    this.items.set(directive.id, directive);
    return { ok: true, directive };
  }

  cancel(id: string): { ok: true; directive: HumanDirective } | { ok: false; error: string; status?: number } {
    const existing = this.items.get(id);
    if (!existing) return { ok: false, error: "Directive not found.", status: 404 };
    existing.status = "CANCELLED";
    existing.completedAt = new Date().toISOString();
    for (const key of Object.keys(existing.outcomes)) existing.outcomes[key] = "CANCELLED";
    return { ok: true, directive: existing };
  }

  cancelForCitizen(citizenId: string): HumanDirective[] {
    const cancelled: HumanDirective[] = [];
    for (const directive of this.items.values()) {
      if (directive.status !== "ACTIVE" && directive.status !== "PENDING") continue;
      if (!directive.targetIds.includes(citizenId)) continue;
      directive.outcomes[citizenId] = "CANCELLED";
      const remaining = Object.values(directive.outcomes);
      if (remaining.every((status) => status !== "ACTIVE" && status !== "PENDING")) {
        directive.status = "CANCELLED";
        directive.completedAt = new Date().toISOString();
      }
      cancelled.push(directive);
    }
    return cancelled;
  }

  /**
   * Runtime integration point. Do not call from the dashboard to fake success.
   * Completion must follow a verified simulation outcome.
   */
  recordOutcome(id: string, citizenId: string, status: DirectiveStatus, failureReason?: string): void {
    const existing = this.items.get(id);
    if (!existing) return;
    existing.outcomes[citizenId] = status;
    if (failureReason) existing.failureReason = failureReason;
    const values = Object.values(existing.outcomes);
    if (values.every((value) => value === "COMPLETED")) {
      existing.status = "COMPLETED";
      existing.completedAt = new Date().toISOString();
    } else if (
      values.some((value) => value === "FAILED" || value === "REJECTED") &&
      values.every((value) => value !== "ACTIVE" && value !== "PENDING")
    ) {
      existing.status = "FAILED";
      existing.completedAt = new Date().toISOString();
    }
  }
}
