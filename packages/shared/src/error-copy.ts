export type TranslatedError = {
  headline?: string;
  subtext: string;
};

export function translateError(error?: string, task?: unknown): TranslatedError {
  if (!error) return { subtext: "Something went wrong." };
  const text = error.trim();
  const upper = text.toUpperCase();
  const taskText = String(task ?? "");

  if (/TARGET_BLACKLISTED|blacklisted/i.test(text)) {
    return {
      headline: "gave up on an unreachable target and chose another one",
      subtext: "That target could not be reached, so another one will be tried.",
    };
  }
  if (/NO_RECIPE/i.test(text)) {
    const item = text.replace(/NO_RECIPE/i, "").trim().replaceAll("_", " ") || "that item";
    return { subtext: `Didn't have a known recipe for ${item}.` };
  }
  if (/MISSING/.test(upper) && /STICK/.test(upper)) {
    const count = text.match(/(\d+)/)?.[1];
    return { subtext: count ? `Missing ${count} sticks.` : "Missing sticks." };
  }
  if (/MISSING/.test(upper) && /PICKAXE|TOOL/.test(upper)) {
    return { subtext: "A required tool wasn't available." };
  }
  if (/INVENTORY_FULL|inventory is full/i.test(text)) {
    return { subtext: "Inventory is full." };
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
