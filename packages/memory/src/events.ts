import { distance, type SimEvent, type Vec3 } from "@civ/shared";
import { asNumber, asString, asStringArray } from "./json.js";
import { randomId } from "./clock.js";
import type {
  KnowledgeSource,
  ObjectiveEventCategory,
  ObjectiveWorldEvent,
  SnapshotCitizen,
  WorldSnapshot,
} from "./types.js";
import { DEFAULT_NEARBY_RADIUS } from "./bounds.js";

export type EventFactoryBase = {
  id?: string;
  timestamp?: string;
  gameTime?: number;
  location?: Vec3;
};

function baseEvent(
  category: ObjectiveEventCategory,
  args: EventFactoryBase & {
    actorCitizenId?: string;
    targetCitizenId?: string;
    participants: string[];
    facts: Record<string, unknown>;
  },
): ObjectiveWorldEvent {
  const participants = [...new Set(args.participants.filter(Boolean))];
  return {
    id: args.id ?? randomId(),
    category,
    timestamp: args.timestamp ?? new Date().toISOString(),
    gameTime: args.gameTime,
    location: args.location,
    actorCitizenId: args.actorCitizenId,
    targetCitizenId: args.targetCitizenId,
    participants,
    facts: args.facts,
  };
}

export function itemReceivedEvent(args: EventFactoryBase & {
  giverId: string;
  receiverId: string;
  item: string;
  count: number;
  receiverHunger?: number;
  giverHunger?: number;
}): ObjectiveWorldEvent {
  return baseEvent("citizen_item_received", {
    ...args,
    actorCitizenId: args.giverId,
    targetCitizenId: args.receiverId,
    participants: [args.giverId, args.receiverId],
    facts: {
      giverId: args.giverId,
      receiverId: args.receiverId,
      item: args.item,
      count: args.count,
      receiverHunger: args.receiverHunger,
      giverHunger: args.giverHunger,
    },
  });
}

export function itemLostEvent(args: EventFactoryBase & {
  citizenId: string;
  item: string;
  count: number;
  cause?: string;
}): ObjectiveWorldEvent {
  return baseEvent("citizen_item_lost", {
    ...args,
    actorCitizenId: args.citizenId,
    targetCitizenId: args.citizenId,
    participants: [args.citizenId],
    facts: { citizenId: args.citizenId, item: args.item, count: args.count, cause: args.cause },
  });
}

export function citizenDamagedEvent(args: EventFactoryBase & {
  citizenId: string;
  amount?: number;
  cause?: string;
  attackerId?: string;
  attackerType?: string;
  healthAfter?: number;
}): ObjectiveWorldEvent {
  return baseEvent("citizen_damaged", {
    ...args,
    actorCitizenId: args.attackerId,
    targetCitizenId: args.citizenId,
    participants: [args.citizenId, args.attackerId].filter((id): id is string => Boolean(id)),
    facts: {
      citizenId: args.citizenId,
      amount: args.amount,
      cause: args.cause,
      attackerId: args.attackerId,
      attackerType: args.attackerType,
      healthAfter: args.healthAfter,
    },
  });
}

export function citizenHelpedEvent(args: EventFactoryBase & {
  helperId: string;
  recipientId: string;
  kind?: string;
}): ObjectiveWorldEvent {
  return baseEvent("citizen_helped", {
    ...args,
    actorCitizenId: args.helperId,
    targetCitizenId: args.recipientId,
    participants: [args.helperId, args.recipientId],
    facts: { helperId: args.helperId, recipientId: args.recipientId, kind: args.kind ?? "help" },
  });
}

export function taskOutcomeEvent(args: EventFactoryBase & {
  citizenId: string;
  activity: string;
  success: boolean;
  task?: string;
  error?: string;
}): ObjectiveWorldEvent {
  return baseEvent(args.success ? "task_succeeded" : "task_failed", {
    ...args,
    actorCitizenId: args.citizenId,
    targetCitizenId: args.citizenId,
    participants: [args.citizenId],
    facts: {
      citizenId: args.citizenId,
      activity: args.activity,
      success: args.success,
      task: args.task ?? args.activity,
      error: args.error,
    },
  });
}

export function resourceDiscoveredEvent(args: EventFactoryBase & {
  citizenId: string;
  resource: string;
  count?: number;
}): ObjectiveWorldEvent {
  return baseEvent("resource_discovered", {
    ...args,
    actorCitizenId: args.citizenId,
    participants: [args.citizenId],
    facts: { citizenId: args.citizenId, resource: args.resource, count: args.count ?? 1 },
  });
}

