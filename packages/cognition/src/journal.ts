import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { workspaceRoot } from "@civ/shared";
import type { CognitiveStore } from "@civ/memory";
import type { ExperienceLedger } from "./experience-ledger.js";

export function renderLearningJournal(store: CognitiveStore, ledger?: ExperienceLedger): string {
  const identities = store.listIdentities();
  const lines = ["# LEARNING JOURNAL", "", "Observable citizen experience and system incidents only. No hidden chain-of-thought.", ""];
  for (const identity of identities) {
    const name = identity.name ?? identity.citizenId;
    lines.push(`## ${name}`);
    const episodes = store.listFailureEpisodes(identity.citizenId, 12);
    const lessons = store.listLessons(identity.citizenId, false);
    if (episodes.length === 0 && lessons.length === 0) {
      lines.push("No citizen-learning episodes.");
      lines.push("");
      continue;
    }
    for (const episode of episodes) {
      const lesson = lessons.find((item) => item.supportingFailureIds.includes(episode.id));
      lines.push(`${episode.timestamp} — Failed ${episode.goal ?? episode.action ?? "task"}`);
      lines.push(`Cause: ${episode.errorCode ?? episode.contextSummary}`);
      lines.push(`Classification: ${episode.errorCategory}`);
      lines.push(`Lesson: ${lesson?.lesson ?? "NONE (episode only)"}`);
      lines.push(`Confidence: ${lesson ? lesson.confidence.toFixed(2) : "n/a"}`);
      lines.push(`Lesson status: ${lesson ? (lesson.active ? "active" : "inactive") : "none"}`);
      lines.push("");
    }
  }

  lines.push("## SYSTEM INCIDENT");
  const incidents = store.listSystemIncidents(20);
  if (incidents.length === 0) lines.push("None.");
  for (const incident of incidents) {
    lines.push(`${incident.timestamp} — ${incident.summary}`);
    lines.push(`Classification: ${incident.errorCategory}`);
    lines.push("Citizen learning: NONE");
    lines.push("");
  }

  if (ledger) {
    const metrics = ledger.metrics();
    lines.push("## METRICS");
    lines.push(JSON.stringify(metrics, null, 2));
  }
  return lines.join("\n");
}

export function writeLearningJournal(store: CognitiveStore, ledger?: ExperienceLedger, dir = resolve(workspaceRoot(), "artifacts")): void {
  mkdirSync(dir, { recursive: true });
  const markdown = renderLearningJournal(store, ledger);
  const payload = {
    generatedAt: new Date().toISOString(),
    metrics: ledger?.metrics() ?? store.learningCounts(),
    incidents: store.listSystemIncidents(50),
    citizens: store.listIdentities().map((identity) => ({
      id: identity.citizenId,
      name: identity.name,
      episodes: store.listFailureEpisodes(identity.citizenId, 40),
      lessons: store.listLessons(identity.citizenId, false),
    })),
  };
  writeFileSync(resolve(dir, "learning-journal.json"), JSON.stringify(payload, null, 2));
  writeFileSync(resolve(dir, "learning-journal.md"), markdown);
}
