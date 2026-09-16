import { ClaimBoard, ReservationBook } from "./claims.js";
import { createShelterProject, type SettlementProject } from "./projects.js";

export class SettlementRuntime {
  readonly claims = new ClaimBoard();
  readonly reservations = new ReservationBook();
  project?: SettlementProject;
  lastTransferAt = 0;

  ensureShelterProject(): SettlementProject {
    if (!this.project || this.project.status === "FAILED") {
      this.project = createShelterProject();
    }
    return this.project;
  }

  releaseCitizen(citizenId: string): void {
    this.claims.releaseOwner(citizenId);
    this.reservations.releaseOwner(citizenId);
  }
}
