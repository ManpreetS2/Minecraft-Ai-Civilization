import type { SimEvent } from "./events.js";
import { DEFAULT_CITIZENS } from "./types.js";

export type PresentedEventKind = "success" | "warning" | "failure" | "social" | "info";

export type PresentedEvent = {
  headline: string;
  subtext?: string;
  kind: PresentedEventKind;
  timeLabel: string;
  citizenName?: string;
  technical: {
    type: string;
    citizenId?: string;
    timestamp: string;
    payload: Record<string, unknown>;
  };
};

const TASK_LABELS: Record<string, string> = {
  gather_wood: "gathering wood",
  gather_food: "gathering food",
  mine_stone: "mining stone",
  craft_tools: "crafting tools",
  build_shelter: "building shelter",
  seek_shelter: "finding shelter",
  flee_danger: "fleeing danger",
  acquire_food: "looking for food",
  eat: "eating",
  deposit: "storing items",
  observe: "looking around",
  defend: "defending themselves",
  help_citizen: "helping someone",
  rest: "resting",
  explore: "exploring",
};

const GOAL_LABELS: Record<string, string> = {
  gather_wood: "gather wood",
  gather_food: "gather food",
  mine_stone: "mine stone",
  craft_tools: "craft tools",
  build_shelter: "build shelter",
  help_citizen: "help another citizen",
  deposit: "store items",
  rest: "rest",
  explore: "explore",
  defend: "defend",
  survive: "survive",
  bootstrap: "bootstrap tools",
  settlement: "help the settlement",
  idle: "idle",
};

export function citizenDisplayName(idOrName?: string, names?: Record<string, string>): string {
  if (!idOrName) return "a citizen";
  if (names?.[idOrName]) return names[idOrName];
  const seeded = DEFAULT_CITIZENS.find((c) => c.id === idOrName || c.name === idOrName);
  if (seeded) return seeded.name;
  if (idOrName.startsWith("citizen_")) {
    const rest = idOrName.slice("citizen_".length);
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return idOrName;
}

export function friendlyTask(task?: unknown): string {
  if (typeof task !== "string" || !task) return "their work";
  return TASK_LABELS[task] ?? task.replaceAll("_", " ");
}

export function failedTask(task?: unknown): string {
  if (typeof task !== "string" || !task) return "finish that work";
  const failed: Record<string, string> = {
    gather_wood: "gather wood",
    gather_food: "gather food",
    mine_stone: "mine stone",
    craft_tools: "craft tools",
    build_shelter: "build the shelter",
    seek_shelter: "find shelter",
    flee_danger: "get to safety",
    acquire_food: "find food",
    eat: "eat",
    deposit: "store items",
    observe: "look around",
    defend: "defend themselves",
  };
  return failed[task] ?? task.replaceAll("_", " ");
}

export function friendlyGoal(goal?: unknown): string {
  if (typeof goal !== "string" || !goal) return "an unknown goal";
  return GOAL_LABELS[goal] ?? goal.replaceAll("_", " ");
}

export function formatLocalTime(timestamp: string, now = new Date()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
  });
}

export function relationshipPercent(value: number): number {
  return Math.round(Math.max(-1, Math.min(1, value)) * 100);
}

