import { describe, expect, it } from "vitest";
import { createEvent } from "@civ/shared";
import { observersForEvent, tryAdaptSimEvent } from "./events.js";
import { itemReceivedEvent } from "./events.js";

describe("objective event adapters", () => {
  it("maps ItemTransferred without inventing extra facts", () => {
    const event = createEvent(
      "ItemTransferred",
      { giverId: "citizen_maya", receiverId: "citizen_atlas", item: "bread", count: 3, receiverHunger: 4 },
      "citizen_maya",
    );
    const adapted = tryAdaptSimEvent(event);
    expect(adapted?.category).toBe("citizen_item_received");
    expect(adapted?.facts.item).toBe("bread");
    expect(adapted?.facts.count).toBe(3);
  });

  it("returns null for unsupported live events instead of faking them", () => {
    const event = createEvent("LLMSkipped", { reason: "cooldown" }, "citizen_atlas");
    expect(tryAdaptSimEvent(event)).toBeNull();
  });

  it("does not grant distant citizens observer access", () => {
    const event = itemReceivedEvent({
      giverId: "citizen_maya",
      receiverId: "citizen_atlas",
      item: "bread",
      count: 3,
      location: { x: 0, y: 64, z: 0 },
    });
    const observers = observersForEvent(event, {
      nearbyRadius: 24,
      citizens: [
        { id: "citizen_atlas", position: { x: 1, y: 64, z: 1 } },
        { id: "citizen_maya", position: { x: 2, y: 64, z: 1 } },
        { id: "citizen_kai", position: { x: 200, y: 64, z: 200 } },
      ],
    });
    expect(observers.map((o) => o.citizenId).sort()).toEqual(["citizen_atlas", "citizen_maya"]);
  });
});
