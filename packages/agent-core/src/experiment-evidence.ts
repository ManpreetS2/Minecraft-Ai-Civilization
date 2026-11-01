import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeFileSync, fsyncSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";

const identifier = z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/);
const itemName = z.string().regex(/^(?:[a-z0-9_]+:)?[a-z0-9_]+$/);
const inventory = z.record(itemName, z.number().int().nonnegative());
const point = z
  .object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() })
  .strict();
const attemptSchema = z
  .object({
    action: z.enum(["gather", "craft", "place", "eat", "move", "speech"]),
    decisionSource: z.enum(["model", "planner", "reflex"]),
    decisionEventId: identifier,
    expectedItem: itemName.optional(),
    target: point.optional(),
    range: z.number().finite().nonnegative().max(8).optional(),
  })
  .strict();
const observationSchema = z
  .object({
    successReported: z.boolean(),
    beforeInventory: inventory,
    afterInventory: inventory,
    position: point.optional(),
    hungerBefore: z.number().min(0).max(20).optional(),
    hungerAfter: z.number().min(0).max(20).optional(),
    worldChanges: z.array(
      z.object({ position: point, before: itemName, after: itemName }).strict(),
    ),
    authorizedRecipients: z.array(identifier).optional(),
    failureCode: z
      .string()
      .regex(/^[A-Z0-9_]+$/)
      .optional(),
  })
  .strict();
export type ExperimentAttempt = z.infer<typeof attemptSchema>;
export type ExperimentObservation = z.infer<typeof observationSchema>;
type Pending = { citizenId: string; attempt: ExperimentAttempt };

function witnessed(attempt: ExperimentAttempt, o: ExperimentObservation): boolean {
  if (!o.successReported) return false;
  const item = attempt.expectedItem;
  const own = (bag: Record<string, number>, key: string) =>
    Object.hasOwn(bag, key) ? bag[key]! : 0;
  const delta = item ? own(o.afterInventory, item) - own(o.beforeInventory, item) : 0;
  if (attempt.action === "gather") return Boolean(item && delta > 0);
  if (attempt.action === "craft")
    return Boolean(
      item &&
      delta > 0 &&
      Object.keys(o.beforeInventory).some(
        (ingredient) =>
          ingredient !== item &&
          own(o.beforeInventory, ingredient) > own(o.afterInventory, ingredient),
      ),
    );
  if (attempt.action === "eat") return delta < 0 && (o.hungerAfter ?? 0) > (o.hungerBefore ?? 20);
  if (attempt.action === "speech") return Boolean(o.authorizedRecipients?.length);
  if (attempt.action === "move")
    return Boolean(
      attempt.target &&
      o.position &&
      Math.hypot(
        attempt.target.x - o.position.x,
        attempt.target.y - o.position.y,
        attempt.target.z - o.position.z,
      ) <= (attempt.range ?? 1),
    );
  return Boolean(
    item &&
    delta < 0 &&
    attempt.target &&
    o.worldChanges.some(
      (change) =>
        change.after === item &&
        change.before !== change.after &&
        change.position.x === attempt.target!.x &&
        change.position.y === attempt.target!.y &&
        change.position.z === attempt.target!.z,
    ),
  );
}

/** Operator-only append journal. No raw prompts/responses, secrets or citizen retrieval interface. */
export class ExperimentEvidenceJournal {
  private readonly fd: number;
  private previousHash = "";
  private seq = 0;
  private closed = false;
  private readonly pending = new Map<string, Pending>();
  private readonly totals = {
    attempted: 0,
    verified: 0,
    unverified: 0,
    interrupted: 0,
    failed: 0,
    deaths: 0,
    respawns: 0,
    interventions: 0,
  };

  constructor(
    path: string,
    private readonly experimentId: string,
    private readonly citizens: ReadonlySet<string>,
    private readonly mode: "offline" | "live",
  ) {
    if (!isAbsolute(path) || !/^[a-zA-Z0-9_-]{1,64}$/.test(experimentId))
      throw new Error("invalid evidence destination");
    mkdirSync(dirname(path), { recursive: true });
    this.fd = openSync(path, "wx", 0o600); // Never overwrite a previous experiment.
    this.append({ kind: "start", recordingAudience: "operator_only", mode });
  }

  private append(payload: Record<string, unknown>): void {
    if (this.closed) throw new Error("evidence journal closed");
    const row = {
      experimentId: this.experimentId,
      seq: this.seq + 1,
      at: new Date().toISOString(),
      previousHash: this.previousHash,
      ...payload,
    };
    const hash = createHash("sha256").update(JSON.stringify(row)).digest("hex");
    writeFileSync(this.fd, `${JSON.stringify({ ...row, hash })}\n`);
    this.seq += 1;
    this.previousHash = hash;
  }

  forCitizen(citizenId: string) {
    if (!this.citizens.has(citizenId)) throw new Error("unknown experiment citizen");
    return {
      attempt: (input: ExperimentAttempt): string => {
        const attempt = attemptSchema.parse(input);
        const id = randomUUID();
        this.append({ kind: "action_attempt", citizenId, attemptId: id, ...attempt });
        this.pending.set(id, { citizenId, attempt });
        this.totals.attempted += 1;
        return id;
      },
      observe: (attemptId: string, input: ExperimentObservation): void => {
        const pending = this.pending.get(attemptId);
        if (!pending || pending.citizenId !== citizenId)
          throw new Error("action correlation mismatch");
        const observation = observationSchema.parse(input);
        const verified = witnessed(pending.attempt, observation);
        this.append({ kind: "action_observation", citizenId, attemptId, verified, ...observation });
        this.pending.delete(attemptId);
        if (!observation.successReported) this.totals.failed += 1;
        else if (verified) this.totals.verified += 1;
        else this.totals.unverified += 1;
      },
      lifecycle: (kind: "death" | "respawn", position?: z.infer<typeof point>): void => {
        if (kind !== "death" && kind !== "respawn") throw new Error("invalid lifecycle kind");
        if (position) point.parse(position);
        this.append({ kind, citizenId, position });
        if (kind === "death") {
          this.totals.deaths += 1;
          for (const [id, pending] of this.pending) {
            if (pending.citizenId !== citizenId) continue;
            this.append({ kind: "action_interrupted", citizenId, attemptId: id, cause: "death" });
            this.pending.delete(id);
            this.totals.interrupted += 1;
          }
        } else this.totals.respawns += 1;
      },
    };
  }

  recordTick(durationMs: number, measuredTps?: number): void {
    if (
      !Number.isFinite(durationMs) ||
      durationMs < 0 ||
      (measuredTps !== undefined &&
        (!Number.isFinite(measuredTps) || measuredTps < 0 || measuredTps > 20))
    )
      throw new Error("invalid performance observation");
    this.append({ kind: "tick", durationMs, measuredTps });
  }

  recordIntervention(code: "operator_stop" | "operator_restart" | "human_directive"): void {
    if (!["operator_stop", "operator_restart", "human_directive"].includes(code))
      throw new Error("invalid intervention code");
    this.append({ kind: "intervention", code });
    this.totals.interventions += 1;
  }

  operatorSummary() {
    return {
      experimentId: this.experimentId,
      mode: this.mode,
      ...this.totals,
      incompleteActions: this.pending.size,
    };
  }

  close(completedDuration: boolean): void {
    if (this.closed) return;
    try {
      this.append({ kind: "shutdown", completedDuration, ...this.operatorSummary() });
      fsyncSync(this.fd);
    } finally {
      closeSync(this.fd);
      this.closed = true;
    }
  }
}
