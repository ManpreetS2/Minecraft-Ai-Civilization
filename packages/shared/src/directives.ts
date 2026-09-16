export const DIRECTIVE_INTENTS = [
  "gather_wood",
  "gather_food",
  "mine_stone",
  "craft_tools",
  "obtain_item",
  "use_storage",
  "deposit_items",
  "withdraw_items",
  "transfer_item",
  "contribute_to_project",
  "return_to_settlement",
  "seek_safety",
  "assist_citizen",
  "explore",
  "rest",
  "stop_current_task",
] as const;

export type DirectiveIntent = (typeof DIRECTIVE_INTENTS)[number];
export type DirectiveMode = "SUGGESTION" | "DIRECTIVE" | "ADMIN_OVERRIDE";
export type DirectiveStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "FAILED" | "REJECTED" | "CANCELLED";

export const DIRECTIVE_MODES: DirectiveMode[] = ["SUGGESTION", "DIRECTIVE", "ADMIN_OVERRIDE"];

export const DIRECTIVE_MODE_HELP: Record<DirectiveMode, string> = {
  SUGGESTION: "The citizen hears this as context and may choose not to follow it.",
  DIRECTIVE: "A high-priority request. Followed unless there is an emergency, missing tools, or the world makes it impossible.",
  ADMIN_OVERRIDE:
    "Development mode. Cancels the current high-level task and prioritizes this. Still cannot bypass Minecraft physics, inventory, pathfinding, or emergency reflexes.",
};

export type HumanDirective = {
  id: string;
  targetIds: string[];
  mode: DirectiveMode;
  rawText: string;
  parsedIntent: DirectiveIntent;
  item?: string;
  assistTargetId?: string;
  status: DirectiveStatus;
  createdAt: string;
  completedAt?: string;
  failureReason?: string;
  outcomes: Record<string, DirectiveStatus>;
};

export type DirectiveParseResult =
  | {
      ok: true;
      intent: DirectiveIntent;
      targetNames: string[];
      everyone: boolean;
      item?: string;
      assistName?: string;
    }
  | { ok: false; error: string };

const INTENT_PATTERNS: Array<{ intent: DirectiveIntent; pattern: RegExp }> = [
  { intent: "stop_current_task", pattern: /\b(stop|cancel|halt|quit)\b/i },
  { intent: "return_to_settlement", pattern: /\b(return|come back|go back|head back).*(village|settlement|camp|home)\b/i },
  { intent: "contribute_to_project", pattern: /\b(help|finish|work on|build).*(shelter|project|roof|house)\b/i },
  { intent: "deposit_items", pattern: /\b(put|store|deposit|dump).*(chest|storage|wood|log)/i },
  { intent: "withdraw_items", pattern: /\b(take|withdraw|get).*(from|out of).*(chest|storage)\b/i },
  { intent: "transfer_item", pattern: /\b(give|hand|bring)\b/i },
  { intent: "craft_tools", pattern: /\b(stone tools?|tools?|pickaxe|axe|craft)\b/i },
  { intent: "gather_wood", pattern: /\b(wood|logs?|timber|chop|lumber)\b/i },
  { intent: "gather_food", pattern: /\b(food|hungry|eat|hunt|berries|bread)\b/i },
  { intent: "mine_stone", pattern: /\b(stone|cobble|mine)\b/i },
  { intent: "use_storage", pattern: /\b(chest|storage|storehouse)\b/i },
  { intent: "seek_safety", pattern: /\b(safe|shelter|flee|danger)\b/i },
  { intent: "assist_citizen", pattern: /\b(help|assist)\b/i },
  { intent: "explore", pattern: /\b(explore|look around|scout)\b/i },
  { intent: "rest", pattern: /\b(rest|wait|idle)\b/i },
];

