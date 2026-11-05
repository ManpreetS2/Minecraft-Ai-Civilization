import type { ValidationReport } from "./types.js";

export function formatJsonReport(report: ValidationReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatHumanReport(report: ValidationReport): string {
  const lines: string[] = [];

  const statusBadge =
    report.overallStatus === "VERIFIED"
      ? "🟢 VERIFIED"
      : report.overallStatus === "VIOLATIONS_DETECTED"
        ? "🔴 VIOLATIONS DETECTED"
        : "🟡 NOT PROVEN";

  const modeBadge =
    report.mode === "real_minecraft"
      ? "🌐 Real Minecraft Paper Server"
      : "🔬 Offline Simulated Fixture (Not a live Minecraft demo claim)";

  lines.push(`# Experiment Evidence Validation Report: ${report.experimentId}`);
  lines.push("");
  lines.push(`**Overall Status:** ${statusBadge} | **Environment:** ${modeBadge}`);
  lines.push(`**Generated At:** ${report.generatedAt}`);
  lines.push(`**Source SHA:** \`${report.sourceSha}\``);
  lines.push(`**Citizens:** ${report.attribution.citizens.join(", ") || "none"}`);
  lines.push(`**Communities:** ${report.attribution.communities.join(", ") || "none"}`);
  lines.push("");

  if (report.mode === "offline_simulated") {
    lines.push("> [!NOTE]");
    lines.push(
      "> This report evaluates an **offline simulated test fixture**. Passing checks demonstrate verification capability and negative regression defense; they do **not** claim a successful live Minecraft demonstration on a Paper server.",
    );
    lines.push("");
  }

  // Summary Metrics Table
  lines.push("## Summary Metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| :--- | :--- |");
  lines.push(`| **Total Attempted Actions** | ${report.summary.totalAttemptedActions} |`);
  lines.push(`| **Physically Verified Actions** | ${report.summary.verifiedActions} |`);
  lines.push(`| **Unverified Action Claims** | ${report.summary.unverifiedActions} |`);
  lines.push(`| **Failed Actions** | ${report.summary.failedActions} |`);
  lines.push(`| **Interrupted Actions** | ${report.summary.interruptedActions} |`);
  lines.push(`| **Observed Facts** | ${report.summary.observedFacts} |`);
  lines.push(`| **Communicated Claims** | ${report.summary.communicatedClaims} |`);
  lines.push(`| **Privacy Violations** | ${report.summary.privacyViolationsCount} |`);
  lines.push(`| **Inventory Discrepancies** | ${report.summary.inventoryViolationsCount} |`);
  lines.push(`| **Hash Chain Integrity** | ${report.hashChainAudit.valid ? "VALID" : "INVALID / TAMPERED"} |`);
  lines.push(`| **Duration & Tick Proof** | ${report.summary.durationVerified ? "VERIFIED" : "DEFICIT / UNPROVEN"} |`);
  lines.push("");

  // Violations
  if (report.violations.length > 0) {
    lines.push("## ⚠️ Detected Violations");
    lines.push("");
    lines.push("| Code | Citizen | Description | Severity |");
    lines.push("| :--- | :--- | :--- | :--- |");
    for (const v of report.violations) {
      lines.push(
        `| \`${v.code}\` | ${v.citizenId ?? "global"} | ${v.description.replace(/\|/g, "\\|")} | **${v.severity}** |`,
      );
    }
    lines.push("");
  }

  // Missing Evidence / Not Proven
  if (report.notProven.length > 0) {
    lines.push("## ❓ Unproven Checks (Missing Evidence)");
    lines.push("");
    lines.push("| Code | Description | Missing Fields |");
    lines.push("| :--- | :--- | :--- |");
    for (const item of report.notProven) {
      lines.push(
        `| \`${item.code}\` | ${item.description.replace(/\|/g, "\\|")} | \`${item.missingFields.join(", ")}\` |`,
      );
    }
    lines.push("");
  }

  // Duration & Tick Audit
  lines.push("## Duration & Performance Audit");
  lines.push("");
  lines.push(`- **Claimed Duration:** ${report.durationAudit.claimedDurationMinutes} minutes`);
  lines.push(
    `- **Proven Duration:** ${report.durationAudit.provenDurationMinutes} minutes (${report.durationAudit.provenDurationMs} ms)`,
  );
  lines.push(`- **Recorded Ticks:** ${report.durationAudit.tickCount}`);
  lines.push(`- **Average Tick Duration:** ${report.durationAudit.averageTickDurationMs} ms`);
  lines.push(
    `- **Average Measured TPS:** ${report.durationAudit.averageTps !== undefined ? report.durationAudit.averageTps : "none recorded"}`,
  );
  if (report.durationAudit.reasons.length > 0) {
    lines.push(`- **Duration Deficit Details:** ${report.durationAudit.reasons.join("; ")}`);
  }
  lines.push("");

  // Physical Action Verifications
  if (report.actionVerifications.length > 0) {
    lines.push("## Physical Action Verifications");
    lines.push("");
    lines.push("| Citizen | Action | Classification | Outcome | Physical Witness Deltas |");
    lines.push("| :--- | :--- | :--- | :--- | :--- |");
    for (const a of report.actionVerifications) {
      const deltas: string[] = [];
      const inv = a.physicalDeltas.inventoryDelta;
      if (Object.keys(inv).length > 0) {
        deltas.push(
          Object.entries(inv)
            .map(([k, v]) => `${k}:${v > 0 ? "+" + v : v}`)
            .join(", "),
        );
      }
      if (a.physicalDeltas.hungerDelta !== undefined) {
        deltas.push(`hunger:${a.physicalDeltas.hungerDelta > 0 ? "+" : ""}${a.physicalDeltas.hungerDelta}`);
      }
      if (a.physicalDeltas.worldChangesCount > 0) {
        deltas.push(`blocks:${a.physicalDeltas.worldChangesCount}`);
      }
      if (a.physicalDeltas.distanceToTarget !== undefined) {
        deltas.push(`dist:${a.physicalDeltas.distanceToTarget.toFixed(1)}b`);
      }
      const deltaStr = deltas.join("; ") || "none";
      const statusIcon =
        a.status === "VERIFIED"
          ? "✅ VERIFIED"
          : a.status === "FAILED"
            ? "❌ FAILED"
            : a.status === "INTERRUPTED"
              ? "⏸️ INTERRUPTED"
              : "⚠️ UNVERIFIED";

      lines.push(
        `| ${a.citizenId} | \`${a.action}\` | \`${a.classification}\` | ${statusIcon} | ${deltaStr} |`,
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("*Report generated by Google Antigravity Evidence Validator (redacted, offline verification).*");
  return lines.join("\n");
}
