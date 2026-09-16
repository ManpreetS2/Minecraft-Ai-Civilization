import type { SimEvent } from "./events.js";
import { translateError } from "./error-copy.js";
import {
  citizenDisplayName,
  failedTask,
  formatLocalTime,
  friendlyGoal,
  friendlyItem,
  friendlyNeed,
  friendlyTask,
  relationshipPercent,
  sentenceFromType,
} from "./friendly-names.js";

export type PresentedEventKind = "success" | "warning" | "failure" | "social" | "info" | "human";
export type EventImportance = "MAJOR" | "NORMAL" | "DEBUG";

export type PresentableEvent = {
  type: string;
  timestamp: string;
  citizenId?: string;
  payload?: Record<string, unknown>;
};

export type PresentedEvent = {
  headline: string;
  subtext?: string;
  kind: PresentedEventKind;
  icon: string;
  importance: EventImportance;
  timeLabel: string;
  citizenName?: string;
  count?: number;
  technical: {
    type: string;
    citizenId?: string;
    timestamp: string;
    payload: Record<string, unknown>;
    ids?: string[];
  };
};

export function presentEvent(event: PresentableEvent, names: Record<string, string> = {}): PresentedEvent {
  const name = citizenDisplayName(event.citizenId, names);
  const payload = event.payload ?? {};
  const timeLabel = formatLocalTime(event.timestamp);
  const technical = {
    type: event.type,
    citizenId: event.citizenId,
    timestamp: event.timestamp,
    payload,
  };
  const type = String(event.type);
  const task = friendlyTask(payload.task);
  const reason = typeof payload.reason === "string" ? payload.reason : undefined;
  const error = typeof payload.error === "string" ? payload.error : undefined;
  const other = otherName(payload, names);
  const translated = error ? translateError(error, payload.task ?? payload.action) : undefined;
  const importance = eventImportance(type, payload);
  const icon = eventIcon(type, importance);
  const base = { timeLabel, citizenName: name, technical, importance, icon };

  switch (type) {
    case "TaskStarted":
      return {
        ...base,
        headline: `${name} started ${task}.`,
        subtext: reason ? `Reason: ${humanReason(reason)}` : undefined,
        kind: "info",
      };
    case "TaskCompleted":
      return { ...base, headline: `${name} finished ${task}.`, kind: "success" };
    case "TaskFailed":
      return {
        ...base,
        headline: translated?.headline ? `${name} ${translated.headline}.` : `${name} couldn't ${failedTask(payload.task)}.`,
        subtext: translated?.subtext,
        kind: "failure",
      };
    case "CitizenConnected":
      return { ...base, headline: `${name} entered the world.`, kind: "success" };
    case "CitizenSpawned":
      return { ...base, headline: `${name} spawned in the world.`, kind: "success" };
    case "CitizenDisconnected": {
      const timeout = /timeout|keepalive|timed out/i.test(String(payload.reason ?? error ?? ""));
      return {
        ...base,
        headline: timeout ? `${name} lost connection to the Minecraft server.` : `${name} disconnected.`,
        subtext: timeout ? "Trying to reconnect..." : reason,
        kind: "warning",
      };
    }
    case "CitizenKicked":
      return { ...base, headline: `${name} was kicked from the world.`, subtext: reason, kind: "warning" };
    case "CitizenDied":
    case "CitizenBodyDied": {
      const permanent = payload.permanent === true || payload.permadeath === true || payload.terminal === true;
      return {
        ...base,
        headline: permanent ? `${name} died permanently.` : `${name} died.`,
        subtext: formatPosition(payload.position),
        kind: "failure",
      };
    }
    case "CitizenInjured":
      return { ...base, headline: `${name} was hurt.`, kind: "warning" };
    case "CitizenRespawned":
      return { ...base, headline: `${name} respawned and returned to the simulation.`, kind: "warning" };
    case "ConstructionStarted":
      return { ...base, headline: "Construction of the starter shelter began.", kind: "info" };
    case "ConstructionProgress": {
      const placed = Number(payload.placed ?? payload.placedBlocks ?? 0);
      const total = Number(payload.total ?? payload.totalBlocks ?? 0);
      return {
        ...base,
        headline: `Starter shelter: ${placed} / ${total} blocks complete.`,
        kind: "info",
      };
    }
    case "ConstructionCompleted":
      return { ...base, headline: "The first shelter was completed.", kind: "success" };
    case "SettlementProjectCreated":
      return { ...base, headline: "The settlement started planning its first shelter.", kind: "info" };
    case "ConversationOccurred":
      return {
        ...base,
        headline: other ? `${name} spoke with ${other}.` : `${name} spoke.`,
        subtext: typeof payload.message === "string" ? payload.message : undefined,
        kind: "social",
      };
    case "RelationshipChanged":
      return {
        ...base,
        headline: other ? `${name}'s relationship with ${other} changed.` : `${name}'s relationship changed.`,
        subtext: relationshipSubtext(payload),
        kind: "social",
      };
    case "LLMDecisionMade":
      return {
        ...base,
        headline: `${name} reconsidered what to do.`,
        subtext: [
          payload.goal ? `Goal: ${capitalize(friendlyGoal(payload.goal))}` : undefined,
          reason ? `Reason: ${humanReason(reason)}` : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
        kind: "info",
      };
    case "LLMSkipped":
      return { ...base, headline: `${name} could not get a high-level decision.`, subtext: error, kind: "warning" };
    case "ErrorOccurred": {
      const lost = translateError(error ?? reason ?? "", payload.task);
      return {
        ...base,
        headline: lost.headline ? `${name} ${lost.headline}.` : `Something went wrong while controlling ${name}.`,
        subtext: lost.subtext,
        kind: "failure",
      };
    }
    case "ItemCrafted":
    case "CraftingCompleted":
      return { ...base, headline: `${name} crafted ${friendlyItem(payload.item ?? payload.name)}.`, kind: "success" };
    case "CraftingFailed": {
      const missing = payload.missing ?? payload.need;
      return {
        ...base,
        headline: `${name} couldn't craft ${friendlyItem(payload.item ?? payload.name)}.`,
        subtext: typeof missing === "string" ? `Missing ${friendlyItem(missing)}.` : translated?.subtext,
        kind: "failure",
      };
    }
    case "ResourceCollected": {
      const count = Number(payload.count ?? 1);
      const item = String(payload.name ?? payload.item ?? "a resource");
      return {
        ...base,
        headline: `${name} collected ${count} ${friendlyItem(item, count)}.`,
        kind: "success",
        count,
      };
    }
    case "ItemDeposited": {
      const count = Number(payload.count ?? 1);
      return {
        ...base,
        headline: `${name} stored ${count} ${friendlyItem(payload.item ?? payload.name, count)} in the shared chest.`,
        kind: "success",
        count,
      };
    }
    case "ItemWithdrawn": {
      const count = Number(payload.count ?? 1);
      return {
        ...base,
        headline: `${name} took ${count} ${friendlyItem(payload.item ?? payload.name, count)} from the shared chest.`,
        kind: "info",
        count,
      };
    }
    case "ItemTransferred":
    case "ItemTransferCompleted": {
      const count = Number(payload.count ?? 1);
      const item = friendlyItem(payload.item ?? payload.name, count);
      const receiver = citizenDisplayName(String(payload.receiver ?? payload.other ?? payload.otherId ?? ""), names);
      return {
        ...base,
        headline: `${name} gave ${receiver} ${count === 1 ? item : `${count} ${item}`}.`,
        kind: "social",
      };
    }
    case "SimulationStarted":
      return { ...base, headline: "The simulation started.", kind: "info", citizenName: undefined };
    case "SimulationStopped":
      return { ...base, headline: "The simulation stopped.", kind: "warning", citizenName: undefined };
    case "PaperServerReady":
      return { ...base, headline: "The Minecraft server is ready.", kind: "success", citizenName: undefined };
    case "SettlementNeedDetected":
      return {
        ...base,
        headline: `The settlement needs ${friendlyNeed(payload.need ?? payload.needs)}.`,
        kind: "warning",
        citizenName: undefined,
      };
    case "MemoryCreated":
      return {
        ...base,
        headline: `${name} remembers: ${typeof payload.content === "string" ? payload.content : "something that happened."}`,
        kind: "info",
      };
    case "LessonCreated":
      return {
        ...base,
        headline: `${name} learned: ${String(payload.lesson ?? payload.content ?? "a new lesson")}`,
        kind: "info",
      };
    case "SystemIncident":
      return {
        ...base,
        headline: String(payload.summary ?? payload.error ?? "A system incident occurred."),
        subtext: "This is a runtime issue, not something a citizen learned.",
        kind: "warning",
        citizenName: undefined,
      };
    case "HumanDirectiveIssued":
      return {
        ...base,
        headline: `You told ${payload.everyone ? "everyone" : name} to ${friendlyGoal(payload.intent ?? payload.goal)}.`,
        subtext: typeof payload.rawText === "string" ? `“${payload.rawText}”` : undefined,
        kind: "human",
      };
    case "HumanDirectiveCancelled":
      return { ...base, headline: "You cancelled a human directive.", kind: "human" };
    case "HumanDirectiveCompleted":
      return { ...base, headline: `${name} finished the requested work.`, kind: "success" };
    case "HumanDirectiveFailed":
      return {
        ...base,
        headline: `${name} couldn't finish the requested work.`,
        subtext: reason ?? translated?.subtext,
        kind: "failure",
      };
    case "HumanDirectiveRejected":
      return { ...base, headline: "That instruction was rejected.", subtext: reason, kind: "warning" };
    case "WorkstationCreated":
      return {
        ...base,
        headline: `${friendlyItem(payload.item ?? payload.name ?? "chest")} was placed for the settlement.`,
        kind: "success",
      };
    case "ActionFailed":
      return {
        ...base,
        headline: `${name} failed while ${friendlyTask(payload.action ?? payload.task)}.`,
        subtext: translated?.subtext,
        kind: "failure",
      };
    case "ActionStarted":
    case "ActionCompleted":
      return {
        ...base,
        headline: `${name} ${type === "ActionStarted" ? "began" : "finished"} ${friendlyTask(payload.action ?? payload.task)}.`,
        kind: type === "ActionCompleted" ? "success" : "info",
      };
    case "ConstructionBlockPlaced":
      return {
        ...base,
        headline: `${name} placed a block on the starter shelter.`,
        kind: "info",
        count: 1,
      };
    default: {
      const label = sentenceFromType(type);
      return {
        ...base,
        headline: name && name !== "a citizen" ? `${name}: ${label}.` : `${label}.`,
        kind: "info",
      };
    }
  }
}

export function formatSimEvent(event: SimEvent, names: Record<string, string> = {}): PresentedEvent {
  return presentEvent(event, names);
}

export const NOISY_EVENT_TYPES = new Set([
  "ActionStarted",
  "ActionCompleted",
  "ConstructionBlockPlaced",
  "ResourceReserved",
  "ResourceReleased",
]);

export function eventImportance(type: string, payload: Record<string, unknown> = {}): EventImportance {
  if (
    NOISY_EVENT_TYPES.has(type) ||
    /Claim|Reserv|BlockPlaced|Scheduler|RouteRecalc|ActionStarted|ActionCompleted/i.test(type)
  ) {
    return "DEBUG";
  }
  if (
    /Died|Respawned|Disconnected|ErrorOccurred|ConstructionCompleted|HumanDirective|ItemCrafted|CraftingCompleted|ItemTransfer|SimulationStarted|PaperServerReady|SystemIncident|WorkstationCreated/i.test(
      type,
    )
  ) {
    return "MAJOR";
  }
  if (payload.permanent === true || payload.permadeath === true) return "MAJOR";
  return "NORMAL";
}

export function eventIcon(type: string, importance: EventImportance): string {
  if (type.startsWith("HumanDirective")) return "🎮";
  if (/Craft/.test(type) || type === "ItemCrafted") return "🧰";
  if (/Deposit|Withdraw|Chest|Storage|Workstation/.test(type)) return "📦";
  if (/Construction|Shelter|Project/.test(type)) return "🏠";
  if (/Conversation|Relationship|Transfer/.test(type)) return "💬";
  if (/LLM|Lesson|Memory/.test(type)) return "🧠";
  if (/Died|Failed|Error/.test(type)) return "⚠";
  if (/Respawn|Connected|Spawned/.test(type)) return "👤";
  if (importance === "MAJOR") return "★";
  return "•";
}

export function filterPresentedEvents(events: PresentedEvent[], showDebug = false): PresentedEvent[] {
  return events.filter((event) => showDebug || event.importance !== "DEBUG");
}

export function aggregatePresentedEvents(events: PresentedEvent[]): PresentedEvent[] {
  const out: PresentedEvent[] = [];
  for (const event of events) {
    const prev = out.at(-1);
    if (prev && canMerge(prev, event)) {
      const added = event.count ?? 1;
      const count = (prev.count ?? 1) + added;
      prev.count = count;
      prev.technical.ids = [...(prev.technical.ids ?? [prev.technical.timestamp]), event.technical.timestamp];
      if (isCollectType(prev.technical.type)) {
        const item = prev.technical.payload.name ?? prev.technical.payload.item ?? event.technical.payload.name;
        prev.headline = `${prev.citizenName ?? "A citizen"} collected ${count} ${friendlyItem(item, count)}.`;
      } else if (isBuildType(prev.technical.type)) {
        prev.headline = `${prev.citizenName ?? "A citizen"} added ${count} blocks to the starter shelter.`;
        prev.subtext = event.headline;
      }
      continue;
    }
    out.push({ ...event, technical: { ...event.technical, payload: { ...event.technical.payload } } });
  }
  return out;
}

function canMerge(a: PresentedEvent, b: PresentedEvent): boolean {
  if (a.citizenName !== b.citizenName) return false;
  if (isCollectType(a.technical.type) && isCollectType(b.technical.type)) {
    return itemKey(a) === itemKey(b);
  }
  return isBuildType(a.technical.type) && isBuildType(b.technical.type);
}

function isCollectType(type: string): boolean {
  return type === "ResourceCollected";
}

function isBuildType(type: string): boolean {
  return type === "ConstructionProgress" || type === "ConstructionBlockPlaced";
}

function itemKey(event: PresentedEvent): string {
  return String(event.technical.payload.name ?? event.technical.payload.item ?? "");
}

function otherName(payload: Record<string, unknown>, names: Record<string, string>): string | undefined {
  const raw = payload.other ?? payload.otherId ?? payload.receiver;
  return typeof raw === "string" ? citizenDisplayName(raw, names) : undefined;
}

function humanReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) return reason;
  const lower = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return lower.endsWith(".") ? lower : `${lower}.`;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatPosition(position: unknown): string | undefined {
  if (!position || typeof position !== "object") return undefined;
  const pos = position as { x?: number; y?: number; z?: number };
  if (typeof pos.x !== "number" || typeof pos.y !== "number" || typeof pos.z !== "number") return undefined;
  return `At X ${pos.x.toFixed(0)}, Y ${pos.y.toFixed(0)}, Z ${pos.z.toFixed(0)}.`;
}

function relationshipSubtext(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof payload.trigger === "string") parts.push(`Because: ${payload.trigger.replaceAll("_", " ")}`);
  if (typeof payload.reason === "string") parts.push(payload.reason);
  for (const key of ["trust", "affection", "respect", "resentment", "familiarity"] as const) {
    if (typeof payload[key] === "number") {
      parts.push(`${key.charAt(0).toUpperCase()}${key.slice(1)} ${relationshipPercent(payload[key])}%`);
    }
  }
  return parts.join(" · ");
}
