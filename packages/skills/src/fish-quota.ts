/**
 * Per-citizen multi-catch fishing quota.
 *
 * Each owner keeps a private ledger. Cod/salmon/tropical_fish/pufferfish count
 * toward the target; junk, uncollected drops, and baseline inventory do not.
 * Incomplete work reports PARTIAL x/5 and never claims 5/5.
 */
import { fail, ok, type ActionResult, type ErrorCode, type Vec3 } from "@civ/shared";
import { evaluateReturnHome } from "@civ/minecraft-adapter";
import type { SkillContext } from "./context.js";
import { countItem, depositItem, durabilityFromItem } from "./inventory-service.js";
import { assertPermittedStorage } from "./mine.js";
import { fishAtShore, type FishingRequest } from "./fish.js";

export const FISH_QUOTA_TARGET = 5;
export const FISH_QUOTA_MAX_ATTEMPTS = 12;
export const FISH_QUOTA_TIMEOUT_DEFAULT_MS = 420_000;
export const FISH_QUOTA_TIMEOUT_CAP_MS = 600_000;
/** Adjacent shoreline cells are allowed; the same block is not. */
export const TWO_FISH_MIN_STAND_SEPARATION = 1;
/** Keep both bodies on the same pond, not two distant fisheries. */
export const TWO_FISH_MAX_STAND_SEPARATION = 8;

export const FISH_QUOTA_ITEMS = ["cod", "salmon", "tropical_fish", "pufferfish"] as const;
export type QuotaSpecies = (typeof FISH_QUOTA_ITEMS)[number];
export type CitizenFishRole = "Kai" | "Atlas";
export type QuotaFishingVerdict = "PASS" | "FAIL" | "PARTIAL";
export type QuotaStorageVerdict = "PASS" | "FAIL";

export type ItemCount = { name: string; count: number };

export type CitizenFishLedger = {
  ownerId: string;
  role: CitizenFishRole;
  initialQuota: Record<string, number>;
  caught: Record<string, number>;
  deposited: Record<string, number>;
  attempts: number;
  creditedEventIds: string[];
  events: Array<{ t: number; kind: string; detail: string }>;
};

export type FishQuotaStop =
  | { continue: true }
  | { continue: false; complete: true }
  | { continue: false; complete: false; code: ErrorCode; error: string };

export type FishQuotaResult = {
  ownerId: string;
  role: CitizenFishRole;
  fishing: QuotaFishingVerdict;
  storage: QuotaStorageVerdict;
  caughtCount: number;
  depositedCount: number;
  caught: Record<string, number>;
  deposited: Record<string, number>;
  attempts: number;
  progress: string;
  events: CitizenFishLedger["events"];
};

export type FishQuotaAttempt = () => Promise<{
  ok: boolean;
  caught?: Record<string, number>;
  code?: ErrorCode;
  error?: string;
  eventId?: string;
}>;

export type FishQuotaDeposit = (items: Record<string, number>) => Promise<{
  ok: boolean;
  deposited?: Record<string, number>;
  code?: ErrorCode;
  error?: string;
}>;

const QUOTA_SET = new Set<string>(FISH_QUOTA_ITEMS);

export function emptyQuotaCounts(): Record<string, number> {
  return { cod: 0, salmon: 0, tropical_fish: 0, pufferfish: 0 };
}

export function clampFishQuotaBounds(input: { target?: number; maxAttempts?: number; timeoutMs?: number }): {
  target: number;
  maxAttempts: number;
  timeoutMs: number;
} {
  return {
    target: Math.min(FISH_QUOTA_TARGET, Math.max(1, Math.floor(input.target ?? FISH_QUOTA_TARGET))),
    maxAttempts: Math.min(24, Math.max(1, Math.floor(input.maxAttempts ?? FISH_QUOTA_MAX_ATTEMPTS))),
    timeoutMs: Math.min(FISH_QUOTA_TIMEOUT_CAP_MS, Math.max(5_000, Math.floor(input.timeoutMs ?? FISH_QUOTA_TIMEOUT_DEFAULT_MS))),
  };
}

