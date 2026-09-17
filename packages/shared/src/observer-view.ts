import { distance } from "./vec3.js";
import {
  citizenDisplayName,
  formatWorldClock,
  friendlyGoal,
  friendlyNeed,
  friendlyTask,
  relationshipPercent,
} from "./friendly-names.js";
import { aggregatePresentedEvents, filterPresentedEvents, presentEvent, type PresentedEvent } from "./format-event.js";
import type { HumanDirective, DirectiveStatus } from "./directives.js";
import type { MemoryRecord, Relationship, SettlementNeed, SettlementState } from "./types.js";
import type { SimEvent } from "./events.js";

export type ObserverCitizen = {
  id: string;
  name: string;
  activity: string;
  statusLabel: string;
  healthLabel?: string;
  hungerLabel?: string;
  location: string;
  instruction?: string;
  connected: boolean;
  occupation?: string;
  technical: {
    goal?: string;
    task?: string;
    action?: string;
    decisionSource?: string;
    status?: string;
    citizenId: string;
  };
};

export type ObserverSettlement = {
  name: string;
  citizensActive: string;
  food?: number;
  logs?: number;
  stone?: number;
  tools?: number;
  sharedStorage?: string;
  craftingTables?: string;
  shelter?: { label: string; status: string; progress?: string };
  needs: string[];
};

export type ObserverHealth = {
  run: string;
  permanentDeath: string;
  bots: string;
  connection: string;
  averageTick?: string;
  llm?: string;
  pathfinding?: string;
  recentWarnings: number;
};

export type ObserverMemory = {
  citizenName: string;
  text: string;
  technical: MemoryRecord;
};

export type ObserverRelationship = {
  from: string;
  to: string;
  trust: number;
  affection: number;
  respect: number;
  resentment: number;
  familiarity: number;
  caption: string;
};

export type ObserverDirective = {
  id: string;
  youLine: string;
  quote: string;
  parsed: string;
  statusLabel: string;
  status: DirectiveStatus;
  mode: string;
  outcomes: Array<{ name: string; status: DirectiveStatus; label: string }>;
  failureReason?: string;
  createdLabel: string;
  technical: HumanDirective;
};

export type ObserverView = {
  clockLabel: string;
  citizens: ObserverCitizen[];
  settlement: ObserverSettlement;
  health: ObserverHealth;
  presentedEvents: PresentedEvent[];
  feedEvents: PresentedEvent[];
  remembers: ObserverMemory[];
  learned: ObserverMemory[];
  incidents: PresentedEvent[];
  relationships: ObserverRelationship[];
  directives: ObserverDirective[];
  directivesEnabled: boolean;
};

type SnapshotCitizen = {
  id: string;
  name: string;
  status?: string;
  connected?: boolean;
  health?: number;
  hunger?: number;
  occupation?: string;
  currentGoal?: string;
  currentTask?: string;
  currentAction?: string;
  decisionSource?: string;
  reason?: string;
  lastKnownPosition?: { x: number; y: number; z: number };
  gameTime?: number;
  isNight?: boolean;
};

export type ObserverSnapshotInput = {
  updatedAt: string;
  population: number;
  activeBots: number;
  citizens: SnapshotCitizen[];
  settlement: SettlementState;
  events: SimEvent[];
  memories: MemoryRecord[];
  relationships: Relationship[];
  performance?: {
    avgTickMs?: number;
    llmInFlight?: number;
    activePaths?: number;
    reconnectAttempts?: number;
  };
};

export type ObserverExtras = {
  directives: HumanDirective[];
  directivesEnabled: boolean;
  runId: string;
  permanentDeath: boolean;
  showDebug?: boolean;
};

