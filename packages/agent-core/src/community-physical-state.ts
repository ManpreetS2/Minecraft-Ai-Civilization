import type { SettlementState, Vec3 } from "@civ/shared";
import type Database from "better-sqlite3";
import type { CivilizationStore } from "./store.js";

const MIGRATION = "community-physical-v1";

/** Additive migration: legacy ownership is unknown, so no legacy resources are assigned. */
export function physicalMigrationReport(db: Database.Database) {
  return {
    migration: MIGRATION,
    legacyDisposition: "preserve-unassigned" as const,
    legacySettlementIds: (
      db.prepare("SELECT id FROM settlement ORDER BY id").all() as Array<{ id: string }>
    ).map((r) => r.id),
    legacyHomeCount: (db.prepare("SELECT count(*) AS n FROM homes").get() as { n: number }).n,
  };
}

export function migratePhysicalState(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS community_physical_state (
        community_id TEXT PRIMARY KEY REFERENCES communities(id), revision INTEGER NOT NULL,
        state_json TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS physical_resource_holds (
        id TEXT PRIMARY KEY, community_id TEXT NOT NULL, citizen_id TEXT NOT NULL,
        item TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS physical_world_claims (
        resource_key TEXT PRIMARY KEY, citizen_id TEXT NOT NULL, community_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS physical_assets (
        resource_key TEXT PRIMARY KEY, kind TEXT NOT NULL, community_id TEXT NOT NULL,
        owner_id TEXT NOT NULL, position_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS physical_asset_grants (
        resource_key TEXT NOT NULL REFERENCES physical_assets(resource_key), citizen_id TEXT NOT NULL,
        PRIMARY KEY(resource_key,citizen_id)
      );
      CREATE TABLE IF NOT EXISTS physical_asset_contents (
        resource_key TEXT PRIMARY KEY REFERENCES physical_assets(resource_key),
        contents_json TEXT NOT NULL, observed_by TEXT NOT NULL, observed_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS physical_state_audit (
        seq INTEGER PRIMARY KEY, at TEXT NOT NULL, citizen_id TEXT NOT NULL,
        community_id TEXT NOT NULL, action TEXT NOT NULL, record_id TEXT NOT NULL
      );
    `);
    // Validate existing table contracts before committing any DDL or migration marker.
    db.prepare(
      "SELECT community_id,revision,state_json,updated_by,updated_at FROM community_physical_state LIMIT 0",
    ).all();
    db.prepare(
      "SELECT id,community_id,citizen_id,item,quantity,expires_at FROM physical_resource_holds LIMIT 0",
    ).all();
    db.prepare(
      "SELECT resource_key,citizen_id,community_id,expires_at FROM physical_world_claims LIMIT 0",
    ).all();
    db.prepare(
      "SELECT resource_key,kind,community_id,owner_id,position_json FROM physical_assets LIMIT 0",
    ).all();
    db.prepare("SELECT resource_key,citizen_id FROM physical_asset_grants LIMIT 0").all();
    db.prepare("SELECT resource_key,contents_json,observed_by,observed_at FROM physical_asset_contents LIMIT 0").all();
    db.prepare(
      "SELECT seq,at,citizen_id,community_id,action,record_id FROM physical_state_audit LIMIT 0",
    ).all();
    // Additive grant-scope column: same-community grants end when the grantee leaves; explicit
    // cross-community grants (diplomacy) persist until revoked.
    const grantCols = db.prepare("PRAGMA table_info(physical_asset_grants)").all() as Array<{ name: string }>;
    if (!grantCols.some((c) => c.name === "cross_community")) {
      db.exec(
        "ALTER TABLE physical_asset_grants ADD COLUMN cross_community INTEGER NOT NULL DEFAULT 0 CHECK(cross_community IN (0,1))",
      );
      db.exec(`
        UPDATE physical_asset_grants SET cross_community = 1
        WHERE EXISTS (
          SELECT 1 FROM physical_assets a
          WHERE a.resource_key = physical_asset_grants.resource_key
          AND NOT EXISTS (
            SELECT 1 FROM community_members m
            WHERE m.citizen_id = physical_asset_grants.citizen_id AND m.community_id = a.community_id
          )
        )`);
    }
    db.prepare("SELECT resource_key,citizen_id,cross_community FROM physical_asset_grants LIMIT 0").all();
    // Additive observation revision for expectedRevision compare-and-swap (ADV-03 freshness contract).
    const contentCols = db.prepare("PRAGMA table_info(physical_asset_contents)").all() as Array<{ name: string }>;
    if (!contentCols.some((c) => c.name === "revision")) {
      db.exec("ALTER TABLE physical_asset_contents ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
    }
    db.prepare(
      "SELECT resource_key,contents_json,observed_by,observed_at,revision FROM physical_asset_contents LIMIT 0",
    ).all();
    // Monotonic observation token. Not deleted with the asset, so abandon/recreate cannot reuse an old token.
    db.exec(`
      CREATE TABLE IF NOT EXISTS physical_asset_observation_epoch (
        resource_key TEXT PRIMARY KEY,
        revision INTEGER NOT NULL
      );
    `);
    db.prepare("SELECT resource_key, revision FROM physical_asset_observation_epoch LIMIT 0").all();
    db.exec(`
      INSERT OR IGNORE INTO physical_asset_observation_epoch(resource_key, revision)
      SELECT resource_key, revision FROM physical_asset_contents
    `);
    db.prepare("INSERT OR IGNORE INTO sim_meta(key,value) VALUES (?,?)").run(MIGRATION, "1");
  }).immediate();
}

export type PhysicalSnapshot = { revision: number; state: SettlementState };
export type PhysicalAssetKind = "home" | "bed" | "chest" | "crafting_table" | "furnace";
export type PhysicalAsset = {
  key: string;
  kind: PhysicalAssetKind;
  ownerId: string;
  position: Vec3;
};

/** This key arbitrates real world contention across communities, not community metadata visibility. */
export function physicalBlockKey(dimension: string, pos: Vec3): string {
  if (!dimension.trim() || ![pos.x, pos.y, pos.z].every(Number.isFinite))
    throw new Error("invalid world position");
  return JSON.stringify([dimension, Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)]);
}

function emptyState(communityId: string): SettlementState {
  return {
    id: communityId,
    name: communityId,
    food: 0,
    wood: 0,
    stone: 0,
    beds: 0,
    housingCapacity: 0,
    tools: 0,
    shelterComplete: false,
    storageContents: {},
    workstations: { craftingTables: [], chests: [], furnaces: [] },
    needs: [],
  };
}

/**
 * Trusted runtime API, never a model/tool endpoint. Caller identity is bound by the orchestrator.
 * State represents last verified observations, not an authoritative shared Minecraft inventory.
 * Every physical use still requires live adapter verification. No legacy data is imported.
 */
export class CommunityPhysicalState {
  constructor(private readonly store: CivilizationStore) {
    migratePhysicalState(store.db);
  }

  forCitizen(citizenId: string): CitizenPhysicalState {
    const communityId = this.store.getCommunityDirectory().communityOf(citizenId);
    if (!this.store.getCitizen(citizenId) || !communityId)
      throw new Error("authenticated community membership required");
    return new CitizenPhysicalState(this.store, citizenId, communityId);
  }
}

export class CitizenPhysicalState {
  constructor(
    private readonly store: CivilizationStore,
    private readonly citizenId: string,
    private readonly communityId: string,
  ) {}

  private authorized(): void {
    if (this.store.getCommunityDirectory().communityOf(this.citizenId) !== this.communityId) {
      throw new Error("community affiliation changed; cancel old work and rebind");
    }
  }

  private audit(action: string, recordId: string): void {
    this.store.db
      .prepare(
        "INSERT INTO physical_state_audit(at,citizen_id,community_id,action,record_id) VALUES (?,?,?,?,?)",
      )
      .run(new Date().toISOString(), this.citizenId, this.communityId, action, recordId);
  }

  private transaction<T>(run: () => T): T {
    return this.store.db
      .transaction(() => {
        this.authorized();
        return run();
      })
      .immediate();
  }

  read(): PhysicalSnapshot {
    return this.transaction(() => {
      const row = this.store.db
        .prepare("SELECT revision,state_json FROM community_physical_state WHERE community_id=?")
        .get(this.communityId) as { revision: number; state_json: string } | undefined;
      return row
        ? { revision: row.revision, state: JSON.parse(row.state_json) as SettlementState }
        : { revision: 0, state: emptyState(this.communityId) };
    });
  }

  /** Compare-and-swap prevents stale planner observations overwriting another body's verified update. */
  save(snapshot: PhysicalSnapshot): boolean {
    return this.transaction(() => {
      if (snapshot.state.id !== this.communityId) throw new Error("foreign settlement state");
      if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0)
        throw new Error("invalid revision");
      for (const value of [
        snapshot.state.food,
        snapshot.state.wood,
        snapshot.state.stone,
        snapshot.state.beds,
        snapshot.state.tools,
        snapshot.state.housingCapacity,
        ...Object.values(snapshot.state.storageContents ?? {}),
      ]) {
        if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid physical count");
      }
      const result = this.store.db
        .prepare(
          `INSERT INTO community_physical_state(community_id,revision,state_json,updated_by,updated_at)
        VALUES (@community,1,@state,@actor,@at) ON CONFLICT(community_id) DO UPDATE SET
        revision=revision+1,state_json=@state,updated_by=@actor,updated_at=@at WHERE revision=@revision`,
        )
        .run({
          community: this.communityId,
          state: JSON.stringify(snapshot.state),
          actor: this.citizenId,
          at: new Date().toISOString(),
          revision: snapshot.revision,
        });
      // An absent row may only be created from the initial revision.
      if (result.changes && snapshot.revision > 0) {
        const actual = this.store.db
          .prepare("SELECT revision FROM community_physical_state WHERE community_id=?")
          .get(this.communityId) as { revision: number };
        if (actual.revision !== snapshot.revision + 1) throw new Error("stale initial revision");
      }
      if (result.changes) this.audit("save_observed_state", snapshot.state.id);
      return result.changes === 1;
    });
  }

  reserve(item: string, quantity: number, ttlMs = 180_000, now = Date.now()): string | undefined {
    if (
      !item.trim() ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(now) ||
      !Number.isFinite(ttlMs) ||
      ttlMs <= 0
    ) {
      throw new Error("invalid reservation");
    }
    return this.transaction(() => {
      this.expire(now);
      const contents = this.read().state.storageContents ?? {};
      const physical = Object.hasOwn(contents, item) ? contents[item]! : 0;
      const held = (
        this.store.db
          .prepare(
            "SELECT COALESCE(SUM(quantity),0) AS n FROM physical_resource_holds WHERE community_id=? AND item=?",
          )
          .get(this.communityId, item) as { n: number }
      ).n;
      if (held + quantity > physical) return undefined;
      const id = crypto.randomUUID();
      this.store.db
        .prepare("INSERT INTO physical_resource_holds VALUES (?,?,?,?,?,?)")
        .run(id, this.communityId, this.citizenId, item, quantity, now + ttlMs);
      this.audit("reserve", id);
      return id;
    });
  }

  releaseReservation(id: string): boolean {
    return this.transaction(() => {
      const result = this.store.db
        .prepare(
          "DELETE FROM physical_resource_holds WHERE id=? AND citizen_id=? AND community_id=?",
        )
        .run(id, this.citizenId, this.communityId);
      if (result.changes) this.audit("release_reservation", id);
      return result.changes === 1;
    });
  }

  /** Internal reservation is a social scheduling rule; it never changes any world blocks. */
  claimBlock(dimension: string, position: Vec3, ttlMs = 90_000, now = Date.now()): boolean {
    const key = physicalBlockKey(dimension, position);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isFinite(now))
      throw new Error("invalid claim expiry");
    return this.transaction(() => {
      this.expire(now);
      const result = this.store.db
        .prepare(
          `INSERT INTO physical_world_claims VALUES (?,?,?,?) ON CONFLICT(resource_key)
        DO UPDATE SET expires_at=excluded.expires_at WHERE citizen_id=excluded.citizen_id AND community_id=excluded.community_id`,
        )
        .run(key, this.citizenId, this.communityId, now + ttlMs);
      if (result.changes) this.audit("claim_block", key);
      return result.changes === 1;
    });
  }

  releaseBlock(dimension: string, position: Vec3): boolean {
    return this.transaction(() => {
      const key = physicalBlockKey(dimension, position);
      const result = this.store.db
        .prepare(
          "DELETE FROM physical_world_claims WHERE resource_key=? AND citizen_id=? AND community_id=?",
        )
        .run(key, this.citizenId, this.communityId);
      if (result.changes) this.audit("release_block", key);
      return result.changes === 1;
    });
  }

  /** Register only after adapter observation. Knowledge does not imply permission to open someone's chest. */
  registerAsset(kind: PhysicalAssetKind, dimension: string, position: Vec3): boolean {
    const key = physicalBlockKey(dimension, position);
    return this.transaction(() => {
      const result = this.store.db
        .prepare("INSERT OR IGNORE INTO physical_assets VALUES (?,?,?,?,?)")
        .run(key, kind, this.communityId, this.citizenId, JSON.stringify(position));
      if (result.changes) this.audit("register_asset", key);
      return result.changes === 1;
    });
  }

  grantAsset(key: string, recipientId: string): boolean {
    return this.transaction(() => {
      const asset = this.store.db
        .prepare("SELECT owner_id FROM physical_assets WHERE resource_key=? AND community_id=?")
        .get(key, this.communityId) as { owner_id: string } | undefined;
      const recipientCommunity = this.store.getCommunityDirectory().communityOf(recipientId);
      if (asset?.owner_id !== this.citizenId || !this.store.getCitizen(recipientId) || !recipientCommunity) {
        return false;
      }
      // Explicit marker: granting to a citizen already outside this community is cross-community
      // diplomacy. Same-community grants stay community-scoped and end if the grantee leaves.
      const crossCommunity = recipientCommunity !== this.communityId ? 1 : 0;
      this.store.db
        .prepare(
          "INSERT OR IGNORE INTO physical_asset_grants(resource_key,citizen_id,cross_community) VALUES (?,?,?)",
        )
        .run(key, recipientId, crossCommunity);
      this.audit("grant_asset", JSON.stringify([key, recipientId, crossCommunity ? "cross" : "community"]));
      return true;
    });
  }

  accessibleAssets(): PhysicalAsset[] {
    return this.transaction(() => {
      // Owner access requires current membership in the asset's community. Same-community grants
      // require the same. Explicit cross-community grants remain valid until revoked.
      const rows = this.store.db
        .prepare(
          `SELECT a.* FROM physical_assets a WHERE
        (a.owner_id=? AND a.community_id=?)
        OR EXISTS(
          SELECT 1 FROM physical_asset_grants g WHERE g.resource_key=a.resource_key AND g.citizen_id=? AND (
            g.cross_community=1 OR a.community_id=?
          )
        )`,
        )
        .all(this.citizenId, this.communityId, this.citizenId, this.communityId) as Array<{
        resource_key: string;
        kind: PhysicalAssetKind;
        owner_id: string;
        position_json: string;
      }>;
      return rows.map((r) => ({
        key: r.resource_key,
        kind: r.kind,
        ownerId: r.owner_id,
        position: JSON.parse(r.position_json) as Vec3,
      }));
    });
  }

  private mayUse(key: string): boolean {
    return Boolean(
      this.store.db
        .prepare(
          `SELECT 1 FROM physical_assets a WHERE a.resource_key=? AND a.kind='chest' AND (
        (a.owner_id=? AND a.community_id=?)
        OR EXISTS(
          SELECT 1 FROM physical_asset_grants g WHERE g.resource_key=a.resource_key AND g.citizen_id=? AND (
            g.cross_community=1 OR a.community_id=?
          )
        )
      )`,
        )
        .get(key, this.citizenId, this.communityId, this.citizenId, this.communityId),
    );
  }

  /**
   * Records counts the adapter actually observed in a container this citizen may use. Observed items are merged over
   * earlier observations (an adapter transfer reports only the items it touched), so values are last-observed, not
   * authoritative stock: every physical use must still be verified live. Contents are visible only to the owner and
   * explicit grantees, never to the community-wide snapshot.
   *
   * Optional `expectedRevision` is compare-and-swap: when provided and stale, returns false and changes nothing.
   * Omitting it preserves prior overwrite behaviour.
   */
  recordContainerObservation(
    key: string,
    observed: Record<string, number>,
    options?: { expectedRevision?: number },
  ): boolean {
    for (const [item, count] of Object.entries(observed)) {
      if (!item || !Number.isSafeInteger(count) || count < 0) throw new Error("invalid observed container count");
    }
    return this.transaction(() => {
      if (!this.mayUse(key)) return false;
      const row = this.store.db
        .prepare("SELECT contents_json, revision FROM physical_asset_contents WHERE resource_key=?")
        .get(key) as { contents_json: string; revision: number } | undefined;
      const current = this.storedObservationToken(key, row?.revision);
      if (options?.expectedRevision !== undefined && options.expectedRevision !== current) return false;
      const merged = { ...(row ? (JSON.parse(row.contents_json) as Record<string, number>) : {}), ...observed };
      for (const item of Object.keys(merged)) if (merged[item] === 0) delete merged[item];
      const next = current + 1;
      this.store.db
        .prepare(
          `INSERT INTO physical_asset_contents(resource_key,contents_json,observed_by,observed_at,revision) VALUES (?,?,?,?,?)
        ON CONFLICT(resource_key) DO UPDATE SET contents_json=excluded.contents_json,observed_by=excluded.observed_by,observed_at=excluded.observed_at,revision=excluded.revision`,
        )
        .run(key, JSON.stringify(merged), this.citizenId, new Date().toISOString(), next);
      this.store.db
        .prepare(
          `INSERT INTO physical_asset_observation_epoch(resource_key, revision) VALUES (?,?)
        ON CONFLICT(resource_key) DO UPDATE SET revision=excluded.revision`,
        )
        .run(key, next);
      this.audit("observe_container", key);
      return true;
    });
  }

  /**
   * Compare-and-swap token for the next observation. Survives abandon so a token issued for a
   * previous chest at these coordinates never matches the recreated one. Undefined when this
   * citizen may not use the container; the revision number is not returned to them.
   */
  containerObservationToken(key: string): number | undefined {
    return this.transaction(() => {
      if (!this.mayUse(key)) return undefined;
      return this.storedObservationToken(key);
    });
  }

  private storedObservationToken(key: string, contentsRevision?: number): number {
    const epoch = this.store.db
      .prepare("SELECT revision FROM physical_asset_observation_epoch WHERE resource_key=?")
      .get(key) as { revision: number } | undefined;
    if (epoch && Number.isSafeInteger(epoch.revision) && epoch.revision >= 0) return epoch.revision;
    if (contentsRevision !== undefined && Number.isSafeInteger(contentsRevision) && contentsRevision >= 0) return contentsRevision;
    const row = this.store.db
      .prepare("SELECT revision FROM physical_asset_contents WHERE resource_key=?")
      .get(key) as { revision: number } | undefined;
    return row?.revision ?? 0;
  }

  /**
   * Additive observation details (qa/v1/CHEST_OBSERVATION_CONTRACT.md). Stored rows are always basis "observed";
   * verified-live is a per-use adapter check, never a persisted state. Same authorization as contents.
   */
  observedContainerDetails(key: string):
    | {
        contents: Record<string, number>;
        observedBy: string;
        observedAt: string;
        revision: number;
        basis: "observed";
      }
    | undefined {
    return this.transaction(() => {
      if (!this.mayUse(key)) return undefined;
      const row = this.store.db
        .prepare("SELECT contents_json, observed_by, observed_at, revision FROM physical_asset_contents WHERE resource_key=?")
        .get(key) as
        | { contents_json: string; observed_by: string; observed_at: string; revision: number }
        | undefined;
      if (!row) return undefined;
      return {
        contents: JSON.parse(row.contents_json) as Record<string, number>,
        observedBy: row.observed_by,
        observedAt: row.observed_at,
        revision: row.revision,
        basis: "observed" as const,
      };
    });
  }

  observedContainerContents(key: string): Record<string, number> | undefined {
    return this.observedContainerDetails(key)?.contents;
  }

  /** @deprecated Prefer observedContainerDetails; kept as a thin alias for earlier Mission 004 callers. */
  observedContainerProvenance(key: string) {
    const details = this.observedContainerDetails(key);
    if (!details) return undefined;
    return { contents: details.contents, observedBy: details.observedBy, observedAt: details.observedAt };
  }

  /** Owner may abandon a bed/home/workstation; prior ownership remains in the audit. */
  abandonAsset(key: string): boolean {
    return this.transaction(() => {
      const asset = this.store.db
        .prepare("SELECT kind FROM physical_assets WHERE resource_key=? AND owner_id=?")
        .get(key, this.citizenId) as { kind: PhysicalAssetKind } | undefined;
      if (!asset) return false;
      const current = this.storedObservationToken(key);
      this.store.db.prepare("DELETE FROM physical_asset_grants WHERE resource_key=?").run(key);
      this.store.db.prepare("DELETE FROM physical_asset_contents WHERE resource_key=?").run(key);
      this.store.db
        .prepare("DELETE FROM physical_assets WHERE resource_key=? AND owner_id=?")
        .run(key, this.citizenId);
      this.store.db
        .prepare(
          `INSERT INTO physical_asset_observation_epoch(resource_key, revision) VALUES (?,?)
        ON CONFLICT(resource_key) DO UPDATE SET revision=excluded.revision`,
        )
        .run(key, current + 1);
      this.audit(`abandon_asset:${asset.kind}`, key);
      return true;
    });
  }

  revokeAsset(key: string, recipientId: string): boolean {
    return this.transaction(() => {
      const result = this.store.db
        .prepare(
          `DELETE FROM physical_asset_grants WHERE resource_key=? AND citizen_id=?
        AND EXISTS(SELECT 1 FROM physical_assets a WHERE a.resource_key=? AND a.owner_id=?)`,
        )
        .run(key, recipientId, key, this.citizenId);
      if (result.changes) this.audit("revoke_asset", JSON.stringify([key, recipientId]));
      return result.changes === 1;
    });
  }

  /** Death/disconnect/cancellation cleanup requires the same bound citizen, never an arbitrary owner id. */
  releaseWork(): void {
    this.transaction(() => {
      this.store.db
        .prepare("DELETE FROM physical_resource_holds WHERE citizen_id=?")
        .run(this.citizenId);
      this.store.db
        .prepare("DELETE FROM physical_world_claims WHERE citizen_id=?")
        .run(this.citizenId);
      this.audit("release_work", this.citizenId);
    });
  }

  private expire(now: number): void {
    this.store.db
      .prepare(
        `DELETE FROM physical_resource_holds WHERE expires_at<=? OR NOT EXISTS
      (SELECT 1 FROM community_members m WHERE m.citizen_id=physical_resource_holds.citizen_id AND m.community_id=physical_resource_holds.community_id)`,
      )
      .run(now);
    this.store.db
      .prepare(
        `DELETE FROM physical_world_claims WHERE expires_at<=? OR NOT EXISTS
      (SELECT 1 FROM community_members m WHERE m.citizen_id=physical_world_claims.citizen_id AND m.community_id=physical_world_claims.community_id)`,
      )
      .run(now);
  }
}

const physicalStores = new WeakMap<CivilizationStore, CommunityPhysicalState>();
export function communityPhysicalState(store: CivilizationStore): CommunityPhysicalState {
  let physical = physicalStores.get(store);
  if (!physical) {
    physical = new CommunityPhysicalState(store);
    physicalStores.set(store, physical);
  }
  return physical;
}