export function snapshotQuotaCounts(items: ItemCount[]): Record<string, number> {
  const out = emptyQuotaCounts();
  for (const item of items) {
    if (!QUOTA_SET.has(item.name) || item.count <= 0) continue;
    out[item.name] = (out[item.name] ?? 0) + item.count;
  }
  return out;
}

export function quotaFishCount(counts: Record<string, number>): number {
  let sum = 0;
  for (const name of FISH_QUOTA_ITEMS) sum += Math.max(0, counts[name] ?? 0);
  return sum;
}

export function mergeCounts(base: Record<string, number>, add: Record<string, number>): Record<string, number> {
  const out = { ...base };
  for (const [name, count] of Object.entries(add)) {
    if (!QUOTA_SET.has(name) || count <= 0) continue;
    out[name] = (out[name] ?? 0) + count;
  }
  return out;
}

export function rodUsable(inventory: Array<{ name: string; count: number; durabilityUsed?: number; maxDurability?: number }>): {
  present: boolean;
  broken: boolean;
} {
  const rods = inventory.filter((item) => item.name === "fishing_rod" && item.count > 0);
  if (rods.length === 0) return { present: false, broken: false };
  const broken = rods.every((rod) => {
    const fact = durabilityFromItem(rod);
    return fact.known && (fact.remaining ?? 0) <= 0;
  });
  return { present: true, broken };
}

export function createCitizenFishLedger(
  ownerId: string,
  role: CitizenFishRole,
  inventory: ItemCount[],
  now = 0,
): CitizenFishLedger {
  return {
    ownerId,
    role,
    initialQuota: snapshotQuotaCounts(inventory),
    caught: emptyQuotaCounts(),
    deposited: emptyQuotaCounts(),
    attempts: 0,
    creditedEventIds: [],
    events: [{ t: now, kind: "start", detail: `${role}/${ownerId} baseline=${JSON.stringify(snapshotQuotaCounts(inventory))}` }],
  };
}

export function creditCatch(
  ledger: CitizenFishLedger,
  gained: Record<string, number>,
  target = FISH_QUOTA_TARGET,
  eventId?: string,
  now = Date.now(),
): CitizenFishLedger {
  if (eventId && ledger.creditedEventIds.includes(eventId)) {
    return {
      ...ledger,
      events: [...ledger.events, { t: now, kind: "duplicate", detail: eventId }],
    };
  }
  const remaining = Math.max(0, target - quotaFishCount(ledger.caught));
  const caught = { ...ledger.caught };
  let room = remaining;
  for (const name of FISH_QUOTA_ITEMS) {
    if (room <= 0) break;
    const add = Math.min(room, Math.max(0, gained[name] ?? 0));
    if (add <= 0) continue;
    caught[name] = (caught[name] ?? 0) + add;
    room -= add;
  }
  return {
    ...ledger,
    caught,
    creditedEventIds: eventId ? [...ledger.creditedEventIds, eventId] : ledger.creditedEventIds,
    events: [...ledger.events, { t: now, kind: "catch", detail: JSON.stringify({ ownerId: ledger.ownerId, gained, credited: caught }) }],
  };
}

export function depositableFromInventory(
  ledger: CitizenFishLedger,
  currentInventory: ItemCount[],
): Record<string, number> {
  const current = snapshotQuotaCounts(currentInventory);
  const out = emptyQuotaCounts();
  for (const name of FISH_QUOTA_ITEMS) {
    const credited = Math.max(0, (ledger.caught[name] ?? 0) - (ledger.deposited[name] ?? 0));
    const physical = Math.max(0, (current[name] ?? 0) - (ledger.initialQuota[name] ?? 0));
    out[name] = Math.min(credited, physical);
  }
  return out;
}

