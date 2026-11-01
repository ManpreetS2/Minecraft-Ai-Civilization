import { parseCommunityConfig, type AppConfig, type CommunityConfigEntry } from "@civ/shared";
import type { CivilizationStore, CommunityAudit } from "./store.js";

/**
 * SEC-001: the ONLY production path that writes community membership.
 *
 * Membership comes from the orchestrator's own configuration (COMMUNITIES_JSON), never from LLM output, tool
 * calls or HTTP input. Seeding is idempotent; members a listed community no longer names are revoked through the
 * audited `removeCommunityMember` path. A config entry that would move an existing member to a
 * different community is a conflict and throws before anything is written (a move needs an explicit, audited
 * `store.removeCommunityMember` by orchestrator code first).
 *
 * `community-audit-guard.test.ts` fails if any other production file calls the store's community mutators.
 */
export type CommunitySeedResult = { communitiesTouched: number; membersAdded: number; membersRemoved: number };

const AUDIT: CommunityAudit = { actor: "orchestrator-config", reason: "COMMUNITIES_JSON seed" };
const REVOKE_AUDIT: CommunityAudit = { actor: "orchestrator-config", reason: "member removed from COMMUNITIES_JSON" };

export function applyCommunityConfig(
  store: CivilizationStore,
  config: Pick<AppConfig, "COMMUNITIES_JSON">,
): CommunitySeedResult {
  const entries: CommunityConfigEntry[] = parseCommunityConfig(config.COMMUNITIES_JSON);
  const directory = store.getCommunityDirectory();
  for (const entry of entries) {
    for (const memberId of entry.memberIds) {
      const current = directory.communityOf(memberId);
      if (current !== undefined && current !== entry.id) {
        throw new Error(`COMMUNITIES_JSON conflict: ${memberId} is already in community ${current}, not ${entry.id}`);
      }
    }
  }
  let membersAdded = 0;
  let membersRemoved = 0;
  for (const entry of entries) {
    store.upsertCommunity(entry.id, entry.name, AUDIT);
    // The config is the source of truth for the communities it lists: a persisted member it no longer lists loses
    // membership through the AUDITED removal path (which also flags the facts that membership authorized).
    const listed = new Set(entry.memberIds);
    for (const current of store.getCommunityDirectory().membersOf(entry.id)) {
      if (!listed.has(current) && store.removeCommunityMember(entry.id, current, REVOKE_AUDIT)) membersRemoved += 1;
    }
    for (const memberId of entry.memberIds) {
      // An explicit audited removal is a tombstone: the config seed must not silently undo it on the next start.
      // (Re-admitting is a deliberate orchestrator act: store.addCommunityMember with its own audit.)
      if (store.wasMemberRemoved(entry.id, memberId)) continue;
      if (store.addCommunityMember(entry.id, memberId, AUDIT)) membersAdded += 1;
    }
  }
  return { communitiesTouched: entries.length, membersAdded, membersRemoved };
}

const seeded = new WeakMap<CivilizationStore, string>();

/**
 * Seed once per (store, config) from buildCitizenContextPack so the directory exists whenever bulletins are
 * built, without any manager.ts change. A bad or conflicting config is logged and the existing directory is left
 * as it is (fail closed: unknown audiences reach nobody).
 */
export function seedCommunitiesOnce(store: CivilizationStore, config: Pick<AppConfig, "COMMUNITIES_JSON">): void {
  const key = config.COMMUNITIES_JSON ?? "";
  if (seeded.get(store) === key) return;
  seeded.set(store, key);
  try {
    applyCommunityConfig(store, config);
  } catch (error) {
    console.error(`[communities] ignoring COMMUNITIES_JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
