/**
 * One writer in a chest compare-and-swap race. The parent spawns two processes
 * against the same database file. Prints `{ ok, revision }` on stdout.
 */
import { communityPhysicalState, physicalBlockKey } from "./community-physical-state.js";
import { CivilizationStore } from "./store.js";

const [path, citizenId, revisionText] = process.argv.slice(2);
if (!path || !citizenId || revisionText === undefined) {
  throw new Error("usage: chest-observation-race-main <db> <citizenId> <expectedRevision>");
}
const expectedRevision = Number(revisionText);
if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("invalid expectedRevision");

const store = new CivilizationStore(path);
try {
  const view = communityPhysicalState(store).forCitizen(citizenId);
  const key = physicalBlockKey("overworld", { x: 12, y: 64, z: 8 });
  const ok = view.recordContainerObservation(key, { bread: 1 }, { expectedRevision });
  const revision = view.observedContainerDetails(key)?.revision ?? null;
  process.stdout.write(`${JSON.stringify({ ok, revision })}\n`);
} finally {
  if (store.isOpen()) store.close();
}
