import Database from "better-sqlite3";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type SimEvent } from "@civ/shared";
import { CivilizationStore } from "../store.js";

export const secret = "hidden camp x=137 z=-211";
export const at = "2026-10-31T00:00:00.000Z";
export const ids = ["GPT-A", "GPT-B", "Claude-A", "Claude-B"] as const;
export const config = loadConfig({
  DEMO_PROFILE: "none",
  SIM_CITIZEN_COUNT: "4",
  LLM_PROVIDER: "none",
  LLM_ENABLED: "true",
  CLOUD_LLM_ENABLED: "false",
  LLM_COOLDOWN_MS: "1",
  DEMO_BULLETIN_TARGET_TOKENS: "400",
});
export function source(
  id: string,
  visibility: Record<string, unknown>,
  message = secret,
  actor = "GPT-A",
): SimEvent {
  return {
    id,
    citizenId: actor,
    type: "ConversationOccurred",
    timestamp: at,
    payload: { message, visibility },
  };
}
export function auditSnapshot(db: Database.Database) {
  return {
    events: db.prepare("SELECT * FROM events ORDER BY id").all(),
    delivered: db
      .prepare("SELECT * FROM citizen_event_delivery ORDER BY citizen_id,event_id")
      .all(),
    memories: db.prepare("SELECT * FROM memories ORDER BY id").all(),
    facts: db
      .prepare(
        "SELECT id,citizen_id,fact_key,content,kind,created_at FROM citizen_persistent_facts ORDER BY id",
      )
      .all(),
  };
}
export function legacyFixture(includeUnverified = true) {
  const dir = mkdtempSync(join(tmpdir(), "codex-sec001-qa-"));
  const original = join(dir, "legacy.sqlite");
  const path = join(dir, "migration-copy.sqlite");
  const db = new Database(original);
  db.exec(readFileSync(new URL("./legacy-schema.sql", import.meta.url), "utf8"));
  for (const id of ids)
    db.prepare(
      "INSERT INTO citizens(id,name,minecraft_username,created_at,status) VALUES(?,?,?,?,?)",
    ).run(id, id, id, at, "online");
  const events = [
    source(
      "private-owner",
      { class: "actor_private" },
      "Claude-A own verified observation",
      "Claude-A",
    ),
    source(
      "directed",
      { class: "directed", audienceIds: ["GPT-A", "Claude-A"] },
      "GPT-A said it owns diamonds",
    ),
    source("leaked-camp", { class: "settlement_public" }),
    source("old-public", { class: "world_public" }, "legacy intentionally published weather"),
    source("observer", { class: "observer_only" }, "private admin operation"),
  ];
  for (const e of events)
    db.prepare("INSERT INTO events(id,type,timestamp,citizen_id,payload) VALUES(?,?,?,?,?)").run(
      e.id,
      e.type,
      e.timestamp,
      e.citizenId,
      JSON.stringify(e.payload),
    );
  const facts = [
    [
      "f-owner",
      "Claude-A",
      "event:private-owner",
      "Claude-A own verified observation",
      "observed_fact",
    ],
    [
      "f-directed",
      "Claude-A",
      "event:directed",
      "ConversationOccurred by GPT-A: GPT-A said it owns diamonds",
      "observed_fact",
    ],
    ["f-poison", "Claude-A", "event:leaked-camp", secret, "observed_fact"],
    [
      "f-public",
      "GPT-B",
      "event:old-public",
      "legacy intentionally published weather",
      "observed_fact",
    ],
    ["f-observer", "Claude-B", "event:observer", "private admin operation", "observed_fact"],
    ["f-orphan", "GPT-B", "event:missing", "missing original evidence", "observed_fact"],
    [
      "f-note",
      "Claude-A",
      "note:unverified",
      `${secret} copied without source identity`,
      "observed_fact",
    ],
    ["f-suspicion", "Claude-B", "note:rumor", "unverified rumor", "suspicion"],
  ];
  for (const f of facts.filter((row) => includeUnverified || row[0] !== "f-note"))
    db.prepare(
      "INSERT INTO citizen_persistent_facts(id,citizen_id,fact_key,content,kind,created_at) VALUES(?,?,?,?,?,?)",
    ).run(...f, at);
  for (const [reader, e] of [
    ["Claude-A", "leaked-camp"],
    ["Claude-A", "private-owner"],
    ["Claude-A", "directed"],
    ["GPT-B", "old-public"],
    ["Claude-B", "observer"],
  ])
    db.prepare(
      "INSERT INTO citizen_event_delivery(citizen_id,event_id,delivered_at) VALUES(?,?,?)",
    ).run(reader, e, at);
  for (const [id, reader, content] of [
    ["m-exact", "Claude-A", `I recall ${secret} from the leaked report`],
    ["m-paraphrase", "Claude-A", "Their secret base is at east 137 and north 211"],
    ["m-own", "Claude-A", "I personally observed a river"],
    ["m-other", "Claude-B", "Claude-B private plan"],
  ].filter((row) => includeUnverified || row[0] !== "m-paraphrase"))
    db.prepare(
      "INSERT INTO memories(id,citizen_id,kind,content,importance,created_at) VALUES(?,?,?,?,?,?)",
    ).run(id, reader, "episodic", content, 0.7, at);
  const before = auditSnapshot(db);
  db.close();
  copyFileSync(original, path);
  const stores: CivilizationStore[] = [];
  const open = () => {
    const s = new CivilizationStore(path);
    stores.push(s);
    return s;
  };
  return {
    dir,
    original,
    path,
    before,
    open,
    backups: () =>
      readdirSync(dir)
        .filter((n) => n.includes(".pre-sec001-") && n.endsWith(".bak"))
        .map((n) => join(dir, n)),
    cleanup() {
      for (const s of stores) if (s.isOpen()) s.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
