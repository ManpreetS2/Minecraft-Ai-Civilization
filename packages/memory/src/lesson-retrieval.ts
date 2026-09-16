import type { LearningLesson, LessonRetrievalQuery } from "./experience.js";

export type ScoredLesson = {
  lesson: LearningLesson;
  score: number;
  reasons: string[];
};

/**
 * Compact relevant lessons only. Never dumps the full mistake ledger.
 */
export function retrieveLessons(lessons: LearningLesson[], query: LessonRetrievalQuery): ScoredLesson[] {
  const goal = query.goal?.toLowerCase() ?? "";
  const error = query.errorCode?.toLowerCase() ?? "";
  const resource = query.resource?.toLowerCase() ?? "";
  const scored = lessons
    .filter((lesson) => lesson.active && lesson.confidence >= 0.2)
    .map((lesson) => {
      const text = `${lesson.triggerPattern} ${lesson.lesson}`.toLowerCase();
      const reasons: string[] = [];
      let score = lesson.confidence * 0.4;
      if (goal && text.includes(goal.replaceAll("_", " "))) {
        score += 0.3;
        reasons.push("goal");
      }
      if (goal && text.includes(goal)) {
        score += 0.15;
        reasons.push("goal_key");
      }
      if (error && text.includes(error.toLowerCase())) {
        score += 0.25;
        reasons.push("error");
      }
      if (resource && text.includes(resource)) {
        score += 0.15;
        reasons.push("resource");
      }
      if (lesson.successfulApplications > 0) {
        score += Math.min(0.15, lesson.successfulApplications * 0.05);
        reasons.push("verified");
      }
      if (lesson.timesApplied > 0 && lesson.successfulApplications === 0) {
        score -= 0.1;
      }
      const ageBoost = lesson.lastUpdatedAt ? 0.05 : 0;
      score += ageBoost;
      return { lesson, score, reasons: [...new Set(reasons)] };
    })
    .filter((item) => item.score >= 0.35)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, query.limit ?? 4);
}
