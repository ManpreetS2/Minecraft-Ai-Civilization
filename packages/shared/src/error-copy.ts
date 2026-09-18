export type TranslatedError = {
  headline?: string;
  subtext: string;
};

export function translateError(error?: string, task?: unknown): TranslatedError {
  if (!error) return { subtext: "Something went wrong." };
  const text = error.trim();
  const taskText = String(task ?? "");

  if (/TARGET_BLACKLISTED|blacklisted/i.test(text)) {
    return {
      headline: "gave up on an unreachable target and chose another one",
      subtext: "That target could not be reached, so another one will be tried.",
    };
  }
  if (/NO_RECIPE|UNKNOWN_RECIPE/i.test(text)) {
    const item = text.replace(/UNKNOWN_RECIPE|NO_RECIPE/i, "").trim().replaceAll("_", " ") || "that item";
    return { subtext: `Didn't have a known recipe for ${item}.` };
  }
  if (/UNKNOWN_ITEM/i.test(text)) {
    const item = text.replace(/UNKNOWN_ITEM/i, "").trim().replaceAll("_", " ") || "that item";
    return { subtext: `${item} is not a Minecraft item in this version.` };
  }
  if (/MISSING/.test(text.toUpperCase()) && /STICK/.test(text.toUpperCase())) {
    const count = text.match(/(\d+)/)?.[1];
    return { subtext: count ? `Missing ${count} sticks.` : "Missing sticks." };
  }
  if (/MISSING/.test(text.toUpperCase()) && /PICKAXE|TOOL/.test(text.toUpperCase())) {
    return { subtext: "A required tool wasn't available." };
  }
  if (/MISSING_INGREDIENT|PREREQUISITE_MISSING|Need \d+/i.test(text)) {
    return { subtext: humanizeLoose(text) };
  }
  if (/NO_CRAFTING_TABLE|NEED_CRAFTING_TABLE|NEED_WORKSTATION/i.test(text)) {
    return { subtext: "A crafting table is required and none is reachable." };
  }
  if (/PURPOSELESS_PLACEMENT|FunctionalBlockPlacedWithoutPurpose/i.test(text)) {
    return { subtext: "That functional block had no valid placement purpose. This is a mechanics bug, not a citizen lesson." };
  }
  if (/INVENTORY_FULL|inventory is full/i.test(text)) {
    return { subtext: "Inventory is full." };
  }
  if (/TRANSFER_INCOMPLETE/i.test(text)) {
    return { subtext: "The item left one inventory but did not arrive in the intended inventory." };
  }
  if (/ITEM_RESERVED/i.test(text)) {
    return { subtext: "Those items are reserved for another task." };
  }
  if (/RECIPIENT_FULL/i.test(text)) {
    return { subtext: "The other inventory cannot hold that many items." };
  }
  if (/DROP_FAILED|PICKUP_FAILED/i.test(text)) {
    return { subtext: "The physical drop or pickup did not complete." };
  }
  if (/timed out after \d+ milliseconds|keepalive|client timed out|econnreset|socket hang up/i.test(text)) {
    return {
      headline: "lost connection to the Minecraft server",
      subtext: "Trying to reconnect...",
    };
  }
  if (/TIMEOUT|GoalNear|timed out heading|stuck heading|no path to/i.test(text)) {
    const coords = text.match(/(-?\d+)[, ]\s*(-?\d+)[, ]\s*(-?\d+)/);
    const shelter = /shelter|site|build_shelter|contribute_to_project/i.test(taskText + text);
    const place = shelter ? "the shelter site" : "that place";
    const near = coords ? ` near X ${coords[1]}, Y ${coords[2]}, Z ${coords[3]}` : "";
    return {
      headline: shelter ? `couldn't reach ${place}` : undefined,
      subtext: `Movement stopped after no progress was made${near}.`,
    };
  }
  if (/MISSING_FUEL|WORKSTATION_UNAVAILABLE/i.test(text)) {
    return { subtext: "A furnace or fuel was not available." };
  }
  if (/LADDER_FAILED/i.test(text)) {
    return { subtext: "Climbing that ladder did not produce a real height change." };
  }
  if (/CROP_IMMATURE/i.test(text)) {
    return { subtext: "That crop is not mature yet." };
  }
  if (/PATH_BLOCKED|no path/i.test(text)) {
    return { subtext: "Couldn't find a safe path there." };
  }
  return { subtext: humanizeLoose(text) };
}

function humanizeLoose(error: string): string {
  return error
    .replaceAll(/citizen_[a-z]+/gi, "a citizen")
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}
