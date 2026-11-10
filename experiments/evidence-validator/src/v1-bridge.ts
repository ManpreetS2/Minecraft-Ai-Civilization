/**
 * V1 Runtime Event & Evidence Bridge (Mission 005 — Fail-Closed & Provenance Exact)
 *
 * Bridges Codex PR #55 (tools/v1-integration/manifest.ts, validator-adapter.ts)
 * and Cursor PR #56 (5964506cc0862360f6b13ee032423629c061cba8) integrated runtime
 * evidence records into the Antigravity Evidence Validator.
 *
 * MISSION 005 AUDIT POLICY: ZERO FABRICATED EVIDENCE METADATA
 * Every field in a ValidatedManifest must be directly supplied by genuine source evidence.
 * If ANY source field is missing or unverified, no ValidatedManifest is produced,
 * and precise NOT_PROVEN items are emitted for each unverified property.
 */

import type {
  MissingEvidenceItem,
} from "./types.js";
import type {
  EventStreamItem,
  JournalRow,
  PersistentFactItem,
  ValidatedManifest,
} from "./schemas.js";
import type { SourceAttestation } from "./types.js";

/**
 * Shape of V1 RunBundle from tools/v1-integration/manifest.ts
 */
export interface V1RunBundleCitizen {
  id: string;
  family: "gpt" | "claude";
  model: string | null;
  sessionId: string | null;
  authentication: "synthetic" | "api" | "subscription" | null;
  initialInventory: Record<string, number> | null;
  communityId?: string;
  personalitySeed?: string;
}

export interface V1RunBundleAction {
  sequence: number;
  citizenId: string;
  reportedSuccess: boolean;
  observedSuccess: boolean | null;
  inventoryDelta: Record<string, number> | null;
  authorizedKnowledge: boolean | null;
}

export interface V1RunBundle {
  schemaVersion: 1;
  runId: string;
  repository: string;
  sourceSha: string;
  mode: "offline-fixture" | "isolated-live-test" | "public-live-demonstration";
  citizens: V1RunBundleCitizen[];
  fixtureSeed: string | null;
  startingPositions: Record<string, { x: number; y: number; z: number }> | null;
  configuration: Record<string, string | number | boolean | null>;
  startedAt: string | null;
  endedAt: string | null;
  tickSource: "simulated" | "paper" | null;
  ticks: number[] | null;
  command: string;
  exitCode: number | null;
  providerUsage: {
    requests: number | null;
    costUsd: number | null;
    artifact: string | null;
  };
  actions: V1RunBundleAction[];
  expectedActionCount: number | null;
  persistenceArtifact: string | null;
  restarted: boolean;
  validator: { name: string; verdict: "PASS" | "FAIL" | "NOT PROVEN"; artifact: string } | null;
  interventions: string[];
}

export interface V1BridgeResult {
  manifest?: ValidatedManifest;
  runId?: string;
  sourceSha?: string;
  citizens?: string[];
  journalRows: JournalRow[];
  rawJournalLines: string[];
  events: EventStreamItem[];
  facts: PersistentFactItem[];
  deliveries: Array<{ citizenId: string; eventId: string; deliveredAt: string }>;
  notProven: MissingEvidenceItem[];
  gaps: string[];
  sourceAttestation?: SourceAttestation;
}

/**
 * Converts a V1 RunBundle into the validator's input structures.
 * Strictly checks genuine source-backed values for EVERY manifest field.
 * Fails closed without synthesizing defaults.
 */
