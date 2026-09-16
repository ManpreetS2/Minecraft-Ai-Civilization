import type { AgentManager } from "@civ/agent-core";
import { createEvent, type HumanDirective } from "@civ/shared";

/**
 * Observer-side request only. Does not teleport, spawn items, or call Mineflayer.
 *
 * TODO(runtime-integration): AgentManager / cognition should read active directives
 * from GET /api/directives (or a shared DirectiveBoard) during planning:
 * - SUGGESTION → cognition context only
 * - DIRECTIVE → high-priority goal unless emergency / impossible / missing tools
 * - ADMIN_OVERRIDE → cancel current high-level task, then prioritize the intent
 * Completion must call DirectiveBoard.recordOutcome after a verified world result.
 */
export function requestDirectiveFollow(manager: AgentManager, directive: HumanDirective): void {
  const everyone = directive.targetIds.length > 1;
  for (const citizen of manager.list()) {
    if (!directive.targetIds.includes(citizen.record.id)) continue;
    citizen.record.reason = humanReason(directive);
    if (directive.mode === "ADMIN_OVERRIDE" || directive.parsedIntent === "stop_current_task") {
      citizen.abort?.abort();
    }
    if (directive.mode !== "SUGGESTION") {
      citizen.record.currentGoal = directive.parsedIntent;
    }
  }
  manager.events.emit(
    createEvent(
      "HumanDirectiveIssued",
      {
        id: directive.id,
        intent: directive.parsedIntent,
        goal: directive.parsedIntent,
        rawText: directive.rawText,
        mode: directive.mode,
        everyone,
        targetIds: directive.targetIds,
      },
      directive.targetIds[0],
    ),
  );
}

export function requestCitizenStop(manager: AgentManager, citizenId: string): boolean {
  const citizen = manager.list().find((c) => c.record.id === citizenId);
  if (!citizen) return false;
  citizen.abort?.abort();
  citizen.record.reason = "Human asked this citizen to stop.";
  citizen.record.currentGoal = "stop_current_task";
  return true;
}

export function requestDirectiveCancel(manager: AgentManager, directive: HumanDirective): void {
  for (const citizen of manager.list()) {
    if (!directive.targetIds.includes(citizen.record.id)) continue;
    citizen.abort?.abort();
  }
  manager.events.emit(
    createEvent(
      "HumanDirectiveCancelled",
      { id: directive.id, intent: directive.parsedIntent, rawText: directive.rawText },
      directive.targetIds[0],
    ),
  );
}

function humanReason(directive: HumanDirective): string {
  if (directive.mode === "SUGGESTION") return `Human suggestion: ${directive.rawText}`;
  if (directive.mode === "ADMIN_OVERRIDE") return `Human override: ${directive.rawText}`;
  return `Human directive: ${directive.rawText}`;
}
