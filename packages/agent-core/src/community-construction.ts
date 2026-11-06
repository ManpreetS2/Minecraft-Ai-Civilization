import type { CivilizationStore } from "./store.js";
import type { SettlementProject } from "./projects.js";

const MIGRATION = "community-construction-v1";

/** Additive migration; no legacy settlement project is assigned to any community. */
export function migrateCommunityConstruction(store: CivilizationStore): void {
  const db = store.db;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS community_construction_projects (
        community_id TEXT PRIMARY KEY REFERENCES communities(id),
        project_json TEXT NOT NULL, status TEXT NOT NULL,
        site_json TEXT, blueprint_id TEXT, stage TEXT,
        placed_blocks INTEGER, total_blocks INTEGER, complete INTEGER NOT NULL DEFAULT 0,
        updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    db.prepare(
      "SELECT community_id,project_json,status,site_json,blueprint_id,stage,placed_blocks,total_blocks,complete,updated_by,updated_at FROM community_construction_projects LIMIT 0",
    ).all();
    db.prepare("INSERT OR IGNORE INTO sim_meta(key,value) VALUES (?,?)").run(MIGRATION, "1");
  }).immediate();
}

/**
 * Trusted runtime API (never a model/tool endpoint). A handle is bound to one authenticated citizen and the community
 * the directory reports for them; there is no way to name another community's row. Every call re-verifies membership.
 */
export class CommunityConstruction {
  constructor(private readonly store: CivilizationStore) {
    migrateCommunityConstruction(store);
  }

  forCitizen(citizenId: string | undefined): CitizenConstruction {
    const communityId = citizenId ? this.store.getCommunityDirectory().communityOf(citizenId) : undefined;
    if (!citizenId || !communityId) throw new Error("authenticated community membership required");
    return new CitizenConstruction(this.store, citizenId, communityId);
  }
}

/** Trusted orchestrator hydration by community id (restart recovery); callers hold no model-controlled ids. */
export function loadCommunityProject(store: CivilizationStore, communityId: string): SettlementProject | undefined {
  migrateCommunityConstruction(store);
  if (!store.db.prepare("SELECT 1 FROM communities WHERE id=?").get(communityId)) return undefined;
  const row = store.db
    .prepare("SELECT project_json FROM community_construction_projects WHERE community_id=?")
    .get(communityId) as { project_json: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.project_json) as SettlementProject;
  } catch {
    return undefined;
  }
}

export class CitizenConstruction {
  constructor(
    private readonly store: CivilizationStore,
    readonly citizenId: string,
    readonly communityId: string,
  ) {}

  private authorized(): void {
    if (this.store.getCommunityDirectory().communityOf(this.citizenId) !== this.communityId) {
      throw new Error("community affiliation changed; cancel old work and rebind");
    }
  }

  load(): SettlementProject | undefined {
    return this.store.db
      .transaction(() => {
        this.authorized();
        const row = this.store.db
          .prepare("SELECT project_json FROM community_construction_projects WHERE community_id=?")
          .get(this.communityId) as { project_json: string } | undefined;
        if (!row) return undefined;
        try {
          return JSON.parse(row.project_json) as SettlementProject;
        } catch {
          return undefined;
        }
      })
      .immediate();
  }

  /** True only when the row is durably written. Authorization failures throw; storage failures return false. */
  save(project: SettlementProject): boolean {
    this.authorized();
    if (!this.store.isOpen()) return false;
    try {
      return this.store.db
        .transaction(() => {
          this.authorized();
          const nextOwner = (project as SettlementProject & { ownerCitizenId?: string }).ownerCitizenId;
          const prior = this.store.db.prepare("SELECT project_json FROM community_construction_projects WHERE community_id=?").get(this.communityId) as { project_json: string } | undefined;
          if (prior) {
            const owner = (JSON.parse(prior.project_json) as SettlementProject & { ownerCitizenId?: string }).ownerCitizenId;
            if (owner && (owner !== this.citizenId || nextOwner !== owner)) return false;
          }
          if (nextOwner && nextOwner !== this.citizenId) return false;
          const session = project.session;
          this.store.db
            .prepare(
              `INSERT INTO community_construction_projects
               (community_id,project_json,status,site_json,blueprint_id,stage,placed_blocks,total_blocks,complete,updated_by,updated_at)
               VALUES (@community,@json,@status,@site,@blueprint,@stage,@placed,@total,@complete,@actor,@at)
               ON CONFLICT(community_id) DO UPDATE SET project_json=@json,status=@status,site_json=@site,
               blueprint_id=@blueprint,stage=@stage,placed_blocks=@placed,total_blocks=@total,complete=@complete,
               updated_by=@actor,updated_at=@at`,
            )
            .run({
              community: this.communityId,
              json: JSON.stringify(project),
              status: project.status,
              site: project.site ? JSON.stringify(project.site) : null,
              blueprint: session?.blueprintId ?? null,
              stage: session?.stage ?? null,
              placed: session?.placed ?? null,
              total: session?.total ?? null,
              complete: project.status === "COMPLETED" ? 1 : 0,
              actor: this.citizenId,
              at: new Date().toISOString(),
            });
          return true;
        })
        .immediate();
    } catch (error) {
      if (error instanceof Error && /affiliation/.test(error.message)) throw error;
      console.error(`[community-construction] write failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}

export function communityConstruction(store: CivilizationStore): CommunityConstruction {
  return new CommunityConstruction(store);
}