export function buildObserverView(snapshot: ObserverSnapshotInput, extras: ObserverExtras): ObserverView {
  const names = Object.fromEntries(snapshot.citizens.flatMap((c) => [
    [c.id, c.name],
    [c.name, c.name],
  ]));
  const presentedEvents = aggregatePresentedEvents(snapshot.events.map((event) => presentEvent(event, names)));
  const feedEvents = filterPresentedEvents(presentedEvents, extras.showDebug);
  const world = snapshot.citizens.find((c) => typeof c.gameTime === "number");
  const clockLabel = formatWorldClock(snapshot.updatedAt, world ? { gameTime: world.gameTime, isNight: world.isNight } : undefined);

  return {
    clockLabel,
    citizens: snapshot.citizens.map((citizen) => presentCitizen(citizen, snapshot.settlement)),
    settlement: presentSettlement(snapshot.settlement, snapshot.activeBots, snapshot.population),
    health: presentHealth(snapshot, extras, presentedEvents),
    presentedEvents,
    feedEvents,
    ...splitMemories(snapshot.memories, names),
    incidents: presentedEvents.filter(isSystemIncident),
    relationships: snapshot.relationships
      .filter((rel) => rel.trust || rel.affection || rel.respect || rel.resentment || rel.familiarity)
      .map((rel) => ({
        from: citizenDisplayName(rel.citizenId, names),
        to: citizenDisplayName(rel.otherId, names),
        trust: relationshipPercent(rel.trust),
        affection: relationshipPercent(rel.affection),
        respect: relationshipPercent(rel.respect),
        resentment: relationshipPercent(rel.resentment),
        familiarity: relationshipPercent(rel.familiarity),
        caption: "Approximate observed social state.",
      })),
    directives: extras.directives.map((directive) => presentDirective(directive, names)),
    directivesEnabled: extras.directivesEnabled,
  };
}

export function presentCitizen(citizen: SnapshotCitizen, settlement: SettlementState): ObserverCitizen {
  const dead = citizen.status === "dead";
  const activity = dead
    ? "Deceased"
    : citizen.currentTask
      ? friendlyTask(citizen.currentTask)
      : citizen.currentGoal
        ? friendlyTask(citizen.currentGoal)
        : citizen.status === "connecting"
          ? "Connecting"
          : citizen.connected
            ? "Looking around"
            : "Offline";
  return {
    id: citizen.id,
    name: citizen.name,
    activity: titleActivity(activity),
    statusLabel: dead ? "Deceased" : citizen.connected ? "Online" : citizen.status ?? "Offline",
    healthLabel: typeof citizen.health === "number" ? `Health ${Math.round(citizen.health)} / 20` : undefined,
    hungerLabel: typeof citizen.hunger === "number" ? `Hunger ${Math.round(citizen.hunger)} / 20` : undefined,
    location: locationLabel(citizen.lastKnownPosition, settlement),
    instruction: dead ? undefined : citizen.currentGoal ? capitalize(friendlyGoal(citizen.currentGoal)) : undefined,
    connected: Boolean(citizen.connected),
    occupation: citizen.occupation,
    technical: {
      goal: citizen.currentGoal,
      task: citizen.currentTask,
      action: citizen.currentAction,
      decisionSource: citizen.decisionSource,
      status: citizen.status,
      citizenId: citizen.id,
    },
  };
}

export function presentDirective(directive: HumanDirective, names: Record<string, string>): ObserverDirective {
  const targets = directive.targetIds.map((id) => citizenDisplayName(id, names));
  const who = targets.length === 1 ? targets[0] : "everyone";
  return {
    id: directive.id,
    youLine: `YOU → ${who}`,
    quote: directive.rawText,
    parsed: capitalize(friendlyGoal(directive.parsedIntent)),
    statusLabel: statusLabel(directive.status),
    status: directive.status,
    mode: directive.mode,
    outcomes: directive.targetIds.map((id) => ({
      name: citizenDisplayName(id, names),
      status: directive.outcomes[id] ?? directive.status,
      label: statusLabel(directive.outcomes[id] ?? directive.status),
    })),
    failureReason: directive.failureReason,
    createdLabel: directive.createdAt,
    technical: directive,
  };
}

