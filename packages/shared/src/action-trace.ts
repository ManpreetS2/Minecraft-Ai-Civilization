/**
 * Standardized citizen action tracing.
 * Preferred sequence: DECISION → PLAN → SKILL_START → SKILL_RESULT → WORLD_VERIFICATION → MEMORY/EVENT UPDATE
 * Avoid noisy per-tick logs; emit one span per high-level action.
 */

export const TRACE_PHASES = [
  "DECISION",
  "PLAN",
  "SKILL_START",
  "SKILL_RESULT",
  "WORLD_VERIFICATION",
  "MEMORY_EVENT_UPDATE",
] as const;

export type TracePhase = (typeof TRACE_PHASES)[number];

export type InventoryDelta = {
  item: string;
  before: number;
  after: number;
  delta: number;
};

export type ActionTrace = {
  citizenId?: string;
  citizenName?: string;
  taskId?: string;
  actionId: string;
  phase: TracePhase;
  reason?: string;
  optionsConsidered?: string[];
  selectedAction?: string;
  modelProvider?: string;
  modelName?: string;
  fallbackUsed?: boolean;
  startedAt: string;
  endedAt?: string;
  elapsedMs?: number;
  inventoryDelta?: InventoryDelta[];
  target?: { x: number; y: number; z: number };
  permissionResult?: string;
  navigationResult?: string;
  failureCode?: string;
  workComplete?: boolean;
  details?: Record<string, unknown>;
};

export type ActionTraceListener = (trace: ActionTrace) => void;

const SECRET_KEY = /key|token|authorization|secret|password|api[_-]?key/i;
const MAX_DETAIL_STRING = 240;

export function redactTraceValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/(api[_-]?key|authorization|bearer|token)\s*[:=]\s*["']?[\w.-]+/gi, "$1=[REDACTED]")
      .replace(/Bearer\s+[\w.-]+/gi, "Bearer [REDACTED]")
      .slice(0, MAX_DETAIL_STRING);
  }
  if (Array.isArray(value)) return value.map(redactTraceValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[REDACTED]" : redactTraceValue(v);
    }
    return out;
  }
  return value;
}

export function sanitizeTrace(trace: ActionTrace): ActionTrace {
  const elapsedMs =
    trace.elapsedMs !== undefined
      ? Math.max(0, trace.elapsedMs)
      : trace.endedAt && trace.startedAt
        ? Math.max(0, Date.parse(trace.endedAt) - Date.parse(trace.startedAt))
        : undefined;
  return {
    ...trace,
    elapsedMs,
    reason: typeof trace.reason === "string" ? trace.reason.slice(0, MAX_DETAIL_STRING) : trace.reason,
    details: trace.details ? (redactTraceValue(trace.details) as Record<string, unknown>) : undefined,
  };
}

export class ActionTracer {
  private readonly listeners = new Set<ActionTraceListener>();
  private readonly recent: ActionTrace[] = [];
  private tickNoise = 0;

  constructor(private readonly maxRecent = 200) {}

  emit(trace: ActionTrace): void {
    // Refuse per-tick spam markers.
    if (trace.details && (trace.details as { tick?: unknown }).tick === true) {
      this.tickNoise += 1;
      return;
    }
    const clean = sanitizeTrace(trace);
    this.recent.push(clean);
    if (this.recent.length > this.maxRecent) this.recent.shift();
    for (const listener of this.listeners) listener(clean);
  }

  on(listener: ActionTraceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRecent(limit = 50): ActionTrace[] {
    return this.recent.slice(-limit);
  }

  get droppedTickNoise(): number {
    return this.tickNoise;
  }

  formatLine(trace: ActionTrace): string {
    const clean = sanitizeTrace(trace);
    const who = clean.citizenName ?? clean.citizenId ?? "?";
    const model =
      clean.modelProvider || clean.modelName
        ? ` model=${clean.modelProvider ?? "?"}/${clean.modelName ?? "?"}${clean.fallbackUsed ? "(fallback)" : ""}`
        : "";
    const fail = clean.failureCode ? ` fail=${clean.failureCode}` : "";
    const elapsed = clean.elapsedMs !== undefined ? ` ${clean.elapsedMs}ms` : "";
    return `[TRACE ${clean.phase}] ${who} action=${clean.actionId}${model}${fail}${elapsed}`;
  }
}

export function inventoryDelta(
  before: Array<{ name: string; count: number }>,
  after: Array<{ name: string; count: number }>,
): InventoryDelta[] {
  const map = new Map<string, { before: number; after: number }>();
  for (const item of before) {
    const cur = map.get(item.name) ?? { before: 0, after: 0 };
    cur.before += item.count;
    map.set(item.name, cur);
  }
  for (const item of after) {
    const cur = map.get(item.name) ?? { before: 0, after: 0 };
    cur.after += item.count;
    map.set(item.name, cur);
  }
  return [...map.entries()]
    .map(([item, counts]) => ({
      item,
      before: counts.before,
      after: counts.after,
      delta: counts.after - counts.before,
    }))
    .filter((row) => row.delta !== 0);
}

export function startTrace(partial: Omit<ActionTrace, "startedAt" | "phase"> & { phase?: TracePhase }): ActionTrace {
  return sanitizeTrace({
    ...partial,
    phase: partial.phase ?? "SKILL_START",
    startedAt: new Date().toISOString(),
  });
}

export function endTrace(
  trace: ActionTrace,
  phase: TracePhase,
  patch: Partial<ActionTrace> = {},
): ActionTrace {
  const endedAt = new Date().toISOString();
  const started = Date.parse(trace.startedAt);
  const computed = Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0;
  // Failure remains failure — never promote workComplete when failureCode set.
  const failureCode = patch.failureCode ?? trace.failureCode;
  const workComplete =
    failureCode !== undefined && failureCode !== ""
      ? false
      : (patch.workComplete ?? trace.workComplete);
  return sanitizeTrace({
    ...trace,
    ...patch,
    phase,
    endedAt,
    failureCode,
    workComplete,
    elapsedMs: Math.max(0, patch.elapsedMs ?? computed),
  });
}