export function applyDeposit(
  ledger: CitizenFishLedger,
  deposited: Record<string, number>,
  now = Date.now(),
): CitizenFishLedger {
  const next = { ...ledger.deposited };
  for (const name of FISH_QUOTA_ITEMS) {
    const add = Math.max(0, deposited[name] ?? 0);
    if (add <= 0) continue;
    next[name] = (next[name] ?? 0) + add;
  }
  return {
    ...ledger,
    deposited: next,
    events: [...ledger.events, { t: now, kind: "deposit", detail: JSON.stringify({ ownerId: ledger.ownerId, deposited }) }],
  };
}

export function fishQuotaVerdict(ledger: CitizenFishLedger, target = FISH_QUOTA_TARGET): {
  fishing: QuotaFishingVerdict;
  storage: QuotaStorageVerdict;
  caughtCount: number;
  depositedCount: number;
  progress: string;
} {
  const caughtCount = quotaFishCount(ledger.caught);
  const depositedCount = quotaFishCount(ledger.deposited);
  const fishing: QuotaFishingVerdict = caughtCount >= target ? "PASS" : caughtCount > 0 ? "PARTIAL" : "FAIL";
  const storage: QuotaStorageVerdict = depositedCount >= target && depositedCount === caughtCount ? "PASS" : "FAIL";
  return { fishing, storage, caughtCount, depositedCount, progress: `${Math.min(caughtCount, target)}/${target}` };
}

export function evaluateFishQuotaStop(input: {
  ledger: CitizenFishLedger;
  target?: number;
  attempts: number;
  maxAttempts: number;
  elapsedMs: number;
  timeoutMs: number;
  signalAborted?: boolean;
  food?: number;
  health?: number;
  rodPresent: boolean;
  rodBroken?: boolean;
  chestDenied?: boolean;
  inventoryFull?: boolean;
  returnHomeStop?: boolean;
}): FishQuotaStop {
  const target = input.target ?? FISH_QUOTA_TARGET;
  if (quotaFishCount(input.ledger.caught) >= target) return { continue: false, complete: true };
  if (input.signalAborted) {
    return { continue: false, complete: false, code: "CANCELLED", error: `Fishing quota cancelled at ${quotaFishCount(input.ledger.caught)}/${target}` };
  }
  if (input.chestDenied) {
    return { continue: false, complete: false, code: "ACCESS_DENIED", error: "Designated chest is not permitted for this citizen" };
  }
  if (!input.rodPresent) {
    return { continue: false, complete: false, code: "MISSING_TOOL", error: "Need a fishing rod to continue the quota" };
  }
  if (input.rodBroken) {
    return { continue: false, complete: false, code: "MISSING_TOOL", error: "Fishing rod durability is exhausted" };
  }
  if (typeof input.health === "number" && input.health <= 6) {
    return { continue: false, complete: false, code: "HAZARD_BLOCKED", error: `Health ${input.health} is too low to keep fishing` };
  }
  if (typeof input.food === "number" && input.food <= 6) {
    return { continue: false, complete: false, code: "TIMEOUT", error: `Hunger ${input.food} is too low to keep fishing` };
  }
  if (input.inventoryFull && quotaFishCount(input.ledger.caught) < target) {
    return { continue: false, complete: false, code: "INVENTORY_FULL", error: "Inventory is full before the quota was met" };
  }
  if (input.returnHomeStop) {
    const have = quotaFishCount(input.ledger.caught);
    return {
      continue: false,
      complete: false,
      code: "CURFEW_STOP",
      error: `stopped optional fishing quota at ${have}/${target}; workComplete false`,
    };
  }
  if (input.attempts >= input.maxAttempts) {
    return { continue: false, complete: false, code: "TIMEOUT", error: `Attempt budget ${input.maxAttempts} exhausted at ${quotaFishCount(input.ledger.caught)}/${target}` };
  }
  if (input.elapsedMs >= input.timeoutMs) {
    return { continue: false, complete: false, code: "TIMEOUT", error: `Time budget exhausted at ${quotaFishCount(input.ledger.caught)}/${target}` };
  }
  return { continue: true };
}