const UNSAFE =
  /\b(eval|exec|spawn|rm\b|drop table|javascript:|function\s*\(|process\.|child_process|require\(|import\(|sql|powershell|cmd\.exe|\/bin\/|teleport|setblock|\/give|\/kill)\b/i;

export function parseHumanDirective(
  rawText: string,
  citizens: Array<{ id: string; name: string }>,
): DirectiveParseResult {
  const text = rawText.trim();
  if (!text) return { ok: false, error: "Type an instruction first." };
  if (UNSAFE.test(text)) return { ok: false, error: "That instruction isn't allowed." };
  if (text.length > 280) return { ok: false, error: "Keep the instruction under 280 characters." };

  const everyone = /\b(everyone|everybody|all of you|all citizens)\b/i.test(text);
  const named = citizens.filter((c) => new RegExp(`\\b${escapeReg(c.name)}\\b`, "i").test(text));
  const targetNames = everyone ? citizens.map((c) => c.name) : named.map((c) => c.name);

  const matched = INTENT_PATTERNS.find((row) => row.pattern.test(text));
  if (!matched) return { ok: false, error: "I don't recognize a safe high-level task in that instruction." };

  let assistName: string | undefined;
  if (matched.intent === "assist_citizen" || matched.intent === "transfer_item") {
    assistName = named.length > 1 ? named[named.length - 1]?.name : named[0]?.name;
  }

  let item: string | undefined;
  if (/\bwood|logs?\b/i.test(text)) item = "oak_log";
  if (/\bfood|bread|apple\b/i.test(text)) item = item ?? "food";
  if (/\bstone pick/i.test(text)) item = "stone_pickaxe";
  if (/\bwooden pick/i.test(text)) item = "wooden_pickaxe";

  return {
    ok: true,
    intent: matched.intent,
    targetNames,
    everyone,
    assistName,
    item,
  };
}

export function resolveDirectiveTargets(
  parsed: Extract<DirectiveParseResult, { ok: true }>,
  citizens: Array<{ id: string; name: string }>,
  selectedIds: string[],
): { ok: true; targetIds: string[] } | { ok: false; error: string } {
  const known = new Set(citizens.map((c) => c.id));
  const selected = selectedIds.filter((id) => id && id !== "*");
  if (selected.length > 0) {
    const valid = selected.filter((id) => known.has(id));
    if (valid.length === 0) return { ok: false, error: "That citizen is not in the simulation." };
    return { ok: true, targetIds: valid };
  }
  if (parsed.everyone) return { ok: true, targetIds: citizens.map((c) => c.id) };
  const named = citizens.filter((c) => parsed.targetNames.includes(c.name)).map((c) => c.id);
  if (named.length === 0) return { ok: false, error: "Say who should do this, or choose Everyone." };
  return { ok: true, targetIds: named };
}

export function isDirectiveIntent(value: string): value is DirectiveIntent {
  return (DIRECTIVE_INTENTS as readonly string[]).includes(value);
}

export function isDirectiveMode(value: string): value is DirectiveMode {
  return DIRECTIVE_MODES.includes(value as DirectiveMode);
}

export function normalizeDirectiveStatus(value: unknown): DirectiveStatus {
  const status = String(value ?? "ACTIVE").toUpperCase();
  if (status === "ACCEPTED") return "ACTIVE";
  if (
    status === "PENDING" ||
    status === "ACTIVE" ||
    status === "COMPLETED" ||
    status === "FAILED" ||
    status === "REJECTED" ||
    status === "CANCELLED"
  ) {
    return status;
  }
  return "ACTIVE";
}

export function adaptDirective(raw: unknown, fallbackCitizens: Array<{ id: string; name: string }> = []): HumanDirective | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "");
  if (!id) return undefined;
  const targetIds = Array.isArray(row.targetIds) ? row.targetIds.map(String) : fallbackCitizens.map((c) => c.id);
  const intent = String(row.parsedIntent ?? row.intent ?? "");
  if (intent && !isDirectiveIntent(intent) && intent !== "socialize") return undefined;
  const parsedIntent: DirectiveIntent = isDirectiveIntent(intent) ? intent : "explore";
  const status = normalizeDirectiveStatus(row.status);
  const outcomesRaw = row.outcomes && typeof row.outcomes === "object" ? (row.outcomes as Record<string, unknown>) : {};
  const outcomes: Record<string, DirectiveStatus> = Object.fromEntries(
    targetIds.map((targetId) => [targetId, normalizeDirectiveStatus(outcomesRaw[targetId] ?? status)]),
  );
  return {
    id,
    targetIds,
    mode: isDirectiveMode(String(row.mode)) ? String(row.mode) as DirectiveMode : "DIRECTIVE",
    rawText: String(row.rawText ?? row.instruction ?? ""),
    parsedIntent,
    item: typeof row.item === "string" ? row.item : undefined,
    assistTargetId: typeof row.assistTargetId === "string" ? row.assistTargetId : undefined,
    status,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    completedAt: typeof row.completedAt === "string" ? row.completedAt : undefined,
    failureReason: typeof row.failureReason === "string" ? row.failureReason : typeof row.reason === "string" ? row.reason : undefined,
    outcomes,
  };
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
