export type VillageFeatureKind = "house" | "bed" | "farmland" | "path" | "workstation" | "chest" | "villager";

export type VillageObservation = {
  kind: VillageFeatureKind;
  present: boolean;
  claimedBySettlement?: boolean;
};

export type VillageFact = {
  fact: string;
  ownership: "unknown" | "settlement" | "unclaimed";
  socialClaim: false;
};

export function interpretVillageFeature(observation: VillageObservation): VillageFact {
  if (!observation.present) {
    return { fact: `No ${observation.kind} observed.`, ownership: "unknown", socialClaim: false };
  }
  const ownership = observation.claimedBySettlement ? "settlement" : "unclaimed";
  if (observation.kind === "chest") {
    return {
      fact: "There is a chest in a village structure.",
      ownership,
      socialClaim: false,
    };
  }
  return {
    fact: `A village ${observation.kind} is present in the world.`,
    ownership,
    socialClaim: false,
  };
}

export function villageChestImpliesOwnership(): boolean {
  return false;
}