export function standsSeparated(
  a: Vec3,
  b: Vec3,
  min = TWO_FISH_MIN_STAND_SEPARATION,
  max = TWO_FISH_MAX_STAND_SEPARATION,
): boolean {
  const dist = Math.hypot(a.x - b.x, a.z - b.z);
  return dist >= min && dist <= max;
}

export function sameCell(a: Vec3, b: Vec3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

export function sessionsOverlap(a: { startedAt: number; endedAt: number }, b: { startedAt: number; endedAt: number }): boolean {
  return a.startedAt < b.endedAt && b.startedAt < a.endedAt;
}

export function evaluateTwoBotConcurrency(
  a?: { startedAt: number; endedAt: number },
  b?: { startedAt: number; endedAt: number },
): "PASS" | "FAIL" {
  if (!a || !b) return "FAIL";
  if (a.endedAt <= a.startedAt || b.endedAt <= b.startedAt) return "FAIL";
  return sessionsOverlap(a, b) ? "PASS" : "FAIL";
}

export function toQuotaResult(ledger: CitizenFishLedger, target = FISH_QUOTA_TARGET): FishQuotaResult {
  const verdict = fishQuotaVerdict(ledger, target);
  return {
    ownerId: ledger.ownerId,
    role: ledger.role,
    fishing: verdict.fishing,
    storage: verdict.storage,
    caughtCount: verdict.caughtCount,
    depositedCount: verdict.depositedCount,
    caught: { ...ledger.caught },
    deposited: { ...ledger.deposited },
    attempts: ledger.attempts,
    progress: verdict.progress,
    events: ledger.events,
  };
}

export async function runFishQuotaLoop(input: {
  ledger: CitizenFishLedger;
  attempt: FishQuotaAttempt;
  deposit?: FishQuotaDeposit;
  depositMode?: "after-each" | "final-batch";
  target?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  food?: () => number | undefined;
  health?: () => number | undefined;
  rodPresent?: () => boolean;
  rodBroken?: () => boolean;
  chestDenied?: boolean;
  inventoryFull?: () => boolean;
  returnHomeStop?: () => boolean;
  inventory?: () => ItemCount[];
  now?: () => number;
  startedAt?: number;
}): Promise<{ ledger: CitizenFishLedger; result: FishQuotaResult; code?: ErrorCode; error?: string }> {
  const bounds = clampFishQuotaBounds({
    target: input.target,
    maxAttempts: input.maxAttempts,
    timeoutMs: input.timeoutMs,
  });
  const now = input.now ?? Date.now;
  const startedAt = input.startedAt ?? now();
  let ledger = input.ledger;
  const depositMode = input.depositMode ?? "after-each";

  const stopArgs = () =>
    evaluateFishQuotaStop({
      ledger,
      target: bounds.target,
      attempts: ledger.attempts,
      maxAttempts: bounds.maxAttempts,
      elapsedMs: now() - startedAt,
      timeoutMs: bounds.timeoutMs,
      signalAborted: Boolean(input.signal?.aborted),
      food: input.food?.(),
      health: input.health?.(),
      rodPresent: input.rodPresent?.() ?? true,
      rodBroken: input.rodBroken?.() ?? false,
      chestDenied: input.chestDenied,
      inventoryFull: input.inventoryFull?.() ?? false,
      returnHomeStop: input.returnHomeStop?.() ?? false,
    });

  const maybeDeposit = async (): Promise<{ code?: ErrorCode; error?: string } | undefined> => {
    if (!input.deposit) return undefined;
    const held =
      input.inventory?.() ??
      FISH_QUOTA_ITEMS.map((name) => ({
        name,
        count: (ledger.initialQuota[name] ?? 0) + (ledger.caught[name] ?? 0) - (ledger.deposited[name] ?? 0),
      }));
    const toSend = depositableFromInventory(ledger, held);
    if (quotaFishCount(toSend) <= 0) return undefined;
    const stored = await input.deposit(toSend);
    if (!stored.ok) return { code: stored.code ?? "DEPOSIT_FAILED", error: stored.error ?? "Deposit failed" };
    ledger = applyDeposit(ledger, stored.deposited ?? toSend, now());
    return undefined;
  };

  while (true) {
    const halt = stopArgs();
    if (!halt.continue) {
      if (depositMode === "final-batch" || halt.complete) {
        const dep = await maybeDeposit();
        if (dep) {
          const result = toQuotaResult(ledger, bounds.target);
          result.storage = "FAIL";
          return { ledger, result, code: dep.code, error: dep.error };
        }
      }
      const result = toQuotaResult(ledger, bounds.target);
      if (halt.complete) return { ledger, result };
      return { ledger, result, code: halt.code, error: halt.error };
    }

    const attempt = await input.attempt();
    const missDetail = `${attempt.code ?? "unknown"} ${attempt.error ?? ""}`.trim();
    if (attempt.code === "INTERACTION_FAILED") {
      ledger = {
        ...ledger,
        events: [...ledger.events, { t: now(), kind: "miss", detail: missDetail }],
      };
      continue;
    }
    ledger = { ...ledger, attempts: ledger.attempts + 1 };
    if (attempt.ok && attempt.caught) {
      ledger = creditCatch(ledger, attempt.caught, bounds.target, attempt.eventId, now());
      if (depositMode === "after-each") {
        const dep = await maybeDeposit();
        if (dep) {
          const result = toQuotaResult(ledger, bounds.target);
          result.storage = "FAIL";
          return { ledger, result, code: dep.code, error: dep.error };
        }
      }
      continue;
    }
    ledger = {
      ...ledger,
      events: [...ledger.events, { t: now(), kind: "miss", detail: missDetail }],
    };
    if (attempt.code === "CANCELLED" || attempt.code === "CURFEW_STOP") {
      const result = toQuotaResult(ledger, bounds.target);
      return { ledger, result, code: attempt.code, error: attempt.error ?? "Fishing quota interrupted" };
    }
    if (attempt.code === "ACCESS_DENIED") {
      const result = toQuotaResult(ledger, bounds.target);
      result.storage = "FAIL";
      return { ledger, result, code: "ACCESS_DENIED", error: attempt.error ?? "Chest access denied" };
    }
    if (attempt.code === "MISSING_TOOL" || attempt.code === "HAZARD_BLOCKED" || attempt.code === "INVENTORY_FULL") {
      const result = toQuotaResult(ledger, bounds.target);
      return { ledger, result, code: attempt.code, error: attempt.error };
    }
    // SEARCH_EXHAUSTED / TIMEOUT on a single cast: keep looping until budget ends.
  }
}

export type FishQuotaRequest = FishingRequest & {
  ownerId: string;
  role: CitizenFishRole;
  targetCount?: number;
  maxAttempts?: number;
  depositMode?: "after-each" | "final-batch";
};

export async function fishQuotaAtShore(ctx: SkillContext, request: FishQuotaRequest): Promise<ActionResult<FishQuotaResult>> {
  const started = Date.now();
  const bounds = clampFishQuotaBounds({
    target: request.targetCount,
    maxAttempts: request.maxAttempts,
    timeoutMs: request.timeoutMs,
  });
  const storage = assertPermittedStorage(request.destinationStorage, request.permittedStorage);
  if (!storage.ok) {
    const ledger = createCitizenFishLedger(request.ownerId, request.role, [], started);
    const result = toQuotaResult(ledger, bounds.target);
    result.storage = "FAIL";
    return fail(storage.code, storage.error, 0, false, result);
  }

  const inventory = () => ctx.bot.inventory.items().map((item) => ({ name: item.name, count: item.count }));
  let ledger = createCitizenFishLedger(request.ownerId, request.role, inventory(), started);
  const chest = storage.position;

  const ran = await runFishQuotaLoop({
    ledger,
    target: bounds.target,
    maxAttempts: bounds.maxAttempts,
    timeoutMs: bounds.timeoutMs,
    signal: ctx.signal,
    startedAt: started,
    chestDenied: false,
    food: () => ctx.bot.food,
    health: () => ctx.bot.health,
    rodPresent: () => rodUsable(inventory()).present,
    rodBroken: () => rodUsable(inventory()).broken,
    inventoryFull: () => inventory().reduce((sum, item) => sum + item.count, 0) >= 36 * 64,
    returnHomeStop: () => {
      if (!request.returnHome) return false;
      const pos = ctx.body.position() ?? ctx.bot.entity?.position;
      if (!pos) return false;
      return evaluateReturnHome({
        position: { x: pos.x, y: pos.y, z: pos.z },
        home: request.returnHome,
        timeOfDay: ctx.bot.time?.timeOfDay ?? 0,
      }).shouldStopOptionalWork;
    },
    inventory,
    attempt: async () => {
      const remaining = Math.max(2_000, bounds.timeoutMs - (Date.now() - started));
      const fished = await fishAtShore(ctx, {
        searchOrigin: request.searchOrigin,
        searchRadius: request.searchRadius,
        casts: 1,
        timeoutMs: Math.min(90_000, remaining),
        destinationStorage: request.destinationStorage,
        permittedStorage: request.permittedStorage,
        returnHome: request.returnHome,
        depositCaught: false,
        pickupCatchNames: FISH_QUOTA_ITEMS,
      });
      if (!fished.success) {
        return { ok: false, code: fished.code, error: fished.error };
      }
      const quotaCaught: Record<string, number> = {};
      for (const name of FISH_QUOTA_ITEMS) {
        const n = fished.data.caught[name] ?? 0;
        if (n > 0) quotaCaught[name] = n;
      }
      if (quotaFishCount(quotaCaught) <= 0) {
        return { ok: false, code: "SEARCH_EXHAUSTED", error: "Catch was not a quota fish" };
      }
      return { ok: true, caught: quotaCaught, eventId: `${request.ownerId}-${Date.now()}-${ledger.attempts}` };
    },
    deposit: async (items) => {
      if (!chest) return { ok: false, code: "CONTAINER_NOT_FOUND", error: "No designated chest" };
      const deposited = emptyQuotaCounts();
      for (const name of FISH_QUOTA_ITEMS) {
        const want = items[name] ?? 0;
        if (want <= 0) continue;
        const held = countItem(ctx, name);
        const n = Math.min(want, held);
        if (n <= 0) continue;
        const stored = await depositItem(ctx, name, n, chest);
        if (!stored.success) {
          if (quotaFishCount(deposited) > 0) break;
          return { ok: false, code: stored.code, error: stored.error };
        }
        deposited[name] = (deposited[name] ?? 0) + stored.data.deposited;
      }
      if (quotaFishCount(deposited) <= 0) {
        return { ok: false, code: "DEPOSIT_FAILED", error: "No quota fish moved into the designated chest" };
      }
      return { ok: true, deposited };
    },
    depositMode: request.depositMode ?? "after-each",
  });

  ledger = ran.ledger;
  const result = ran.result;
  if (result.fishing === "PASS" && result.storage === "PASS") {
    return ok(result, Date.now() - started);
  }
  return fail(
    ran.code ?? (result.fishing === "PARTIAL" ? "TIMEOUT" : "SEARCH_EXHAUSTED"),
    ran.error ?? `${request.role} fishing ${result.fishing} ${result.progress} storage ${result.storage}`,
    Date.now() - started,
    result.fishing !== "FAIL",
    result,
  );
}
