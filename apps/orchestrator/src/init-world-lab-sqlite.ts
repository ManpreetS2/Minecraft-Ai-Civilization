/**
 * One-shot WORLD-LAB sqlite init. Creates ONLY
 * ./data/world-lab-civilization.sqlite via CivilizationStore.
 * Refuses if the file already exists. Never opens live-civ sqlite.
 */
import { existsSync } from "node:fs";
import { CivilizationStore } from "@civ/agent-core";
import { isTestFixtureChest, TEST_FIXTURE_CHESTS, WORLD_LAB_COMMUNAL_CHEST } from "@civ/agent-core";
import { resolveFromRoot } from "@civ/shared";

const LIVE = resolveFromRoot("./data/civilization.sqlite");
const LAB = resolveFromRoot("./data/world-lab-civilization.sqlite");

function main(): void {
  if (LAB === LIVE) {
    throw new Error("Refusing: WORLD-LAB path resolved to live-civ sqlite");
  }
  if (!LAB.replaceAll("\\", "/").endsWith("/data/world-lab-civilization.sqlite")) {
    throw new Error(`Refusing unexpected WORLD-LAB path ${LAB}`);
  }
  if (existsSync(LAB)) {
    throw new Error(`WORLD-LAB sqlite already exists at ${LAB}; will not overwrite`);
  }

  const store = new CivilizationStore(LAB);
  try {
    const citizens = store.getCitizens().map((row) => ({
      id: row.id,
      name: row.name,
      homeId: row.homeId ?? null,
      occupation: row.occupation ?? null,
      lastKnownPosition: row.lastKnownPosition ?? null,
      status: row.status,
    }));
    const homes = citizens.map((row) => ({
      id: row.id,
      claim: store.getCitizenHome(row.id) ?? null,
    }));
    const settlement = store.getSettlement();
    console.log(
      JSON.stringify(
        {
          created: true,
          path: LAB,
          liveCivPath: LIVE,
          citizens,
          homeClaims: homes,
          settlementStorage: settlement.storage ?? null,
          settlementOrigin: settlement.origin ?? null,
          fixtureChestsDenied: TEST_FIXTURE_CHESTS,
          tanneryNotRegistered: settlement.storage == null,
          tanneryWorldCell: WORLD_LAB_COMMUNAL_CHEST,
          pondDenied: TEST_FIXTURE_CHESTS.every((chest) => isTestFixtureChest(chest)),
        },
        null,
        2,
      ),
    );
  } finally {
    store.close();
  }
}

main();