export function formatSimEvent(event: SimEvent, names: Record<string, string> = {}): PresentedEvent {
  const name = citizenDisplayName(event.citizenId, names);
  const payload = event.payload ?? {};
  const timeLabel = formatLocalTime(event.timestamp);
  const technical = {
    type: event.type,
    citizenId: event.citizenId,
    timestamp: event.timestamp,
    payload,
  };
  const task = friendlyTask(payload.task);
  const reason = typeof payload.reason === "string" ? payload.reason : undefined;
  const error = typeof payload.error === "string" ? payload.error : undefined;
  const other =
    typeof payload.other === "string"
      ? citizenDisplayName(payload.other, names)
      : typeof payload.otherId === "string"
        ? citizenDisplayName(payload.otherId, names)
        : undefined;

  switch (event.type) {
    case "TaskStarted":
      return {
        headline: `${name} started ${task}.`,
        subtext: reason ? `Reason: ${humanReason(reason)}` : undefined,
        kind: "info",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "TaskCompleted":
      return {
        headline: `${name} finished ${task}.`,
        kind: "success",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "TaskFailed":
      return {
        headline: `${name} couldn't ${failedTask(payload.task)}.`,
        subtext: error ? humanError(error) : undefined,
        kind: "failure",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "CitizenConnected":
      return { headline: `${name} entered the world.`, kind: "success", timeLabel, citizenName: name, technical };
    case "CitizenSpawned":
      return { headline: `${name} spawned in the world.`, kind: "success", timeLabel, citizenName: name, technical };
    case "CitizenDisconnected":
      return {
        headline: `${name} disconnected.`,
        subtext: typeof payload.reason === "string" ? payload.reason : undefined,
        kind: "warning",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "CitizenKicked":
      return {
        headline: `${name} was kicked from the world.`,
        subtext: typeof payload.reason === "string" ? payload.reason : undefined,
        kind: "warning",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "CitizenDied":
      return {
        headline: `${name} died. That identity is gone.`,
        subtext: formatPosition(payload.position),
        kind: "failure",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "CitizenInjured":
      return { headline: `${name} was hurt.`, kind: "warning", timeLabel, citizenName: name, technical };
    case "CitizenRespawned":
      return { headline: `${name} respawned.`, kind: "warning", timeLabel, citizenName: name, technical };
    case "ConstructionStarted":
      return {
        headline: "The settlement began construction of the starter shelter.",
        kind: "info",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "ConstructionProgress": {
      const placed = Number(payload.placed ?? payload.placedBlocks ?? 0);
      const total = Number(payload.total ?? payload.totalBlocks ?? 0);
      return {
        headline: `Shelter construction: ${placed} / ${total} blocks.`,
        kind: "info",
        timeLabel,
        citizenName: name,
        technical,
      };
    }
    case "ConstructionCompleted":
      return {
        headline: "The first shelter was completed.",
        kind: "success",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "ConversationOccurred":
      return {
        headline: other ? `${name} spoke with ${other}.` : `${name} spoke.`,
        subtext: typeof payload.message === "string" ? payload.message : undefined,
        kind: "social",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "RelationshipChanged":
      return {
        headline: other ? `${name}'s relationship with ${other} changed.` : `${name}'s relationship changed.`,
        subtext: relationshipSubtext(payload),
        kind: "social",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "LLMDecisionMade":
      return {
        headline: `${name} reconsidered what to do.`,
        subtext: [
          payload.goal ? `Goal: ${friendlyGoal(payload.goal)}` : undefined,
          reason ? `Reason: ${humanReason(reason)}` : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        kind: "info",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "LLMSkipped":
      return {
        headline: `${name} could not get a high-level decision.`,
        subtext: error,
        kind: "warning",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "ErrorOccurred":
      return {
        headline: `Something went wrong while controlling ${name}.`,
        subtext: error ? humanError(error) : undefined,
        kind: "failure",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "ItemCrafted":
      return {
        headline: `${name} crafted ${String(payload.item ?? payload.name ?? "an item")}.`,
        kind: "success",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "ResourceCollected":
      return {
        headline: `${name} collected ${String(payload.name ?? payload.item ?? "a resource")}.`,
        kind: "success",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "ItemTransferred":
      return {
        headline: other ? `${name} gave something to ${other}.` : `${name} transferred an item.`,
        kind: "social",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "SimulationStarted":
      return { headline: "The simulation started.", kind: "info", timeLabel, technical };
    case "SimulationStopped":
      return { headline: "The simulation stopped.", kind: "warning", timeLabel, technical };
    case "PaperServerReady":
      return { headline: "The Minecraft server is ready.", kind: "success", timeLabel, technical };
    case "SettlementNeedDetected":
      return {
        headline: `The settlement needs ${String(payload.need ?? payload.needs ?? "more supplies")}.`,
        kind: "warning",
        timeLabel,
        technical,
      };
    case "MemoryCreated":
      return {
        headline: `${name} formed a memory.`,
        subtext: typeof payload.content === "string" ? payload.content : undefined,
        kind: "info",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "ActionFailed":
      return {
        headline: `${name} failed while ${friendlyTask(payload.action ?? payload.task)}.`,
        subtext: error ? humanError(error) : undefined,
        kind: "failure",
        timeLabel,
        citizenName: name,
        technical,
      };
    case "ActionStarted":
    case "ActionCompleted":
      return {
        headline: `${name} ${event.type === "ActionStarted" ? "began" : "finished"} ${friendlyTask(payload.action ?? payload.task)}.`,
        kind: event.type === "ActionCompleted" ? "success" : "info",
        timeLabel,
        citizenName: name,
        technical,
      };
    default: {
      const typeName = String(event.type);
      return {
        headline: `${typeName.replace(/([A-Z])/g, " $1").trim()}.`,
        kind: "info",
        timeLabel,
        citizenName: name,
        technical,
      };
    }
  }
}

export const NOISY_EVENT_TYPES = new Set(["ActionStarted", "ActionCompleted"]);

function humanReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) return reason;
  const lower = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return lower.endsWith(".") ? lower : `${lower}.`;
}

function humanError(error: string): string {
  const match = error.match(/timed out heading to (-?\d+) (-?\d+) (-?\d+)/i);
  if (match) {
    return `Movement timed out near X ${match[1]}, Y ${match[2]}, Z ${match[3]}.`;
  }
  const stuck = error.match(/stuck heading to (-?\d+) (-?\d+) (-?\d+)/i);
  if (stuck) {
    return `Got stuck near X ${stuck[1]}, Y ${stuck[2]}, Z ${stuck[3]}.`;
  }
  const nopath = error.match(/no path to (-?\d+) (-?\d+) (-?\d+)/i);
  if (nopath) {
    return `No path to X ${nopath[1]}, Y ${nopath[2]}, Z ${nopath[3]}.`;
  }
  return error;
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