export function dangerEncounteredEvent(args: EventFactoryBase & {
  citizenId: string;
  threatKey: string;
  threatType?: "mob" | "environment" | "citizen";
  harmOccurred?: boolean;
  outcome?: "harmless" | "damaged" | "destroyed" | "escaped" | "defeated";
  destroyed?: string;
  itemsLost?: Array<{ item: string; count: number }>;
}): ObjectiveWorldEvent {
  return baseEvent("danger_encountered", {
    ...args,
    actorCitizenId: args.citizenId,
    targetCitizenId: args.citizenId,
    participants: [args.citizenId],
    facts: {
      citizenId: args.citizenId,
      threatKey: args.threatKey,
      threatType: args.threatType ?? "mob",
      harmOccurred: args.harmOccurred ?? false,
      outcome: args.outcome ?? (args.harmOccurred ? "damaged" : "harmless"),
      destroyed: args.destroyed,
      itemsLost: args.itemsLost,
    },
  });
}

export function citizenAttackedCitizenEvent(args: EventFactoryBase & {
  attackerId: string;
  victimId: string;
  weapon?: string;
  damage?: number;
  victimHealthAfter?: number;
}): ObjectiveWorldEvent {
  return baseEvent("citizen_attacked_citizen", {
    ...args,
    actorCitizenId: args.attackerId,
    targetCitizenId: args.victimId,
    participants: [args.attackerId, args.victimId],
    facts: {
      attackerId: args.attackerId,
      victimId: args.victimId,
      weapon: args.weapon,
      damage: args.damage,
      victimHealthAfter: args.victimHealthAfter,
    },
  });
}

export function citizenDeathEvent(args: EventFactoryBase & {
  deceasedId: string;
  cause?: string;
  killerId?: string;
  killerType?: string;
}): ObjectiveWorldEvent {
  return baseEvent("citizen_death", {
    ...args,
    actorCitizenId: args.killerId,
    targetCitizenId: args.deceasedId,
    participants: [args.deceasedId, args.killerId].filter((id): id is string => Boolean(id)),
    facts: {
      deceasedId: args.deceasedId,
      cause: args.cause,
      killerId: args.killerId,
      killerType: args.killerType,
    },
  });
}

export function constructionCompletedEvent(args: EventFactoryBase & {
  citizenId?: string;
  blueprintId?: string;
  participants?: string[];
}): ObjectiveWorldEvent {
  const people = args.participants ?? (args.citizenId ? [args.citizenId] : []);
  return baseEvent("construction_completed", {
    ...args,
    actorCitizenId: args.citizenId,
    participants: people,
    facts: { citizenId: args.citizenId, blueprintId: args.blueprintId },
  });
}

export function conversationHeardEvent(args: EventFactoryBase & {
  speakerId: string;
  listenerIds: string[];
  topic?: string;
  text?: string;
}): ObjectiveWorldEvent {
  return baseEvent("conversation_heard", {
    ...args,
    actorCitizenId: args.speakerId,
    participants: [args.speakerId, ...args.listenerIds],
    facts: { speakerId: args.speakerId, listenerIds: args.listenerIds, topic: args.topic, text: args.text },
  });
}

export function promiseAgreementEvent(args: EventFactoryBase & {
  parties: string[];
  summary: string;
}): ObjectiveWorldEvent {
  return baseEvent("promise_agreement", {
    ...args,
    actorCitizenId: args.parties[0],
    participants: args.parties,
    facts: { parties: args.parties, summary: args.summary },
  });
}

/**
 * Best-effort adapter from existing SimEvent records.
 * Returns null when the payload is not a supported cognitive event.
 * Does not invent runtime events.
 */
