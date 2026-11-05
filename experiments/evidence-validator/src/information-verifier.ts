import type {
  InformationBoundaryAudit,
  InformationBoundaryViolation,
} from "./types.js";
import type { EventStreamItem, PersistentFactItem } from "./schemas.js";

export type CommunityDirectory = {
  hasCommunity(communityId: string): boolean;
  communityOf(citizenId: string): string | undefined;
  membersOf(communityId: string): readonly string[];
  knowsCitizen(citizenId: string): boolean;
};

export type CommunitySiteDefinition = {
  communityId: string;
  x: number;
  y: number;
  z: number;
};

export function buildDirectory(
  communities: Array<{ id: string; memberIds: readonly string[] }>,
): CommunityDirectory {
  const members = new Map<string, readonly string[]>();
  const owner = new Map<string, string>();

  for (const c of communities) {
    members.set(c.id, [...c.memberIds]);
    for (const m of c.memberIds) {
      owner.set(m, c.id);
    }
  }

  return {
    hasCommunity: (id) => members.has(id),
    communityOf: (cId) => owner.get(cId),
    membersOf: (id) => members.get(id) ?? [],
    knowsCitizen: (cId) => owner.has(cId),
  };
}

export function auditInformationBoundaries(args: {
  events: EventStreamItem[];
  deliveries?: Array<{ citizenId: string; eventId: string; deliveredAt: string }>;
  facts?: PersistentFactItem[];
  directory: CommunityDirectory;
  rivalSites?: CommunitySiteDefinition[];
  citizenPositionsHistory?: Map<string, Array<{ x: number; y: number; z: number }>>;
}): InformationBoundaryAudit {
  const violations: InformationBoundaryViolation[] = [];
  const eventMap = new Map<string, EventStreamItem>();
  for (const e of args.events) {
    eventMap.set(e.id, e);
  }

  let observedFactsCount = 0;
  let communicatedClaimsCount = 0;

  // 1. Audit Deliveries against SEC-001 Visibility and Audience
  if (args.deliveries) {
    for (const delivery of args.deliveries) {
      const event = eventMap.get(delivery.eventId);
      if (!event) {
        violations.push({
          violationType: "UNKNOWN_AUDIENCE_LEAK",
          eventId: delivery.eventId,
          citizenId: delivery.citizenId,
          description: `Delivery references nonexistent event ID '${delivery.eventId}'`,
        });
        continue;
      }

      const payload = event.payload;
      const vis = (payload.visibility ?? {}) as Record<string, unknown>;
      const visClass = vis.class as string | undefined;

      if (!visClass || visClass === "unknown" || visClass === "observer_only") {
        violations.push({
          violationType: "UNKNOWN_AUDIENCE_LEAK",
          eventId: event.id,
          citizenId: delivery.citizenId,
          description: `Event with visibility class '${visClass ?? "undefined"}' was delivered to citizen '${delivery.citizenId}'`,
        });
        continue;
      }

      if (visClass === "actor_private") {
        const owner =
          (Array.isArray(vis.audienceIds) ? vis.audienceIds[0] : undefined) ??
          vis.speakerId ??
          event.citizenId;
        if (owner !== delivery.citizenId) {
          violations.push({
            violationType: "ACTOR_PRIVATE_LEAK",
            eventId: event.id,
            citizenId: delivery.citizenId,
            sourceCitizenId: typeof owner === "string" ? owner : undefined,
            description: `actor_private event owned by '${String(owner)}' leaked to '${delivery.citizenId}'`,
          });
        }
      } else if (visClass === "directed") {
        const audience = Array.isArray(vis.audienceIds) ? (vis.audienceIds as string[]) : [];
        if (!audience.includes(delivery.citizenId)) {
          violations.push({
            violationType: "UNKNOWN_AUDIENCE_LEAK",
            eventId: event.id,
            citizenId: delivery.citizenId,
            description: `directed event delivered to unaddressed citizen '${delivery.citizenId}' (audience: [${audience.join(", ")}])`,
          });
        }
      } else if (visClass === "nearby_speech") {
        const audience = Array.isArray(vis.audienceIds) ? (vis.audienceIds as string[]) : [];
        if (audience.length === 0 || (!audience.includes(delivery.citizenId) && vis.speakerId !== delivery.citizenId)) {
          violations.push({
            violationType: "UNSUBSTANTIATED_SPEECH",
            eventId: event.id,
            citizenId: delivery.citizenId,
            description: `nearby_speech delivered without substantiated audience or reader was not in hearing audience`,
          });
        }
      } else if (visClass === "settlement_public") {
        const aud = (vis.audience ?? {}) as Record<string, unknown>;
        if (aud.scope !== "community" || typeof aud.communityId !== "string") {
          violations.push({
            violationType: "UNKNOWN_AUDIENCE_LEAK",
            eventId: event.id,
            citizenId: delivery.citizenId,
            description: `settlement_public event missing required community audience`,
          });
        } else {
          const readerComm = args.directory.communityOf(delivery.citizenId);
          if (readerComm !== aud.communityId) {
            violations.push({
              violationType: "RIVAL_SETTLEMENT_LEAK",
              eventId: event.id,
              citizenId: delivery.citizenId,
              description: `Cross-community leakage: settlement_public event scoped to '${aud.communityId}' delivered to member of '${readerComm ?? "unknown"}'`,
            });
          }
        }
      }
    }
  }

  // 2. Audit Persistent Facts: distinguish observed facts vs communicated claims
  if (args.facts) {
    for (const fact of args.facts) {
      if (fact.kind === "observed_fact") {
        observedFactsCount++;
      } else if (fact.kind === "communicated_claim") {
        communicatedClaimsCount++;
      }

      // Check if a spoken claim was improperly promoted to confirmed world truth
      if (fact.sourceEventId) {
        const sourceEvent = eventMap.get(fact.sourceEventId);
        if (!sourceEvent) {
          violations.push({
            violationType: "MISSING_SOURCE_EVENT",
            factId: fact.id,
            eventId: fact.sourceEventId,
            citizenId: fact.citizenId,
            description: `Persistent fact '${fact.id}' references nonexistent source event '${fact.sourceEventId}'`,
          });
        } else {
          if (
            sourceEvent.type === "ConversationOccurred" &&
            fact.kind === "observed_fact" &&
            sourceEvent.citizenId !== fact.citizenId
          ) {
            violations.push({
              violationType: "CLAIM_PROMOTED_TO_FACT",
              factId: fact.id,
              eventId: sourceEvent.id,
              citizenId: fact.citizenId,
              sourceCitizenId: sourceEvent.citizenId,
              description: `Reported claim from '${sourceEvent.citizenId ?? "unknown"}' was recorded as an 'observed_fact' instead of 'communicated_claim'`,
            });
          }
        }
      }

      // Check for unobserved rival settlement coordinates in facts
      if (args.rivalSites) {
        const citizenComm = args.directory.communityOf(fact.citizenId);
        for (const site of args.rivalSites) {
          if (site.communityId !== citizenComm) {
            const coordRegex = new RegExp(
              `\\b(?:x[:=\\s]*)?${Math.floor(site.x)}[\\s,]+(?:z[:=\\s]*)?${Math.floor(site.z)}\\b|rival\\s+settlement|enemy\\s+camp`,
              "i",
            );
            if (coordRegex.test(fact.content)) {
              // Verify if citizen ever traveled near this site
              const positions = args.citizenPositionsHistory?.get(fact.citizenId) ?? [];
              const visited = positions.some(
                (p) => Math.hypot(p.x - site.x, p.z - site.z) <= 32,
              );
              if (!visited) {
                violations.push({
                  violationType: "RIVAL_SETTLEMENT_LEAK",
                  factId: fact.id,
                  citizenId: fact.citizenId,
                  description: `Citizen '${fact.citizenId}' holds unobserved rival settlement knowledge for community '${site.communityId}' without physical exploration proof`,
                  evidenceRef: `coordinates: (${site.x}, ${site.z})`,
                });
              }
            }
          }
        }
      }

      // Check for private chest content disclosure in facts
      if (
        fact.content.includes("private chest") ||
        fact.content.includes("personal chest") ||
        fact.content.includes("secret storage")
      ) {
        const sourceEvent = fact.sourceEventId ? eventMap.get(fact.sourceEventId) : undefined;
        if (sourceEvent && sourceEvent.citizenId && sourceEvent.citizenId !== fact.citizenId) {
          violations.push({
            violationType: "PRIVATE_CHEST_LEAK",
            factId: fact.id,
            eventId: sourceEvent.id,
            citizenId: fact.citizenId,
            sourceCitizenId: sourceEvent.citizenId,
            description: `Private chest knowledge of '${sourceEvent.citizenId}' revealed to '${fact.citizenId}'`,
          });
        }
      }
    }
  }

  return {
    totalAuditedEvents: args.events.length,
    totalAuditedFacts: args.facts?.length ?? 0,
    observedFactsCount,
    communicatedClaimsCount,
    violations,
    valid: violations.length === 0,
  };
}
