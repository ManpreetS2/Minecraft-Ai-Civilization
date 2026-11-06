import type { DecisionSource, EventBus, Vec3 } from "@civ/shared";

/**
 * Per-execution evidence written by the executor.
 * `planSource` is the planner's source. A sink for a scripted rehearsal must
 * label `llm` as `scripted` and must not call that a live model decision.
 * `expectedDelta` is the planned item change, captured before the physical
 * operation. It is never the observed inventory difference.
 */
export type ActionEvidenceBegin = {
  citizenId: string;
  eventId: string;
  planSource: DecisionSource;
  action: "gather";
  task: string;
  expectedItem?: string;
  expectedDelta: Record<string, number>;
  originPosition?: Vec3;
  target?: Vec3;
};

export type ActionEvidenceObservation = {
  successReported: boolean;
  beforeInventory: Record<string, number>;
  afterInventory: Record<string, number>;
  position?: Vec3;
  hungerBefore?: number;
  hungerAfter?: number;
  worldChanges: Array<{ position: Vec3; before: string; after: string }>;
  failureCode?: string;
};

export type ActionEvidenceSink = {
  /** Called after the attempt id is known and before the physical operation. Returns the attempt id. */
  begin(input: ActionEvidenceBegin): string;
  finish(attemptId: string, observation: ActionEvidenceObservation): void;
};

const sinks = new WeakMap<EventBus, ActionEvidenceSink>();

export function bindActionEvidence(events: EventBus, sink: ActionEvidenceSink | undefined): void {
  if (sink) sinks.set(events, sink);
  else sinks.delete(events);
}

export function actionEvidenceFor(events: EventBus): ActionEvidenceSink | undefined {
  return sinks.get(events);
}