export function tryAdaptSimEvent(event: SimEvent): ObjectiveWorldEvent | null {
  const payload = event.payload ?? {};
  const timestamp = event.timestamp;
  const citizenId = event.citizenId;
  switch (event.type) {
    case "ItemTransferred": {
      const giverId = asString(payload.giverId) ?? asString(payload.giver) ?? citizenId;
      const receiverId = asString(payload.receiverId) ?? asString(payload.receiver);
      const item = asString(payload.item) ?? asString(payload.itemName);
      const count = asNumber(payload.count) ?? 1;
      if (!giverId || !receiverId || !item) return null;
      return itemReceivedEvent({
        id: event.id,
        timestamp,
        giverId,
        receiverId,
        item,
        count,
        receiverHunger: asNumber(payload.receiverHunger) ?? asNumber(payload.hunger),
        location: vecFromUnknown(payload.location),
      });
    }
    case "CitizenInjured": {
      if (!citizenId) return null;
      return citizenDamagedEvent({
        id: event.id,
        timestamp,
        citizenId,
        amount: asNumber(payload.amount) ?? asNumber(payload.damage),
        cause: asString(payload.cause),
        attackerId: asString(payload.attackerId),
        attackerType: asString(payload.attackerType) ?? asString(payload.mob),
        healthAfter: asNumber(payload.healthAfter) ?? asNumber(payload.health),
        location: vecFromUnknown(payload.location),
      });
    }
    case "CitizenDied": {
      const deceasedId = asString(payload.deceasedId) ?? citizenId;
      if (!deceasedId) return null;
      return citizenDeathEvent({
        id: event.id,
        timestamp,
        deceasedId,
        cause: asString(payload.cause),
        killerId: asString(payload.killerId),
        killerType: asString(payload.killerType),
        location: vecFromUnknown(payload.location) ?? vecFromUnknown(payload.position),
      });
    }
    case "TaskCompleted":
    case "TaskFailed": {
      if (!citizenId) return null;
      const activity = asString(payload.activity) ?? asString(payload.task) ?? asString(payload.goal) ?? "unknown";
      return taskOutcomeEvent({
        id: event.id,
        timestamp,
        citizenId,
        activity,
        success: event.type === "TaskCompleted",
        task: asString(payload.task),
        error: asString(payload.error),
        location: vecFromUnknown(payload.location),
      });
    }
    case "ResourceCollected": {
      if (!citizenId) return null;
      const resource = asString(payload.resource) ?? asString(payload.item);
      if (!resource) return null;
      return resourceDiscoveredEvent({
        id: event.id,
        timestamp,
        citizenId,
        resource,
        count: asNumber(payload.count),
        location: vecFromUnknown(payload.location),
      });
    }
    case "ConstructionCompleted": {
      return constructionCompletedEvent({
        id: event.id,
        timestamp,
        citizenId,
        blueprintId: asString(payload.blueprintId),
        participants: asStringArray(payload.participants),
        location: vecFromUnknown(payload.location),
      });
    }
    case "ConversationOccurred": {
      const speakerId = asString(payload.speakerId) ?? citizenId;
      if (!speakerId) return null;
      return conversationHeardEvent({
        id: event.id,
        timestamp,
        speakerId,
        listenerIds: asStringArray(payload.listenerIds),
        topic: asString(payload.topic),
        text: asString(payload.text) ?? asString(payload.message),
        location: vecFromUnknown(payload.location),
      });
    }
    default:
      return null;
  }
}

export type ObserverRole = {
  citizenId: string;
  source: KnowledgeSource;
  name?: string;
};

/**
 * Who actually has a basis to remember this event.
 * Distant citizens are omitted unless later told (HEARD).
 */
export function observersForEvent(event: ObjectiveWorldEvent, snapshot: WorldSnapshot): ObserverRole[] {
  const radius = snapshot.nearbyRadius ?? DEFAULT_NEARBY_RADIUS;
  const found = new Map<string, ObserverRole>();

  const add = (citizenId: string | undefined, source: KnowledgeSource) => {
    if (!citizenId || found.has(citizenId)) return;
    const person = snapshot.citizens.find((c) => c.id === citizenId);
    if (person?.deceased && event.category !== "citizen_death") return;
    found.set(citizenId, { citizenId, source, name: person?.name });
  };

  add(event.targetCitizenId, "DIRECT");
  add(event.actorCitizenId, "DIRECT");
  for (const id of event.participants) add(id, "DIRECT");

  const origin = event.location;
  if (origin) {
    for (const citizen of snapshot.citizens) {
      if (found.has(citizen.id)) continue;
      if (citizen.deceased) continue;
      if (!citizen.position) continue;
      if (distance(origin, citizen.position) <= radius) {
        add(citizen.id, "WITNESSED");
      }
    }
  }

  const heardBy = asStringArray(event.facts.heardBy);
  for (const id of heardBy) add(id, "HEARD");
  const recordReaders = asStringArray(event.facts.recordReaders);
  for (const id of recordReaders) add(id, "RECORD");

  return [...found.values()];
}

export function isNearby(a: SnapshotCitizen, b: Vec3, radius = DEFAULT_NEARBY_RADIUS): boolean {
  if (!a.position) return false;
  return distance(a.position, b) <= radius;
}

function vecFromUnknown(value: unknown): Vec3 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const x = asNumber(record.x);
  const y = asNumber(record.y);
  const z = asNumber(record.z);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return { x, y, z };
}

export function locationKey(location?: Vec3): string | undefined {
  if (!location) return undefined;
  const x = Math.round(location.x / 8) * 8;
  const y = Math.round(location.y);
  const z = Math.round(location.z / 8) * 8;
  return `loc:${x},${y},${z}`;
}

export function hungerLabel(hunger?: number): string | undefined {
  if (hunger === undefined) return undefined;
  if (hunger <= 4) return "very hungry";
  if (hunger <= 8) return "hungry";
  if (hunger <= 14) return "a bit hungry";
  return undefined;
}
