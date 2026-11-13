import type {
  ActionAttemptEvidence,
  ActionObservationEvidence,
  ActionVerificationResult,
  ActionVerificationStatus,
  ProvenanceClassification,
} from "./types.js";

function getCount(inv: Record<string, number>, key: string): number {
  return Object.hasOwn(inv, key) ? (inv[key] ?? 0) : 0;
}

function computeInventoryDelta(
  before: Record<string, number> | undefined,
  after: Record<string, number> | undefined,
): Record<string, number> {
  const b = before ?? {};
  const a = after ?? {};
  const delta: Record<string, number> = {};
  const allKeys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const key of allKeys) {
    const diff = getCount(a, key) - getCount(b, key);
    if (diff !== 0) {
      delta[key] = diff;
    }
  }
  return delta;
}

export function verifySingleAction(
  attempt: ActionAttemptEvidence,
  observation: ActionObservationEvidence,
  options?: {
    knownWorldEvents?: Set<string>;
    citizenBeliefs?: Set<string>;
  },
): ActionVerificationResult {
  const reasons: string[] = [];
  const invDelta = computeInventoryDelta(
    observation.beforeInventory,
    observation.afterInventory,
  );

  // 1. Cross-actor attribution check
  if (attempt.citizenId !== observation.citizenId) {
    reasons.push(
      `Cross-actor attribution mismatch: attempt belongs to '${attempt.citizenId}', observation attributed to '${observation.citizenId}'`,
    );
    return {
      attemptId: attempt.attemptId,
      citizenId: attempt.citizenId,
      action: attempt.action,
      decisionEventId: attempt.decisionEventId,
      decisionSource: attempt.decisionSource,
      status: "CORRUPTED",
      classification: "unverified_assertion",
      chain: {
        worldEventProven: false,
        legitimatelyObserved: false,
        legitimateBelief: false,
        decisionDocumented: true,
        actionAttempted: true,
        physicalOutcomeVerified: false,
      },
      physicalDeltas: {
        inventoryDelta: invDelta,
        worldChangesCount: observation.worldChanges.length,
      },
      reasons,
    };
  }

  // 2. Timestamp sanity check (if timestamps present)
  if (attempt.timestamp && observation.timestamp) {
    const attemptTime = new Date(attempt.timestamp).getTime();
    const obsTime = new Date(observation.timestamp).getTime();
    if (obsTime < attemptTime) {
      reasons.push(
        `Timestamp anachronism: observation timestamp (${observation.timestamp}) precedes attempt timestamp (${attempt.timestamp})`,
      );
      return {
        attemptId: attempt.attemptId,
        citizenId: attempt.citizenId,
        action: attempt.action,
        decisionEventId: attempt.decisionEventId,
        decisionSource: attempt.decisionSource,
        status: "CORRUPTED",
        classification: "unverified_assertion",
        chain: {
          worldEventProven: false,
          legitimatelyObserved: false,
          legitimateBelief: false,
          decisionDocumented: true,
          actionAttempted: true,
          physicalOutcomeVerified: false,
        },
        physicalDeltas: {
          inventoryDelta: invDelta,
          worldChangesCount: observation.worldChanges.length,
        },
        reasons,
      };
    }
  }

  // 3. Physical witness check per action type
  let physicalOutcomeVerified = false;
  let distanceToTarget: number | undefined;
  let hungerDelta: number | undefined;
  let healthDelta: number | undefined;

  if (observation.hungerBefore !== undefined && observation.hungerAfter !== undefined) {
    hungerDelta = observation.hungerAfter - observation.hungerBefore;
  }
  if (observation.healthBefore !== undefined && observation.healthAfter !== undefined) {
    healthDelta = observation.healthAfter - observation.healthBefore;
  }

  if (attempt.action === "gather") {
    const item = attempt.expectedItem;
    if (!item) {
      reasons.push("Gather action missing expectedItem declaration");
    } else {
      const delta = getCount(observation.afterInventory, item) - getCount(observation.beforeInventory, item);
      if (delta > 0) {
        physicalOutcomeVerified = true;
      } else {
        reasons.push(
          `Phantom gather detected: expected '${item}' count increase, but inventory delta was ${delta}`,
        );
      }
    }
  } else if (attempt.action === "craft") {
    const item = attempt.expectedItem;
    if (!item) {
      reasons.push("Craft action missing expectedItem declaration");
    } else {
      const delta = getCount(observation.afterInventory, item) - getCount(observation.beforeInventory, item);
      const ingredientsConsumed = Object.keys(observation.beforeInventory).some(
        (ingredient) =>
          ingredient !== item &&
          getCount(observation.beforeInventory, ingredient) >
            getCount(observation.afterInventory, ingredient),
      );

      if (delta > 0 && ingredientsConsumed) {
        physicalOutcomeVerified = true;
      } else if (delta <= 0) {
        reasons.push(`Craft action did not increase crafted item '${item}' (delta=${delta})`);
      } else if (!ingredientsConsumed) {
        reasons.push(
          `Craft action gained '${item}' without consuming any required ingredients (free crafting)`,
        );
      }
    }
  } else if (attempt.action === "eat") {
    const item = attempt.expectedItem;
    const itemConsumed = item
      ? getCount(observation.afterInventory, item) < getCount(observation.beforeInventory, item)
      : Object.values(invDelta).some((d) => d < 0);

    const hungerIncreased = (hungerDelta ?? 0) > 0;

    if (itemConsumed && hungerIncreased) {
      physicalOutcomeVerified = true;
    } else if (!itemConsumed) {
      reasons.push("Eat action did not consume food item from inventory");
    } else if (!hungerIncreased) {
      reasons.push(
        `Phantom calorie restoration: eat action reported success without hunger increase (hungerDelta=${hungerDelta ?? "none"})`,
      );
    }
  } else if (attempt.action === "place") {
    const item = attempt.expectedItem;
    const target = attempt.target;
    if (!item || !target) {
      reasons.push("Place action missing expectedItem or target point");
    } else {
      const itemConsumed =
        getCount(observation.beforeInventory, item) > getCount(observation.afterInventory, item);
      const matchingWorldChange = Array.isArray(observation.worldChanges) && observation.worldChanges.some(
        (change) =>
          change.after === item &&
          change.before !== change.after &&
          change.position.x === target.x &&
          change.position.y === target.y &&
          change.position.z === target.z,
      );

      if (itemConsumed && matchingWorldChange) {
        physicalOutcomeVerified = true;
      } else {
        if (!itemConsumed) {
          reasons.push(`Place action did not consume block item '${item}' from inventory`);
        }
        if (!matchingWorldChange) {
          reasons.push(
            `Place action lacked verified world block mutation at target (${target.x}, ${target.y}, ${target.z}) with '${item}'`,
          );
        }
      }
    }
  } else if (attempt.action === "move") {
    const target = attempt.target;
    const position = observation.position;
    const range = attempt.range ?? 1;

    if (!target || !position) {
      reasons.push("Move action missing target or observed position");
    } else {
      distanceToTarget = Math.hypot(
        target.x - position.x,
        target.y - position.y,
        target.z - position.z,
      );
      if (distanceToTarget <= range) {
        physicalOutcomeVerified = true;
      } else {
        reasons.push(
          `Target distance violation: ending position was ${distanceToTarget.toFixed(2)} blocks away (allowed range: ${range})`,
        );
      }
    }
  } else if (attempt.action === "speech") {
    const recipients = observation.authorizedRecipients ?? [];
    if (recipients.length > 0) {
      physicalOutcomeVerified = true;
    } else {
      reasons.push("Speech action missing substantiated authorized recipients");
    }
  } else {
    // Other action types require successReported and at least one verifiable change
    if (
      observation.successReported &&
      (Object.keys(invDelta).length > 0 || observation.worldChanges.length > 0)
    ) {
      physicalOutcomeVerified = true;
    } else {
      reasons.push(`Unknown or unverified action type '${attempt.action}'`);
    }
  }

  // 4. Determine overall status and classification
  let status: ActionVerificationStatus;
  let classification: ProvenanceClassification;

  if (observation.failureCode || !observation.successReported) {
    status = "FAILED";
    classification = "attempted_action";
    if (observation.failureCode) {
      reasons.push(`Action failed with code: ${observation.failureCode}`);
    }
  } else if (physicalOutcomeVerified) {
    status = "VERIFIED";
    classification = "successful_action";
  } else {
    status = "UNVERIFIED";
    classification = "unverified_assertion";
  }

  const decisionDocumented = Boolean(attempt.decisionEventId);
  const actionAttempted = true;
  const worldEventProven = physicalOutcomeVerified;
  const legitimatelyObserved = physicalOutcomeVerified;
  const legitimateBelief = decisionDocumented && (options?.citizenBeliefs ? options.citizenBeliefs.has(attempt.decisionEventId) : true);

  return {
    attemptId: attempt.attemptId,
    citizenId: attempt.citizenId,
    action: attempt.action,
    decisionEventId: attempt.decisionEventId,
    decisionSource: attempt.decisionSource,
    status,
    classification,
    chain: {
      worldEventProven,
      legitimatelyObserved,
      legitimateBelief,
      decisionDocumented,
      actionAttempted,
      physicalOutcomeVerified,
    },
    physicalDeltas: {
      inventoryDelta: invDelta,
      hungerDelta,
      healthDelta,
      worldChangesCount: observation.worldChanges.length,
      positionReached: distanceToTarget !== undefined ? distanceToTarget <= (attempt.range ?? 1) : undefined,
      distanceToTarget,
      recipientCount: observation.authorizedRecipients?.length,
    },
    reasons,
    failureCode: observation.failureCode,
  };
}
