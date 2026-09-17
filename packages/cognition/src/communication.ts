export const SPEECH_INTENTS = [
  "request_help",
  "offer_resource",
  "warn_danger",
  "coordinate_project",
  "share_discovery",
  "ask_information",
  "thank",
  "apologize",
  "negotiate",
  "decline",
  "socialize",
] as const;

export type SpeechIntent = (typeof SPEECH_INTENTS)[number];

export type SpeechAct = {
  speakerId: string;
  listenerId?: string;
  intent: SpeechIntent;
  text: string;
  urgent?: boolean;
  createdAtMs: number;
};

export type ChatPolicy = {
  speakerCooldownMs: number;
  pairCooldownMs: number;
};

const DEFAULT_POLICY: ChatPolicy = { speakerCooldownMs: 45_000, pairCooldownMs: 20_000 };

export class SpeechGate {
  private readonly lastSpeaker = new Map<string, { at: number; text: string }>();
  private readonly lastPair = new Map<string, number>();

  constructor(private readonly policy: ChatPolicy = DEFAULT_POLICY) {}

  allow(act: SpeechAct): { ok: boolean; reason: string } {
    if (act.urgent && act.intent === "warn_danger") return { ok: true, reason: "urgent_warning" };
    const last = this.lastSpeaker.get(act.speakerId);
    if (last && act.createdAtMs - last.at < this.policy.speakerCooldownMs) {
      return { ok: false, reason: "speaker_cooldown" };
    }
    if (last && similarText(last.text, act.text)) {
      return { ok: false, reason: "semantic_duplicate" };
    }
    if (act.listenerId) {
      const key = pairKey(act.speakerId, act.listenerId);
      const pairAt = this.lastPair.get(key);
      if (pairAt !== undefined && act.createdAtMs - pairAt < this.policy.pairCooldownMs) {
        return { ok: false, reason: "pair_cooldown" };
      }
    }
    return { ok: true, reason: "ok" };
  }

  record(act: SpeechAct): void {
    this.lastSpeaker.set(act.speakerId, { at: act.createdAtMs, text: act.text });
    if (act.listenerId) this.lastPair.set(pairKey(act.speakerId, act.listenerId), act.createdAtMs);
  }
}

export function speechIsNotAction(_act: SpeechAct): true {
  return true;
}

function pairKey(a: string, b: string): string {
  return `${a}::${b}`;
}

function similarText(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/\W+/g, " ").trim();
  const nb = b.toLowerCase().replace(/\W+/g, " ").trim();
  return na === nb || (na.length > 12 && nb.includes(na.slice(0, 12)));
}
