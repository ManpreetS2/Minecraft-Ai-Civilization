export const EVENT_TYPES = [
  "CitizenConnected",
  "CitizenDisconnected",
  "CitizenSpawned",
  "CitizenKicked",
  "CitizenInjured",
  "CitizenDied",
  "CitizenBodyDied",
  "CitizenRespawned",
  "TaskStarted",
  "TaskCompleted",
  "TaskFailed",
  "ActionStarted",
  "ActionCompleted",
  "ActionFailed",
  "ResourceCollected",
  "ItemCrafted",
  "ObstacleRemovalStarted",
  "ObstacleRemoved",
  "ItemDropped",
  "ItemPickedUp",
  "ItemTransferred",
  "ItemDeposited",
  "ItemWithdrawn",
  "ItemTransferCompleted",
  "ResourceTransferred",
  "ConversationOccurred",
  "RelationshipChanged",
  "MemoryCreated",
  "SettlementNeedDetected",
  "ConstructionStarted",
  "ConstructionProgress",
  "ConstructionBlockPlaced",
  "ConstructionBlockFailed",
  "ConstructionCompleted",
  "LLMDecisionMade",
  "LLMSkipped",
  "HumanDirectiveIssued",
  "HumanDirectiveAccepted",
  "HumanDirectiveCompleted",
  "HumanDirectiveFailed",
  "HumanDirectiveCancelled",
  "HumanDirectiveRejected",
  "SettlementProjectCreated",
  "SettlementProjectBlocked",
  "SettlementProjectCompleted",
  "CraftingCompleted",
  "CraftingFailed",
  "SystemIncident",
  "LessonCreated",
  "FunctionalBlockPlacedWithoutPurpose",
  "WorkstationCreated",
  "WorkstationDestroyed",
  "ResourceReserved",
  "ResourceReleased",
  "SimulationStarted",
  "SimulationStopped",
  "PaperServerReady",
  "ErrorOccurred",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type SimEvent = {
  id: string;
  type: EventType;
  timestamp: string;
  citizenId?: string;
  payload: Record<string, unknown>;
};

export type EventListener = (event: SimEvent) => void;

export class EventBus {
  private readonly listeners = new Set<EventListener>();
  private readonly recent: SimEvent[] = [];
  private readonly maxRecent: number;

  constructor(maxRecent = 500) {
    this.maxRecent = maxRecent;
  }

  emit(event: SimEvent): void {
    this.recent.push(event);
    if (this.recent.length > this.maxRecent) {
      this.recent.shift();
    }
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRecent(limit = 100): SimEvent[] {
    return this.recent.slice(-limit);
  }
}

export function createEvent(
  type: EventType,
  payload: Record<string, unknown> = {},
  citizenId?: string,
): SimEvent {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    citizenId,
    payload,
  };
}
