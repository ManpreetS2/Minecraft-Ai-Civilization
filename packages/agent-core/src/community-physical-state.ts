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
        contents_json TEXT NOT NULL, observed_by TEXT NOT NULL, observed_at TEXT NOT NULL
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
      if (asset?.owner_id !== this.citizenId || !this.store.getCitizen(recipientId)) return false;
      this.store.db
        .prepare("INSERT OR IGNORE INTO physical_asset_grants VALUES (?,?)")
        .run(key, recipientId);
      this.audit("grant_asset", JSON.stringify([key, recipientId]));
      return true;
    });
  }

  accessibleAssets(): PhysicalAsset[] {
    return this.transaction(() => {
      const rows = this.store.db
        .prepare(
          `SELECT a.* FROM physical_assets a WHERE
        a.owner_id=? OR EXISTS(SELECT 1 FROM physical_asset_grants g WHERE g.resource_key=a.resource_key AND g.citizen_id=?)`,
        )
        .all(this.citizenId, this.citizenId) as Array<{
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
          `SELECT 1 FROM physical_assets a WHERE a.resource_key=? AND a.kind='chest' AND (a.owner_id=? OR EXISTS(
        SELECT 1 FROM physical_asset_grants g WHERE g.resource_key=a.resource_key AND g.citizen_id=?))`,
        )
        .get(key, this.citizenId, this.citizenId),
    );
  }

  /**
   * Records counts the adapter actually observed in a container this citizen may use. Observed items are merged over
   * earlier observations (an adapter transfer reports only the items it touched), so values are last-observed, not
   * authoritative stock: every physical use must still be verified live. Contents are visible only to the owner and
   * explicit grantees, never to the community-wide snapshot.
   */
  recordContainerObservation(key: string, observed: Record<string, number>): boolean {
    for (const [item, count] of Object.entries(observed)) {
      if (!item || !Number.isSafeInteger(count) || count < 0) throw new Error("invalid observed container count");
    }
    return this.transaction(() => {
      if (!this.mayUse(key)) return false;
      const row = this.store.db
        .prepare("SELECT contents_json FROM physical_asset_contents WHERE resource_key=?")
        .get(key) as { contents_json: string } | undefined;
      const merged = { ...(row ? (JSON.parse(row.contents_json) as Record<string, number>) : {}), ...observed };
      for (const item of Object.keys(merged)) if (merged[item] === 0) delete merged[item];
      this.store.db
        .prepare(
          `INSERT INTO physical_asset_contents(resource_key,contents_json,observed_by,observed_at) VALUES (?,?,?,?)
        ON CONFLICT(resource_key) DO UPDATE SET contents_json=excluded.contents_json,observed_by=excluded.observed_by,observed_at=excluded.observed_at`,
        )
        .run(key, JSON.stringify(merged), this.citizenId, new Date().toISOString());
      this.audit("observe_container", key);
      return true;
    });
  }

  observedContainerContents(key: string): Record<string, number> | undefined {
    return this.transaction(() => {
      if (!this.mayUse(key)) return undefined;
      const row = this.store.db
        .prepare("SELECT contents_json FROM physical_asset_contents WHERE resource_key=?")
        .get(key) as { contents_json: string } | undefined;
      return row ? (JSON.parse(row.contents_json) as Record<string, number>) : undefined;
    });
  }

  /** Owner may abandon a bed/home/workstation; prior ownership remains in the audit. */
  abandonAsset(key: string): boolean {
    return this.transaction(() => {
      const asset = this.store.db
        .prepare("SELECT kind FROM physical_assets WHERE resource_key=? AND owner_id=?")
        .get(key, this.citizenId) as { kind: PhysicalAssetKind } | undefined;
      if (!asset) return false;
      this.store.db.prepare("DELETE FROM physical_asset_grants WHERE resource_key=?").run(key);
      this.store.db.prepare("DELETE FROM physical_asset_contents WHERE resource_key=?").run(key);
      this.store.db
        .prepare("DELETE FROM physical_assets WHERE resource_key=? AND owner_id=?")
        .run(key, this.citizenId);
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
