import type { CitizenRecord, SimEvent, Vec3 } from "@civ/shared";
import type { CivilizationStore } from "./store.js";
import type { SettlementRuntime } from "./settlement-runtime.js";

type BodyLike = {
  stopPathfinding(): void;
  markDeceased(): void;
};

type CitizenLike = {
  record: CitizenRecord;
  busy: boolean;
  abort?: AbortController;
  body: BodyLike;
};

export function applyTerminalDeath(input: {
  event: SimEvent;
  store: CivilizationStore;
  runtime: SettlementRuntime;
  citizen?: CitizenLike;
}): void {
  const citizen = input.citizen;
  if (!citizen) return;
  const position = asVec3(input.event.payload.position) ?? citizen.record.lastKnownPosition;
  citizen.abort?.abort();
  citizen.busy = false;
  citizen.body.stopPathfinding();
  citizen.body.markDeceased();
  citizen.record.status = "dead";
  citizen.record.diedAt = input.event.timestamp;
  citizen.record.deathPosition = position;
  citizen.record.reason = "permanently deceased";
  input.runtime.releaseCitizen(citizen.record.id);
  input.store.markDeceased(citizen.record.id, input.event.timestamp, position);
}

export function applyTemporaryBodyDeath(input: {
  citizen: CitizenLike;
  store: CivilizationStore;
  runtime: SettlementRuntime;
}): void {
  input.citizen.abort?.abort();
  input.citizen.busy = false;
  input.citizen.body.stopPathfinding();
  input.citizen.record.status = "respawning";
  input.citizen.record.reason = "body died; waiting to respawn";
  input.runtime.releaseCitizen(input.citizen.record.id);
  input.store.upsertCitizen(input.citizen.record);
}

export function applyBodyRespawn(citizen: CitizenLike): void {
  citizen.busy = false;
  citizen.record.status = "online";
  citizen.record.reason = "respawned; replanning";
}

function asVec3(value: unknown): Vec3 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const pos = value as { x?: unknown; y?: unknown; z?: unknown };
  if (typeof pos.x !== "number" || typeof pos.y !== "number" || typeof pos.z !== "number") return undefined;
  return { x: pos.x, y: pos.y, z: pos.z };
}
