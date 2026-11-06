import { cellClaimKey, ClaimBoard, ReservationBook } from "./claims.js";
import { loadCommunityProject, migrateCommunityConstruction } from "./community-construction.js";
import { createShelterProject, type SettlementProject } from "./projects.js";
import type { CivilizationStore } from "./store.js";

export class SettlementRuntime {
  readonly claims: ClaimBoard;
  readonly reservations = new ReservationBook();
  project?: SettlementProject;
  lastTransferAt = 0;
  /** Set only on per-community views created by forCommunity(). */
  readonly communityId?: string;
  private readonly communities = new Map<string, SettlementRuntime>();

  constructor(claims = new ClaimBoard(), communityId?: string) {
    this.claims = claims;
    this.communityId = communityId;
  }

  /**
   * Per-community runtime view. Physical site claims stay shared (one world, one set of blocks); the project and
   * resource reservations are private to the community. The first access hydrates the project from SQLite.
   */
  forCommunity(communityId: string, store?: CivilizationStore): SettlementRuntime {
    let view = this.communities.get(communityId);
    if (!view) {
      view = new SettlementRuntime(this.claims, communityId);
      this.communities.set(communityId, view);
    }
    if (store?.isOpen() && !view.project) view.project = loadCommunityProject(store, communityId);
    if (store?.isOpen()) {
      migrateCommunityConstruction(store);
      // Rebuild all communities' physical site holds before admitting new work.
      // Project rows remain the durable authority; leases are refreshed on access.
      for (const row of store.db.prepare("SELECT project_json FROM community_construction_projects").all() as Array<{ project_json: string }>) {
        const project = JSON.parse(row.project_json) as SettlementProject & { ownerCitizenId?: string; cancelled?: boolean };
        if (project.ownerCitizenId && project.site && !project.cancelled && project.status !== "FAILED") {
          this.claims.tryClaim("construction_site", cellClaimKey(project.site.x, project.site.y, project.site.z), project.ownerCitizenId, 30 * 60_000);
        }
      }
    }
    return view;
  }

  ensureShelterProject(): SettlementProject {
    if (!this.project || this.project.status === "FAILED") {
      this.project = createShelterProject();
    }
    return this.project;
  }

  releaseCitizen(citizenId: string): void {
    this.claims.releaseOwner(citizenId);
    this.reservations.releaseOwner(citizenId);
    for (const view of this.communities.values()) view.reservations.releaseOwner(citizenId);
  }
}
