import { createEvent, parseHumanDirective, resolveDirectiveTargets, type EventBus, type HumanDirective } from "@civ/shared";
import { isDirectiveMode, type DirectiveIntent, type DirectiveMode } from "./directive-parse.js";
import type { CivilizationStore } from "./store.js";

export type RuntimeDirective = HumanDirective & {
  intent: DirectiveIntent;
  args?: Record<string, string>;
  instruction: string;
};

function asRuntime(directive: HumanDirective): RuntimeDirective {
  const args: Record<string, string> = {};
  if (directive.item) args.item = directive.item;
  if (directive.assistTargetId) args.assistTargetId = directive.assistTargetId;
  return {
    ...directive,
    intent: directive.parsedIntent,
    args: Object.keys(args).length > 0 ? args : undefined,
    instruction: directive.rawText,
  };
}

export class DirectiveBoard {
  constructor(
    private readonly store: CivilizationStore,
    private readonly events: EventBus,
    private readonly enabled: () => boolean,
    private readonly runId: () => string,
  ) {}

  list(limit = 40): RuntimeDirective[] {
    return this.store.listDirectives(limit).map(asRuntime);
  }

  activeFor(citizenId: string): RuntimeDirective | undefined {
    return this.list().find(
      (directive) =>
        (directive.status === "ACTIVE" || directive.status === "PENDING") &&
        directive.mode !== "SUGGESTION" &&
        directive.targetIds.includes(citizenId),
    );
  }

  suggestionsFor(citizenId: string): RuntimeDirective[] {
    return this.list().filter(
      (directive) =>
        (directive.status === "ACTIVE" || directive.status === "PENDING") &&
        directive.mode === "SUGGESTION" &&
        directive.targetIds.includes(citizenId),
    );
  }

  issue(input: {
    target?: string;
    selectedIds?: string[];
    mode: DirectiveMode | string;
    instruction: string;
    citizens: Array<{ id: string; name: string }>;
  }): { ok: true; directives: RuntimeDirective[] } | { ok: false; error: string; status?: number } {
    if (!this.enabled()) return { ok: false, error: "Human directives are disabled.", status: 403 };
    if (!isDirectiveMode(String(input.mode))) return { ok: false, error: "Unknown directive mode.", status: 400 };
    const parsed = parseHumanDirective(input.instruction, input.citizens);
    if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
    const selectedIds =
      input.selectedIds && input.selectedIds.length > 0
        ? input.selectedIds
        : resolveTarget(input.target, input.citizens);
    const resolved = resolveDirectiveTargets(parsed, input.citizens, selectedIds);
    if (!resolved.ok) return { ok: false, error: resolved.error, status: 400 };
    const now = new Date().toISOString();
    const directive: HumanDirective = {
      id: crypto.randomUUID(),
      targetIds: resolved.targetIds,
      mode: input.mode as DirectiveMode,
      rawText: input.instruction.trim(),
      parsedIntent: parsed.intent,
      item: parsed.item,
      assistTargetId: parsed.assistName
        ? input.citizens.find((c) => c.name === parsed.assistName)?.id
        : undefined,
      status: "ACTIVE",
      createdAt: now,
      outcomes: Object.fromEntries(resolved.targetIds.map((id) => [id, "ACTIVE" as const])),
    };
    this.store.saveDirective(directive);
    const runtime = asRuntime(directive);
    this.events.emit(
      createEvent(
        "HumanDirectiveIssued",
        {
          id: runtime.id,
          intent: runtime.intent,
          mode: runtime.mode,
          rawText: runtime.rawText,
          targetIds: runtime.targetIds,
          runId: this.runId(),
        },
        runtime.targetIds[0],
      ),
    );
    return { ok: true, directives: [runtime] };
  }

  mark(id: string, status: HumanDirective["status"], failureReason?: string, _verified?: string): void {
    const existing = this.store.getDirective(id);
    if (!existing) return;
    existing.status = status;
    if (failureReason) existing.failureReason = failureReason;
    if (status === "COMPLETED" || status === "FAILED" || status === "CANCELLED" || status === "REJECTED") {
      existing.completedAt = new Date().toISOString();
    }
    for (const key of Object.keys(existing.outcomes)) {
      existing.outcomes[key] = status;
    }
    this.store.saveDirective(existing);
    const type =
      status === "COMPLETED"
        ? "HumanDirectiveCompleted"
        : status === "CANCELLED"
          ? "HumanDirectiveCancelled"
          : status === "REJECTED"
            ? "HumanDirectiveRejected"
            : "HumanDirectiveFailed";
    this.events.emit(createEvent(type, { id, status, failureReason, verified: _verified }, existing.targetIds[0]));
  }

  cancel(id: string): { ok: true; directive: RuntimeDirective } | { ok: false; error: string; status?: number } {
    const existing = this.store.getDirective(id);
    if (!existing) return { ok: false, error: "Directive not found.", status: 404 };
    this.mark(id, "CANCELLED", "cancelled by human");
    return { ok: true, directive: asRuntime(this.store.getDirective(id) ?? existing) };
  }

  cancelForCitizen(citizenId: string, reason = "cancelled"): RuntimeDirective[] {
    const cancelled: RuntimeDirective[] = [];
    for (const directive of this.list()) {
      if (directive.status !== "ACTIVE" && directive.status !== "PENDING") continue;
      if (!directive.targetIds.includes(citizenId)) continue;
      directive.outcomes[citizenId] = "CANCELLED";
      const remaining = Object.values(directive.outcomes);
      if (remaining.every((status) => status !== "ACTIVE" && status !== "PENDING")) {
        this.mark(directive.id, "CANCELLED", reason);
      } else {
        this.store.saveDirective(directive);
      }
      cancelled.push(asRuntime(this.store.getDirective(directive.id) ?? directive));
    }
    return cancelled;
  }
}

function resolveTarget(target: string | undefined, citizens: Array<{ id: string; name: string }>): string[] {
  if (!target || /^(everyone|\*|all)$/i.test(target)) return [];
  const match = citizens.find(
    (c) => c.id === target || c.name.toLowerCase() === target.toLowerCase() || c.id === `citizen_${target.toLowerCase()}`,
  );
  return match ? [match.id] : [];
}