function presentSettlement(settlement: SettlementState, active: number, population: number): ObserverSettlement {
  const construction = settlement.construction;
  let shelter: ObserverSettlement["shelter"];
  if (settlement.shelterComplete || construction?.complete) {
    shelter = { label: "Starter shelter", status: "COMPLETE", progress: construction ? `${construction.placedBlocks} / ${construction.totalBlocks} blocks` : undefined };
  } else if (construction) {
    shelter = {
      label: "Starter shelter",
      status: "BUILDING",
      progress: `${construction.placedBlocks} / ${construction.totalBlocks} blocks`,
    };
  }
  const extra = settlement as SettlementState & {
    workstations?: { craftingTables?: unknown[]; chests?: unknown[] };
  };
  const chests = extra.workstations?.chests?.length;
  const tables = extra.workstations?.craftingTables?.length;
  return {
    name: settlement.name || "First Settlement",
    citizensActive: `${active} / ${population}`,
    food: settlement.food,
    logs: settlement.wood,
    stone: settlement.stone,
    tools: settlement.tools,
    sharedStorage:
      typeof chests === "number"
        ? `${chests} chest${chests === 1 ? "" : "s"}`
        : settlement.storage
          ? "1 chest"
          : "none yet",
    craftingTables: typeof tables === "number" ? String(tables) : undefined,
    shelter,
    needs: (settlement.needs ?? []).map((need: SettlementNeed) => friendlyNeed(need)),
  };
}

function presentHealth(
  snapshot: ObserverSnapshotInput,
  extras: ObserverExtras,
  events: PresentedEvent[],
): ObserverHealth {
  const connected = snapshot.activeBots;
  const population = snapshot.population;
  let connection = "Offline";
  if (population > 0 && connected === population) connection = "Healthy";
  else if (connected > 0) connection = "Degraded";
  const warnings = events.filter((event) => event.kind === "warning" || event.kind === "failure").length;
  return {
    run: extras.runId,
    permanentDeath: extras.permanentDeath ? "ON" : "OFF",
    bots: `${connected} connected`,
    connection,
    averageTick: snapshot.performance?.avgTickMs != null ? `${Math.round(snapshot.performance.avgTickMs)} ms` : undefined,
    llm: snapshot.performance?.llmInFlight != null ? `${snapshot.performance.llmInFlight} request${snapshot.performance.llmInFlight === 1 ? "" : "s"} active` : undefined,
    pathfinding: snapshot.performance?.activePaths != null ? `${snapshot.performance.activePaths} active` : undefined,
    recentWarnings: warnings,
  };
}

function splitMemories(memories: MemoryRecord[], names: Record<string, string>): { remembers: ObserverMemory[]; learned: ObserverMemory[] } {
  const remembers: ObserverMemory[] = [];
  const learned: ObserverMemory[] = [];
  for (const memory of memories) {
    const row = {
      citizenName: citizenDisplayName(memory.citizenId, names),
      text: memory.content,
      technical: memory,
    };
    if (/learned|lesson|should (bring|carry|craft)|bring a pickaxe|before (trying|collecting|mining)|next time/i.test(memory.content)) learned.push(row);
    else remembers.push(row);
  }
  return { remembers, learned };
}

function isSystemIncident(event: PresentedEvent): boolean {
  return (
    event.technical.type === "ErrorOccurred" ||
    event.technical.type === "SystemIncident" ||
    event.technical.type === "CitizenDisconnected" ||
    event.kind === "failure" && /connection|timeout|keepalive/i.test(`${event.headline} ${event.subtext ?? ""}`)
  );
}

function locationLabel(
  position: { x: number; y: number; z: number } | undefined,
  settlement: SettlementState,
): string {
  if (!position) return "Location unknown";
  if (settlement.origin) {
    const d = distance(position, settlement.origin);
    if (d < 24) return "Near the village";
    if (d < 80) return "Around the settlement";
  }
  return `At ${position.x.toFixed(0)}, ${position.y.toFixed(0)}, ${position.z.toFixed(0)}`;
}

function statusLabel(status: DirectiveStatus): string {
  switch (status) {
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "REJECTED":
      return "Rejected";
    case "CANCELLED":
      return "Cancelled";
    case "PENDING":
      return "Queued";
    default:
      return "Working";
  }
}

function titleActivity(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