export function bridgeV1RunBundle(bundle: V1RunBundle, identity: { experimentId?: string } = {}): V1BridgeResult {
  const notProven: MissingEvidenceItem[] = [];
  const gaps: string[] = [];
  const journalRows: JournalRow[] = [];
  const rawJournalLines: string[] = [];
  const events: EventStreamItem[] = [];
  const facts: PersistentFactItem[] = [];
  const deliveries: Array<{ citizenId: string; eventId: string; deliveredAt: string }> = [];

  // 1. Validate bundle integrity & provenance
  if (!bundle.sourceSha || !/^[a-f0-9]{40}$/.test(bundle.sourceSha)) {
    notProven.push({
      code: "INVALID_SOURCE_SHA",
      description: `RunBundle has invalid or non-40-hex sourceSha: '${bundle.sourceSha}'`,
      missingFields: ["sourceSha"],
    });
  }

  // 1b. Check source attestation for live claims (Mission 006)
  const rawAttestation = (bundle.configuration?.["sourceAttestation"] ??
    (bundle as unknown as Record<string, unknown>)["sourceAttestation"]) as SourceAttestation | undefined;
  if (bundle.mode !== "offline-fixture" && (!rawAttestation || rawAttestation.sourceType !== "paper_server_attested")) {
    notProven.push({
      code: "UNPROVEN_PAPER_AUTHENTICITY",
      description: "RunBundle claims 'live-authenticated' mode but lacks verified paper_server_attested attestation",
      missingFields: ["sourceAttestation"],
    });
  }


  // 2. Strict Manifest Audit: verify every single required field without fabrication
  let manifest: ValidatedManifest | undefined = undefined;
  const missingManifestFields: string[] = [];
  const cfg = bundle.configuration ?? {};

  // Provider usage audit (Mission 006)
  if (
    bundle.providerUsage &&
    ((bundle.providerUsage.requests !== null && bundle.providerUsage.requests < 0) ||
      (bundle.providerUsage.costUsd !== null && bundle.providerUsage.costUsd < 0))
  ) {
    missingManifestFields.push("providerUsage");
    notProven.push({
      code: "INVALID_PROVIDER_USAGE",
      description: `RunBundle has invalid negative provider usage (requests: ${bundle.providerUsage.requests}, costUsd: ${bundle.providerUsage.costUsd})`,
      missingFields: ["providerUsage"],
    });
  }

  // Provider usage audit (Mission 006)
  if (
    bundle.providerUsage &&
    ((bundle.providerUsage.requests !== null && bundle.providerUsage.requests < 0) ||
      (bundle.providerUsage.costUsd !== null && bundle.providerUsage.costUsd < 0))
  ) {
    missingManifestFields.push("providerUsage");
    notProven.push({
      code: "INVALID_PROVIDER_USAGE",
      description: `RunBundle has invalid negative provider usage (requests: ${bundle.providerUsage.requests}, costUsd: ${bundle.providerUsage.costUsd})`,
      missingFields: ["providerUsage"],
    });
  }

  // Citizens audit
  for (const c of bundle.citizens) {
    if (!c.model) {
      missingManifestFields.push(`citizens.${c.id}.model`);
      notProven.push({
        code: "MISSING_CITIZEN_MODEL",
        citizenId: c.id,
        description: `Citizen '${c.id}' has null/missing model ID.`,
        missingFields: ["model"],
      });
    }
    if (!c.sessionId) {
      missingManifestFields.push(`citizens.${c.id}.sessionId`);
      notProven.push({
        code: "MISSING_CITIZEN_SESSION",
        citizenId: c.id,
        description: `Citizen '${c.id}' has null/missing session ID.`,
        missingFields: ["sessionId"],
      });
    }
    const communityId = (c as unknown as Record<string, unknown>).communityId ?? (typeof cfg[`communityId_${c.id}`] === "string" ? String(cfg[`communityId_${c.id}`]) : undefined);
    if (!communityId) {
      missingManifestFields.push(`citizens.${c.id}.communityId`);
      notProven.push({
        code: "MISSING_CITIZEN_COMMUNITY",
        citizenId: c.id,
        description: `Citizen '${c.id}' lacks explicit communityId configuration. Validator refuses to assign community by array index.`,
        missingFields: [`communityId_${c.id}`],
      });
    }
    const personalitySeed = (c as unknown as Record<string, unknown>).personalitySeed ?? (typeof cfg[`personalitySeed_${c.id}`] === "string" ? String(cfg[`personalitySeed_${c.id}`]) : undefined);
    if (!personalitySeed) {
      missingManifestFields.push(`citizens.${c.id}.personalitySeed`);
      notProven.push({
        code: "MISSING_CITIZEN_PERSONALITY_SEED",
        citizenId: c.id,
        description: `Citizen '${c.id}' lacks explicit personalitySeed configuration. Validator refuses to fabricate 'seed_${c.id}'.`,
        missingFields: [`personalitySeed_${c.id}`],
      });
    }
  }

  // World seed
  if (!bundle.fixtureSeed) {
    missingManifestFields.push("fixtureSeed");
    notProven.push({
      code: "MISSING_WORLD_SEED",
      description: "RunBundle has null/missing fixtureSeed.",
      missingFields: ["fixtureSeed"],
    });
  }

  // Starting positions & biomes
  if (!bundle.startingPositions) {
    missingManifestFields.push("startingPositions");
    notProven.push({
      code: "MISSING_STARTING_POSITIONS",
      description: "RunBundle has null startingPositions.",
      missingFields: ["startingPositions"],
    });
  } else {
    for (const [id] of Object.entries(bundle.startingPositions)) {
      if (typeof cfg[`biome_${id}`] !== "string" || !cfg[`biome_${id}`]) {
        missingManifestFields.push(`biome_${id}`);
        notProven.push({
          code: "MISSING_SITE_BIOME",
          citizenId: id,
          description: `Starting site for '${id}' lacks explicit observed biome configuration. Validator refuses to default to 'plains'.`,
          missingFields: [`biome_${id}`],
        });
      }
    }
  }

  // Timestamps and duration
  if (!bundle.startedAt || !bundle.endedAt) {
    missingManifestFields.push("startedAt/endedAt");
    notProven.push({
      code: "MISSING_RUN_TIMESTAMPS",
      description: "RunBundle has null startedAt or endedAt.",
      missingFields: ["startedAt", "endedAt"],
    });
  }

  // Server configuration
  const serverVersion = typeof cfg["serverVersion"] === "string" ? cfg["serverVersion"] : undefined;
  const paperBuild = typeof cfg["paperBuild"] === "number" ? cfg["paperBuild"] : undefined;
  const difficulty = typeof cfg["difficulty"] === "string" && ["peaceful", "easy", "normal", "hard"].includes(cfg["difficulty"])
    ? (cfg["difficulty"] as "peaceful" | "easy" | "normal" | "hard")
    : undefined;

  if (!serverVersion || paperBuild === undefined || !difficulty) {
    missingManifestFields.push("configuration.server");
    notProven.push({
      code: "MISSING_SERVER_CONFIG",
      description: "RunBundle configuration lacks genuine serverVersion, paperBuild, or difficulty.",
      missingFields: ["serverVersion", "paperBuild", "difficulty"],
    });
  }

  // Game rules: all must be explicitly observed, not defaulted
  const keepInventory = typeof cfg["keepInventory"] === "boolean" ? cfg["keepInventory"] : undefined;
  const hardcore = typeof cfg["hardcore"] === "boolean" ? cfg["hardcore"] : undefined;
  const doDaylightCycle = typeof cfg["doDaylightCycle"] === "boolean" ? cfg["doDaylightCycle"] : undefined;
  const doMobSpawning = typeof cfg["doMobSpawning"] === "boolean" ? cfg["doMobSpawning"] : undefined;
  const doMobLoot = typeof cfg["doMobLoot"] === "boolean" ? cfg["doMobLoot"] : undefined;

  if (
    keepInventory === undefined ||
    hardcore === undefined ||
    doDaylightCycle === undefined ||
    doMobSpawning === undefined ||
    doMobLoot === undefined
  ) {
    missingManifestFields.push("configuration.gameRules");
    notProven.push({
      code: "MISSING_GAMERULE_CONFIG",
      description: "RunBundle configuration lacks explicit boolean game rules (keepInventory, hardcore, doDaylightCycle, doMobSpawning, doMobLoot). Validator refuses to assume default values.",
      missingFields: ["keepInventory", "hardcore", "doDaylightCycle", "doMobSpawning", "doMobLoot"],
    });
  }

  // Shelter absence proof
  const shelterVerified = cfg["shelterVerifiedAbsent"] === true;
  if (!shelterVerified) {
    missingManifestFields.push("configuration.shelterVerifiedAbsent");
    notProven.push({
      code: "UNVERIFIED_SHELTER_ABSENCE",
      description: "RunBundle provides no physical verification receipt that shelters were absent at start.",
      missingFields: ["shelterVerifiedAbsent"],
    });
  }

  // Budget ceiling
  const budgetCeiling = typeof cfg["budgetCeilingUsd"] === "number" && cfg["budgetCeilingUsd"] > 0
    ? cfg["budgetCeilingUsd"]
    : undefined;
  if (budgetCeiling === undefined) {
    missingManifestFields.push("configuration.budgetCeilingUsd");
    notProven.push({
      code: "MISSING_BUDGET_CEILING",
      description: "RunBundle lacks explicit budgetCeilingUsd.",
      missingFields: ["budgetCeilingUsd"],
    });
  }

  // Operational paths: must be explicitly provided in configuration
  const runRoot = typeof cfg["runRoot"] === "string" ? cfg["runRoot"] : undefined;
  const worldPath = typeof cfg["worldPath"] === "string" ? cfg["worldPath"] : undefined;
  const databasePath = typeof cfg["databasePath"] === "string" ? cfg["databasePath"] : (bundle.persistenceArtifact ?? undefined);
  const evidencePath = typeof cfg["evidencePath"] === "string" ? cfg["evidencePath"] : undefined;

  if (!runRoot || !worldPath || !databasePath || !evidencePath) {
    missingManifestFields.push("configuration.paths");
    notProven.push({
      code: "MISSING_OPERATIONAL_PATHS",
      description: "RunBundle lacks explicit paths configuration (runRoot, worldPath, databasePath, evidencePath). Validator refuses to construct synthetic paths.",
      missingFields: ["runRoot", "worldPath", "databasePath", "evidencePath"],
    });
  }

  // Recording status: must be explicitly declared and observed
  const recordingEnabled = typeof cfg["recordingEnabled"] === "boolean" ? cfg["recordingEnabled"] : undefined;
  const recordingAudience = typeof cfg["recordingAudience"] === "string" && ["operator_only", "citizen_shared"].includes(cfg["recordingAudience"])
    ? (cfg["recordingAudience"] as "operator_only" | "citizen_shared")
    : undefined;

  if (recordingEnabled === undefined || !recordingAudience) {
    missingManifestFields.push("configuration.recording");
    notProven.push({
      code: "MISSING_RECORDING_CONFIG",
      description: "RunBundle configuration lacks explicit recordingEnabled (boolean) or recordingAudience ('operator_only' | 'citizen_shared'). Validator refuses to infer them from bundle mode.",
      missingFields: ["recordingEnabled", "recordingAudience"],
    });
  }

  // Privacy replay proof: must be explicitly supplied with test counts
  const privacyPassed = typeof cfg["privacyReplayPassed"] === "number" ? cfg["privacyReplayPassed"] : undefined;
  const privacyFailed = typeof cfg["privacyReplayFailed"] === "number" ? cfg["privacyReplayFailed"] : undefined;
  const privacySkipped = typeof cfg["privacyReplaySkipped"] === "number" ? cfg["privacyReplaySkipped"] : undefined;

  if (privacyPassed === undefined || privacyFailed === undefined || privacySkipped === undefined) {
    missingManifestFields.push("configuration.privacyReplay");
    notProven.push({
      code: "MISSING_PRIVACY_REPLAY_EVIDENCE",
      description: "RunBundle lacks observed privacy replay test counters (privacyReplayPassed, privacyReplayFailed, privacyReplaySkipped). Validator refuses to initialize them to zero.",
      missingFields: ["privacyReplayPassed", "privacyReplayFailed", "privacyReplaySkipped"],
    });
  }

  // Duration computation
  let durationMinutes = 0;
  if (bundle.startedAt && bundle.endedAt) {
    const elapsedMs = new Date(bundle.endedAt).getTime() - new Date(bundle.startedAt).getTime();
    if (elapsedMs > 0) {
      durationMinutes = Math.min(60, Math.floor(elapsedMs / 60000));
    }
  }

  // Build manifest only when 100% of required fields have genuine source evidence
  if (missingManifestFields.length === 0 && durationMinutes > 0) {
    const stage = bundle.citizens.length === 2 ? "1v1" : "2v2";

    const manifestCitizens = bundle.citizens.map((c) => ({
      id: c.id,
      communityId: String((c as unknown as Record<string, unknown>).communityId ?? cfg[`communityId_${c.id}`]),
      personalitySeed: String((c as unknown as Record<string, unknown>).personalitySeed ?? cfg[`personalitySeed_${c.id}`]),
      family: c.family,
      model: c.model!,
      sessionId: c.sessionId!,
      inventoryVerified: c.initialInventory !== null,
      inventory: c.initialInventory
        ? Object.entries(c.initialInventory).map(([name, count]) => ({ name, count }))
        : [],
      shelterVerifiedAbsent: true,
    }));

    const sites = Object.entries(bundle.startingPositions!).map(([id, pos]) => ({
      communityId: String((manifestCitizens.find((c) => c.id === id)?.communityId) ?? cfg[`communityId_${id}`] ?? "unknown_community"),
      x: pos.x,
      y: pos.y,
      z: pos.z,
      biome: String(cfg[`biome_${id}`]),
    }));

    manifest = {
      experimentId: identity.experimentId ?? bundle.runId,
      sourceSha: bundle.sourceSha,
      stage,
      durationMinutes,
      worldSeed: bundle.fixtureSeed!,
      sites,
      citizens: manifestCitizens,
      server: {
        version: serverVersion!,
        paperBuild: paperBuild!,
        difficulty: difficulty!,
        keepInventory: keepInventory!,
        hardcore: hardcore!,
        doDaylightCycle: doDaylightCycle!,
        doMobSpawning: doMobSpawning!,
        doMobLoot: doMobLoot!,
      },
      paths: {
        runRoot: runRoot!,
        world: worldPath!,
        database: databasePath!,
        evidence: evidencePath!,
      },
      budget: {
        ceilingUsd: budgetCeiling!,
        accountingEnabled: bundle.providerUsage.costUsd !== null,
        unknownUsageFailClosed: true,
      },
      recording: {
        enabled: recordingEnabled!,
        audience: recordingAudience!,
      },
      humanDirectives: bundle.interventions,
      privacyReplay: {
        sourceSha: bundle.sourceSha,
        passed: privacyPassed!,
        failed: privacyFailed!,
        skipped: privacySkipped!,
      },
    };
  } else {
    gaps.push(
      `ValidatedManifest withheld due to missing genuine source fields: [${missingManifestFields.join(", ")}]. Validator refuses to fabricate evidence.`,
    );
  }

  // 3. Ticks: authentic Paper vs simulated
  if (!bundle.ticks || bundle.ticks.length === 0) {
    notProven.push({
      code: "NO_TICK_EVIDENCE",
      description: "RunBundle contains no tick records. Continuous world progression cannot be proven.",
      missingFields: ["ticks"],
    });
  } else {
    if (bundle.tickSource === "simulated") {
      gaps.push("RunBundle tickSource is marked as 'simulated'. Uninterrupted Paper server ticks are unproven.");
    }
  }

  // 4. Actions: physical outcome witness checks
  for (const action of bundle.actions) {
    if (action.observedSuccess === null && action.reportedSuccess) {
      notProven.push({
        code: "UNOBSERVED_ACTION_CLAIM",
        citizenId: action.citizenId,
        description: `Action sequence ${action.sequence} reported success by citizen '${action.citizenId}', but observedSuccess is null (no physical outcome witness receipt).`,
        missingFields: ["observedSuccess"],
      });
    }

    if (action.inventoryDelta && action.observedSuccess === null) {
      notProven.push({
        code: "UNVERIFIED_INVENTORY_DELTA",
        citizenId: action.citizenId,
        description: `Action sequence ${action.sequence} asserts inventory delta without observed physical outcome confirmation.`,
        missingFields: ["observedSuccess"],
      });
    }
  }

  // 5. Interventions: record operator interventions
  for (const intervention of bundle.interventions) {
    events.push({
      id: `intervention-${events.length + 1}`,
      type: "OperatorIntervention",
      timestamp: bundle.startedAt ?? new Date().toISOString(),
      payload: {
        code: "operator_intervention",
        directive: intervention,
      },
    });
  }

  return {
    manifest,
    runId: bundle.runId,
    sourceSha: bundle.sourceSha,
    citizens: bundle.citizens.map((c) => c.id),
    journalRows,
    rawJournalLines,
    events,
    facts,
    deliveries,
    notProven,
    gaps,
  };
}
